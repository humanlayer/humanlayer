import type { GitHubInstallationPermissions, GitHubPermissionLevel } from './github.schema'

/**
 * Pure functional core for GitHub capability gating.
 *
 * GitHub App permission levels are hierarchical, so `write` subsumes `read` on the same
 * permission. This module centralizes that ordering and the single capability -> minimum
 * grant requirement map used by both the service guards and the settings capability
 * projection, so a guard and its displayed availability can never silently diverge.
 *
 * These helpers are pure (no logs, spans, or Effect): the service shell decides how to fail
 * or annotate. See the capability requirement table in the TDD.
 */

const PERMISSION_RANK: Record<GitHubPermissionLevel, number> = { read: 1, write: 2 }

/** The GitHub permission slugs this integration understands. */
export type GitHubPermissionName = 'contents' | 'issues' | 'pull_requests' | 'metadata' | 'checks' | 'statuses'

/** A public capability plus the minimum installation grant it requires. */
export interface GitHubCapabilityRequirement {
	readonly permission: GitHubPermissionName
	readonly level: GitHubPermissionLevel
}

/**
 * The single source of truth mapping each public capability to its minimum required
 * installation grant. Capability keys are stable and safe to expose to the settings surface.
 */
export const GITHUB_CAPABILITY_REQUIREMENTS = {
	listRepositories: { permission: 'metadata', level: 'read' },
	previewIssue: { permission: 'issues', level: 'read' },
	writeBacklink: { permission: 'issues', level: 'write' },
	readContents: { permission: 'contents', level: 'read' },
	writeContents: { permission: 'contents', level: 'write' },
	readPullRequests: { permission: 'pull_requests', level: 'read' },
	writePullRequests: { permission: 'pull_requests', level: 'write' },
	readChecks: { permission: 'checks', level: 'read' },
	readCommitStatuses: { permission: 'statuses', level: 'read' },
} as const

export type GitHubCapability = keyof typeof GITHUB_CAPABILITY_REQUIREMENTS

/** The derived availability of every known capability, keyed by capability name. */
export type GitHubCapabilities = Record<GitHubCapability, boolean>

/** Reads the granted level for a permission, treating an absent grant as no access. */
export const grantedPermissionLevel = (
	permissions: GitHubInstallationPermissions,
	permission: GitHubPermissionName,
): GitHubPermissionLevel | null => permissions[permission] ?? null

/**
 * True when the granted level satisfies the required level. `write` satisfies a `read`
 * requirement; an absent grant satisfies nothing.
 */
export const permissionSatisfies = (
	granted: GitHubPermissionLevel | null,
	requiredLevel: GitHubPermissionLevel,
): boolean => granted !== null && PERMISSION_RANK[granted] >= PERMISSION_RANK[requiredLevel]

/** True when the persisted grant satisfies the capability's minimum requirement. */
export const capabilityAvailable = (
	permissions: GitHubInstallationPermissions,
	capability: GitHubCapability,
): boolean => {
	const requirement = GITHUB_CAPABILITY_REQUIREMENTS[capability]
	return permissionSatisfies(grantedPermissionLevel(permissions, requirement.permission), requirement.level)
}

/** Derives the availability of every capability from the persisted grant. */
export const deriveGitHubCapabilities = (permissions: GitHubInstallationPermissions): GitHubCapabilities => {
	const capabilities = {} as GitHubCapabilities
	for (const capability of Object.keys(GITHUB_CAPABILITY_REQUIREMENTS) as GitHubCapability[]) {
		capabilities[capability] = capabilityAvailable(permissions, capability)
	}
	return capabilities
}

/** The safe missing-permission detail a guard reports when a capability is unavailable. */
export interface GitHubMissingPermissionDetail {
	readonly capability: GitHubCapability
	readonly requiredPermission: GitHubPermissionName
	readonly requiredLevel: GitHubPermissionLevel
	readonly grantedLevel: GitHubPermissionLevel | null
}

/** The capability plus the level the persisted grant holds for the permission behind it. */
const capabilityDetail = (
	permissions: GitHubInstallationPermissions,
	capability: GitHubCapability,
): GitHubMissingPermissionDetail => {
	const requirement = GITHUB_CAPABILITY_REQUIREMENTS[capability]
	return {
		capability,
		requiredPermission: requirement.permission,
		requiredLevel: requirement.level,
		grantedLevel: grantedPermissionLevel(permissions, requirement.permission),
	}
}

/**
 * Checks one capability against the persisted grant. Returns the safe missing-permission
 * detail when unavailable and `null` when the requirement is satisfied. The service shell
 * turns a non-null result into a typed `GitHubMissingPermissionsError` before any provider
 * call, so a missing grant makes zero GitHub requests.
 */
export const checkGitHubCapability = (
	permissions: GitHubInstallationPermissions,
	capability: GitHubCapability,
): GitHubMissingPermissionDetail | null => {
	const requirement = GITHUB_CAPABILITY_REQUIREMENTS[capability]
	const grantedLevel = grantedPermissionLevel(permissions, requirement.permission)
	if (permissionSatisfies(grantedLevel, requirement.level)) return null
	return capabilityDetail(permissions, capability)
}

/**
 * Checks every capability an operation declares and reports all of the unavailable ones, so a
 * guard's answer names everything that needs granting rather than whichever it reached first.
 * Empty means the persisted grant satisfies the whole set.
 */
export const checkGitHubCapabilities = (
	permissions: GitHubInstallationPermissions,
	capabilities: readonly GitHubCapability[],
): readonly GitHubMissingPermissionDetail[] =>
	capabilities.flatMap((capability) => checkGitHubCapability(permissions, capability) ?? [])

/**
 * The details to report when GitHub itself refuses nodes a document selected. The persisted
 * grant satisfies each of these capabilities or the guard would have failed first, so the
 * granted level each detail carries is what the stale row claims, not what the installation
 * holds. Which of the document's capabilities GitHub withheld is not in its answer, so the
 * whole declared set is reported.
 */
export const refusedGitHubCapabilities = (
	permissions: GitHubInstallationPermissions,
	capabilities: readonly GitHubCapability[],
): readonly GitHubMissingPermissionDetail[] =>
	capabilities.map((capability) => capabilityDetail(permissions, capability))

/** The permission names behind a set of details, for a log field or a remediation sentence. */
export const missingPermissionNames = (missing: readonly GitHubMissingPermissionDetail[]): string =>
	[...new Set(missing.map((detail) => `${detail.requiredPermission}:${detail.requiredLevel}`))].join(', ')
