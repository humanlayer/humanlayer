// Request-body zod schemas copied from the syncopate contracts (zod is a devDependency only),
// used by the mock cloud to reject bad requests the same way riptide-api would. Sources, under
// contracts/riptide-api-contract/src/ unless noted:
//   api/auth/user/organizations-list.ts
//   api/auth/token-refresh.ts
//   api/auth/daemon/token-create.ts
//   api/automation/run-prepare.ts, with its task config from api/tasks/create.ts
//   packages/schemas/src/zod/workspace/workspace-state.ts (repo root)
//   packages/schemas/src/zod/session/session-status.ts and session-error-reason.ts (repo root)
//   daemon/sessions/update.ts
//   daemon/events/create.ts
//   daemon/sessions/repositories/report.ts
//   daemon/artifacts/upsert.ts and create-upload.ts, with lib/filename-validation.ts
//   daemon/heartbeat.ts (only the fields pi sends; the rest are optional there)
//   daemon/agent-commands/report.ts, with packages/db/src/tables/agent-slash-commands.ts (repo root)
//   daemon/approvals/create.ts and api/approvals/resolve.ts (appliedSuggestions left out)
//   api/sessions/update.ts and api/tasks/update.ts (only the name fields; the rest pass through)
// Enums imported from elsewhere are inlined. z.any() becomes z.unknown(): same check, no `any` type.

import { z } from 'zod'

export const organizationsListInput = z.object({}).optional()

export const tokenRefreshInput = z.object({
	refreshToken: z.string(),
	organizationId: z.string().optional(),
})

export const daemonTokenCreateInput = z.object({
	hostId: z.string().uuid(),
})

const workspaceState = z.object({
	workspaceBaseDirectory: z.string(),
	repos: z.array(
		z.object({
			path: z.string(),
			description: z.string().optional(),
			remoteUrl: z.string().optional(),
			sourceRef: z.string(),
			sourceCommit: z.string().optional(),
			branch: z.string(), // "" on a detached HEAD
			branchRemote: z.string().min(1).optional(),
			primary: z.boolean(),
		}),
	),
})

/** TaskWorkspaceAndWorkflowConfigurationSchema. workspaceSpec and workspaceSetupState are not
 *  copied (the extension never sends them); only their presence matters, to the refine below. */
export const taskConfigInput = z
	.object({
		name: z.string().min(1),
		defaultWorkingDirectory: z.string().optional(),
		workspaceState: workspaceState.optional(),
		workspaceSpec: z.unknown().optional(),
		workspaceSetupState: z.unknown().optional(),
		localWorkspaceBaseDirectory: z.string().optional(),
		hostId: z.string().optional(),
		setupStatus: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
		workflowType: z.enum(['rpi', 'outline_only', 'prd_tdd', 'oneshot', 'freeform']).optional(),
		worktreeTiming: z.enum(['now', 'later', 'never']).optional(),
		autoAdvanceQuestionsToResearch: z.boolean().optional(),
		autoAdvanceResearchToDesign: z.boolean().optional(),
		autoAdvancePlanToWorktree: z.boolean().optional(),
		autoAdvanceWorktreeToImplementation: z.boolean().optional(),
		autoAdvanceImplementationToPr: z.boolean().optional(),
	})
	.superRefine((input, context) => {
		if (input.workspaceSpec && input.worktreeTiming !== undefined && input.worktreeTiming !== 'now') {
			context.addIssue({
				code: 'custom',
				path: ['worktreeTiming'],
				message: 'Worktree timing must be now when a workspace spec is provided',
			})
		}
	})

const taskSelector = z.discriminatedUnion('taskMode', [
	z.object({
		taskMode: z.literal('ensure'),
		slug: z.string().trim().min(1),
		task: taskConfigInput,
	}),
	z.object({
		taskMode: z.literal('use'),
		taskIdOrSlug: z.string().trim().min(1),
	}),
])

const targetSession = z.object({
	hostId: z.uuid(),
	sessionName: z.string().trim().min(1),
	prompt: z.string().min(1),
	workingDirectory: z.string().trim().min(1),
	codingAgent: z.enum(['claude', 'opencode', 'codelayer', 'fold', 'pi', 'codex', 'claude-code']).default('codelayer'),
	provider: z.string().default('anthropic'),
	model: z.string().default('opus'),
	effort: z.string().nullish(),
	fastMode: z.boolean().nullish(),
	permissionsMode: z.enum(['default', 'accept_edits', 'auto', 'bypass']).default('bypass'),
})

export const runPrepareInput = taskSelector.and(targetSession)

export const sessionStatus = z.enum([
	'ready_for_launch',
	'waiting_for_workspace',
	'draft',
	'launching',
	'running',
	'failed',
	'ready_for_input',
	'needs_approval',
	'waiting_for_usage_limit',
	'interrupt_requested',
	'interrupted',
	'resuming',
	'lost',
])

export type SessionStatus = z.output<typeof sessionStatus>

const tokenCount = z.number().int().nonnegative()

export const sessionUpdateInput = z.object({
	sessionId: z.uuid(),
	codingAgentSessionId: z.string().optional(),
	status: sessionStatus.exclude(['lost']).optional(), // the API derives "lost"; a daemon never reports it
	model: z.string().optional(),
	resolvedModel: z.string().optional(),
	errorMessage: z.string().optional(),
	errorReason: z.enum(['auth_required', 'start_failed']).nullable().optional(),
	contextWindowTokens: z.number().int().optional(),
	contextWindowLimit: z.number().int().optional(),
	isCompacting: z.boolean().optional(),
	totalCostUsd: z.number().optional(),
	modelUsage: z
		.record(
			z.string(),
			z.object({
				input_tokens: tokenCount,
				output_tokens: tokenCount,
				cache_read_input_tokens: tokenCount.optional(),
				cache_creation_input_tokens: tokenCount.optional(),
			}),
		)
		.optional(),
	usageReportKey: z.string().optional(),
})

// The server cuts (not rejects) long tool ids, so the event is still written.
const toolId = z.string().transform((s) => s.slice(0, 256))

export const eventCreateInput = z.object({
	eventId: z.uuid().optional(),
	sessionId: z.uuid(),
	codingAgentSessionId: z.string(),
	codingAgentEventId: z.string().optional(),
	eventType: z.enum(['message', 'tool_call', 'tool_result', 'thinking', 'system']),
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string().optional(),
	toolCallId: toolId.optional(),
	toolName: z.string().optional(),
	toolInputJson: z.unknown().optional(),
	parentToolUseId: z.string().nullable().optional(),
	toolResultForId: toolId.optional(),
	toolResultContent: z.string().optional(),
	inputTokens: z.number().int().optional(),
	outputTokens: z.number().int().optional(),
})

export const repositoriesReportInput = z.object({
	sessionId: z.uuid(),
	repositories: z
		.array(
			z.object({
				localPath: z.string().min(1),
				remoteUrl: z.string().optional(),
				branch: z.string().min(1).optional(), // absent when HEAD is detached
			}),
		)
		.max(50),
})

/** The candidates the server checks: the raw value, and the URL-decoded one when it differs. */
function decodedOrSelf(val: string): string {
	try {
		return decodeURIComponent(val)
	} catch {
		return val // invalid encoding passes
	}
}

function dangerousSubpath(val: string): boolean {
	if (val.includes('\\') || val.includes('..') || val.includes('\0')) return true
	const decoded = decodedOrSelf(val)
	if (decoded === val) return false
	return (
		decoded.includes('\\') ||
		decoded.includes('..') ||
		decoded.includes('\0') ||
		decoded.split('/').length !== val.split('/').length
	)
}

function badSubpathShape(val: string): boolean {
	const bad = (s: string) =>
		s.startsWith('/') || s.endsWith('/') || s.split('/').some((part) => part === '' || part === '.')
	return bad(val) || bad(decodedOrSelf(val))
}

export const safeSubpath = z
	.string()
	.min(1)
	.max(1024)
	.refine((val) => !dangerousSubpath(val), { message: 'Path contains traversal patterns' })
	.refine((val) => !badSubpathShape(val), {
		message: 'Path must be relative without empty segments or trailing slashes',
	})

export const artifactUpsertInput = z.object({
	id: z.uuidv7().optional(),
	taskId: z.uuid(),
	fileName: safeSubpath,
	content: z.string().max(10 * 1024 * 1024),
	sessionId: z.uuid().optional(),
	operationType: z.enum(['Write', 'Edit', 'MultiEdit', 'Read']).optional(),
	operationContents: z.record(z.string(), z.unknown()).optional(),
	frontmatter: z.record(z.string(), z.unknown()).optional(),
})

export const artifactCreateUploadInput = z.object({
	taskId: z.uuid(),
	fileName: safeSubpath,
	contentType: z.string().min(1),
	contentHash: z.string().min(1),
	fileSizeBytes: z.number().int().positive(),
})

const agentCommandScope = z.enum(['user', 'project', 'plugin'])

export const agentCommandsReportInput = z.object({
	hostId: z.string(),
	agent: z.string().default('claude'),
	workspacePath: z.string().optional(),
	commands: z.array(
		z.object({
			name: z.string(),
			description: z.string().optional(),
			argumentHint: z.string().optional(),
			scope: agentCommandScope.optional(),
		}),
	),
	skills: z.array(
		z.object({ name: z.string(), description: z.string().optional(), scope: agentCommandScope.optional() }),
	),
})

export const heartbeatInput = z.object({
	hostId: z.string(),
	hostName: z.string(),
	daemonVersion: z.string().optional(),
	capabilities: z.array(z.string()).optional(),
	canSelfUpdate: z.boolean().optional(),
})

export const approvalCreateInput = z.object({
	sessionId: z.string().uuid(),
	toolName: z.string(),
	toolInput: z.unknown(),
	toolUseId: z.string().optional(),
	agentId: z.string().optional(),
	suggestions: z.unknown().optional(),
})

export const approvalResolveInput = z.object({
	approvalId: z.string().uuid(),
	decision: z.enum(['approve', 'deny']),
	comment: z.string().optional(),
})

export const sessionRenameInput = z.object({ sessionId: z.string().uuid(), title: z.string().optional() }).passthrough()

export const taskRenameInput = z.object({ taskId: z.string(), name: z.string().min(1).optional() }).passthrough()
