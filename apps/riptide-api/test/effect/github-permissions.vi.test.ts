import { GitHubInstallationPermissionsSchema as StoredPermissionsSchema } from '@humanlayer/db/zodschemas/github-installation-permissions'
import { GitHubInstallationPermissionsSchema as ContractPermissionsSchema } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import {
	capabilityAvailable,
	checkGitHubCapabilities,
	checkGitHubCapability,
	deriveGitHubCapabilities,
	missingPermissionNames,
	refusedGitHubCapabilities,
	grantedPermissionLevel,
	permissionSatisfies,
} from '../../src/effects/services/github/github.permissions'
import { GitHubInstallationPermissions } from '../../src/effects/services/github/github.schema'

describe('GitHub permission ordering', () => {
	test('write satisfies a read requirement on the same permission', () => {
		expect(permissionSatisfies('write', 'read')).toBe(true)
		expect(permissionSatisfies('read', 'read')).toBe(true)
		expect(permissionSatisfies('write', 'write')).toBe(true)
	})

	test('read does not satisfy a write requirement and an absent grant satisfies nothing', () => {
		expect(permissionSatisfies('read', 'write')).toBe(false)
		expect(permissionSatisfies(null, 'read')).toBe(false)
		expect(permissionSatisfies(null, 'write')).toBe(false)
	})

	test('reads the granted level, treating an absent permission as no access', () => {
		expect(grantedPermissionLevel({ issues: 'write', metadata: 'read' }, 'issues')).toBe('write')
		expect(grantedPermissionLevel({ issues: 'write', metadata: 'read' }, 'contents')).toBeNull()
	})
})

describe('GitHub capability derivation', () => {
	test('derives every capability from the full grant', () => {
		const capabilities = deriveGitHubCapabilities({
			contents: 'write',
			issues: 'write',
			pull_requests: 'write',
			metadata: 'read',
			checks: 'read',
			statuses: 'read',
		})
		expect(capabilities).toEqual({
			listRepositories: true,
			previewIssue: true,
			writeBacklink: true,
			readContents: true,
			writeContents: true,
			readPullRequests: true,
			writePullRequests: true,
			readChecks: true,
			readCommitStatuses: true,
		})
	})

	test('an installation that predates the panel has neither checks capability', () => {
		const capabilities = deriveGitHubCapabilities({
			contents: 'write',
			issues: 'write',
			pull_requests: 'write',
			metadata: 'read',
		})
		expect(capabilities.readChecks).toBe(false)
		expect(capabilities.readCommitStatuses).toBe(false)
		expect(capabilities.previewIssue).toBe(true)
	})

	test('issues:read enables preview but not the back-link write capability', () => {
		const permissions = { metadata: 'read' as const, issues: 'read' as const }
		expect(capabilityAvailable(permissions, 'previewIssue')).toBe(true)
		expect(capabilityAvailable(permissions, 'writeBacklink')).toBe(false)
		expect(capabilityAvailable(permissions, 'listRepositories')).toBe(true)
	})

	test('a metadata-only grant exposes only repository listing', () => {
		const capabilities = deriveGitHubCapabilities({ metadata: 'read' })
		expect(capabilities.listRepositories).toBe(true)
		expect(capabilities.previewIssue).toBe(false)
		expect(capabilities.writeBacklink).toBe(false)
	})
})

describe('GitHub capability guard', () => {
	test('returns null when the requirement is satisfied', () => {
		expect(checkGitHubCapability({ metadata: 'read', issues: 'write' }, 'writeBacklink')).toBeNull()
		// write satisfies a read requirement, so no missing-permission detail is produced.
		expect(checkGitHubCapability({ metadata: 'read', issues: 'write' }, 'previewIssue')).toBeNull()
	})

	test('reports safe missing-permission detail when the grant is insufficient', () => {
		expect(checkGitHubCapability({ metadata: 'read', issues: 'read' }, 'writeBacklink')).toEqual({
			capability: 'writeBacklink',
			requiredPermission: 'issues',
			requiredLevel: 'write',
			grantedLevel: 'read',
		})
		expect(checkGitHubCapability({ metadata: 'read' }, 'previewIssue')).toEqual({
			capability: 'previewIssue',
			requiredPermission: 'issues',
			requiredLevel: 'read',
			grantedLevel: null,
		})
	})
})

describe('GitHub plural capability guard', () => {
	test('reports every unavailable capability, not the first', () => {
		const missing = checkGitHubCapabilities({ metadata: 'read', pull_requests: 'read' }, [
			'readPullRequests',
			'readChecks',
			'readCommitStatuses',
		])

		expect(missing.map((detail) => detail.capability)).toEqual(['readChecks', 'readCommitStatuses'])
		expect(missingPermissionNames(missing)).toBe('checks:read, statuses:read')
	})

	test('reports nothing when the grant covers the whole set', () => {
		expect(
			checkGitHubCapabilities({ metadata: 'read', pull_requests: 'write', checks: 'read', statuses: 'read' }, [
				'readPullRequests',
				'readChecks',
				'readCommitStatuses',
			]),
		).toEqual([])
	})

	test('a refusal reports the declared set against the grant the row claims', () => {
		expect(refusedGitHubCapabilities({ metadata: 'read', checks: 'read' }, ['readChecks'])).toEqual([
			{ capability: 'readChecks', requiredPermission: 'checks', requiredLevel: 'read', grantedLevel: 'read' },
		])
	})
})

/**
 * GitHub names every permission the App holds, and the set grows whenever the App asks for one
 * more. A grant therefore travels from GitHub's payload, through what is stored, out to the
 * settings surface, and any schema on that path that rejects an unnamed slug fails the whole
 * connection — including `refreshConnection`, which is the remedy offered for a stale grant.
 */
describe('an installation grant survives the whole path', () => {
	const wire = {
		contents: 'write',
		issues: 'write',
		pull_requests: 'write',
		metadata: 'read',
		checks: 'read',
		statuses: 'read',
		issue_fields: 'read',
		issue_types: 'read',
		members: 'read',
	}

	test('every slug the App asks for reaches the settings surface', () => {
		const decoded = Schema.decodeUnknownSync(GitHubInstallationPermissions)(wire)
		expect(StoredPermissionsSchema.safeParse(decoded).success).toBe(true)
		expect(ContractPermissionsSchema.safeParse(decoded).success).toBe(true)
	})

	test('a slug the App has not asked for yet costs the connection nothing', () => {
		const decoded = Schema.decodeUnknownSync(GitHubInstallationPermissions)({
			...wire,
			single_file: 'read',
		})
		expect(StoredPermissionsSchema.safeParse(decoded).success).toBe(true)
		expect(ContractPermissionsSchema.safeParse(decoded).success).toBe(true)
	})
})
