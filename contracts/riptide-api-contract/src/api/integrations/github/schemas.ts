import z from 'zod/v4'

export const GitHubDecimalIdSchema = z.string().regex(/^\d+$/)

/**
 * An installation's grant, named the way GitHub names it. The set of slugs is GitHub's and grows
 * whenever the App asks for one more, so this must accept a slug it does not name: rejecting one
 * would fail the whole connection payload, including the refresh that is the remedy for a stale
 * grant. The server's twins in `riptide-api` and `@humanlayer/db` are kept to the same rule.
 */
export const GitHubInstallationPermissionsSchema = z
	.object({
		contents: z.enum(['read', 'write']).optional(),
		issues: z.enum(['read', 'write']).optional(),
		pull_requests: z.enum(['read', 'write']).optional(),
		metadata: z.enum(['read', 'write']).optional(),
		checks: z.enum(['read', 'write']).optional(),
		statuses: z.enum(['read', 'write']).optional(),
		issue_fields: z.enum(['read', 'write']).optional(),
		issue_types: z.enum(['read', 'write']).optional(),
		members: z.enum(['read', 'write']).optional(),
	})
	.loose()

/**
 * Availability of each public GitHub capability, derived server-side from the persisted grant
 * using the same requirement map the service guards enforce. The settings surface can disable
 * or explain unavailable actions from this instead of re-deriving from raw permissions.
 */
export const GitHubCapabilitiesSchema = z.object({
	listRepositories: z.boolean(),
	previewIssue: z.boolean(),
	writeBacklink: z.boolean(),
	readContents: z.boolean(),
	writeContents: z.boolean(),
	readPullRequests: z.boolean(),
	writePullRequests: z.boolean(),
	readChecks: z.boolean(),
	readCommitStatuses: z.boolean(),
})
export type GitHubCapabilities = z.infer<typeof GitHubCapabilitiesSchema>

export const GitHubConnectionSchema = z.object({
	id: z.uuid(),
	accountId: GitHubDecimalIdSchema,
	accountLogin: z.string(),
	accountType: z.enum(['Organization', 'User']),
	repositorySelection: z.enum(['all', 'selected']),
	repositoryCount: z.number().int().nonnegative(),
	permissions: GitHubInstallationPermissionsSchema,
	status: z.enum(['active', 'suspended']),
	needsReauth: z.boolean(),
	suspendedAt: z.number().nullable(),
	suspendedByLogin: z.string().nullable(),
	managementUrl: z.string(),
	capabilities: GitHubCapabilitiesSchema,
	lastReconciledAt: z.number(),
})
export type GitHubConnection = z.infer<typeof GitHubConnectionSchema>

export const GitHubRepositorySchema = z.object({
	id: GitHubDecimalIdSchema,
	ownerLogin: z.string(),
	name: z.string(),
	fullName: z.string(),
	private: z.boolean(),
	defaultBranch: z.string(),
	archived: z.boolean(),
})
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>

export const GitHubIssuePreviewCommentSchema = z.object({
	id: GitHubDecimalIdSchema,
	url: z.url(),
	body: z.string(),
	authorLogin: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
})

export const GitHubIssuePreviewSchema = z.object({
	repository: GitHubRepositorySchema,
	issueNumber: z.number().int().positive(),
	title: z.string(),
	url: z.url(),
	state: z.enum(['open', 'closed']),
	body: z.string(),
	labels: z.array(z.string()),
	assignees: z.array(z.string()),
	authorLogin: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	comments: z.array(GitHubIssuePreviewCommentSchema),
})
export type GitHubIssuePreview = z.infer<typeof GitHubIssuePreviewSchema>
