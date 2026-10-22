import z from 'zod/v4'

export const GitHubPermissionLevelSchema = z.enum(['read', 'write'])
export type GitHubPermissionLevel = z.infer<typeof GitHubPermissionLevelSchema>

/**
 * The permission slugs the GitHub App asks for. GitHub names every granted permission in an
 * installation's payload, and the set grows whenever the App asks for one more, so a stored
 * grant must survive a slug this schema does not name: rejecting the row would take the whole
 * connection down until a deploy caught up.
 */
export const GitHubInstallationPermissionsSchema = z
	.object({
		contents: GitHubPermissionLevelSchema.optional(),
		issues: GitHubPermissionLevelSchema.optional(),
		pull_requests: GitHubPermissionLevelSchema.optional(),
		metadata: GitHubPermissionLevelSchema.optional(),
		checks: GitHubPermissionLevelSchema.optional(),
		statuses: GitHubPermissionLevelSchema.optional(),
		issue_fields: GitHubPermissionLevelSchema.optional(),
		issue_types: GitHubPermissionLevelSchema.optional(),
		members: GitHubPermissionLevelSchema.optional(),
	})
	.loose()

export type GitHubInstallationPermissions = z.infer<typeof GitHubInstallationPermissionsSchema>
