import type {
	PermissionDecisionClassification,
	PermissionUpdate as SDKPermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk'
import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import * as Sentry from '@sentry/bun'
import { Effect, Option, Stream } from 'effect'

import {
	isAllowedByAppliedSuggestions,
	isApprovalResolvedEvent,
	isResolvedStatus,
	parseAppliedSuggestions,
} from '@/agents/claudecode/approvals'
import { isWhitelisted } from '@/agents/claudecode/whitelist'

import { DaemonApi } from '../../daemon-api/daemon-api.service'
import { DaemonCollections } from '../../daemon-collections/daemon-collections.service'

export interface RequestToolApprovalInput {
	readonly sessionId: string
	readonly toolName: string
	readonly toolInput: Record<string, unknown>
	readonly cwd: string
	readonly signal: AbortSignal
	readonly suggestions?: unknown
	readonly toolUseID?: string
	readonly agentID?: string
}

interface ApprovalRecord {
	readonly id: string
	readonly status: string
	readonly comment: string | null
	readonly applied_suggestions: Parameters<typeof parseAppliedSuggestions>[0]['applied_suggestions']
}

function resultFromApproval(approval: ApprovalRecord): {
	readonly approved: boolean
	readonly comment: string | null
	readonly suggestions?: PermissionUpdate[]
} {
	return {
		approved: approval.status === 'approved',
		comment: approval.comment ?? null,
		suggestions: approval.status === 'approved' ? parseAppliedSuggestions(approval) : undefined,
	}
}

function awaitAbort(signal: AbortSignal) {
	return Effect.callback<never>((resume) => {
		const onAbort = () => resume(Effect.interrupt)
		if (signal.aborted) {
			onAbort()
			return
		}
		signal.addEventListener('abort', onAbort, { once: true })
		return Effect.sync(() => signal.removeEventListener('abort', onAbort))
	})
}

export const requestToolApproval = Effect.fn('claude.request_tool_approval')(function* (
	input: RequestToolApprovalInput,
) {
	return yield* Effect.gen(function* () {
		const api = yield* DaemonApi
		const collections = yield* DaemonCollections

		const current = yield* collections.current
		if (isWhitelisted(input.toolName, input.toolInput, input.cwd)) {
			return {
				behavior: 'allow' as const,
				updatedInput: input.toolInput,
				updatedPermissions: undefined,
				toolUseID: input.toolUseID,
			}
		}

		if (isAllowedByAppliedSuggestions(input.sessionId, input.toolName, input.toolInput, current.approvals)) {
			return {
				behavior: 'allow' as const,
				updatedInput: input.toolInput,
				updatedPermissions: undefined,
				toolUseID: input.toolUseID,
			}
		}

		const { approvalId } = yield* api.createApproval({
			sessionId: input.sessionId,
			toolName: input.toolName,
			toolInput: input.toolInput,
			toolUseId: input.toolUseID,
			agentId: input.agentID,
			suggestions: input.suggestions,
		})

		const afterCreate = (yield* collections.current).approvals.state.get(approvalId)
		const approval =
			afterCreate && isResolvedStatus(afterCreate.status)
				? afterCreate
				: yield* Effect.raceFirst(
						collections.streamApprovalChanges(approvalId).pipe(
							Stream.filter((change) => isApprovalResolvedEvent(change, approvalId)),
							Stream.runHead,
							Effect.flatMap(
								Option.match({
									onNone: () => Effect.interrupt,
									onSome: (change) => Effect.succeed(change.value),
								}),
							),
						),
						awaitAbort(input.signal),
					)

		const resolution = resultFromApproval(approval)
		if (resolution.approved) {
			const decisionClassification: PermissionDecisionClassification = resolution.suggestions?.length
				? 'user_permanent'
				: 'user_temporary'
			return {
				behavior: 'allow' as const,
				updatedPermissions: resolution.suggestions as SDKPermissionUpdate[] | undefined,
				updatedInput: input.toolInput,
				decisionClassification,
				toolUseID: input.toolUseID,
			}
		}

		return {
			behavior: 'deny' as const,
			message: resolution.comment || 'Request denied by user',
			decisionClassification: 'user_reject' as const,
			toolUseID: input.toolUseID,
		}
	}).pipe(
		Effect.catchCause((cause) => {
			if (input.signal.aborted) {
				return Effect.succeed({
					behavior: 'deny' as const,
					message: 'Approval cancelled due to session interrupt',
					toolUseID: input.toolUseID,
				})
			}
			return Effect.sync(() =>
				Sentry.captureException(cause, {
					tags: { error_type: 'approval_can_use_tool', session_id: input.sessionId },
					extra: { toolName: input.toolName },
				}),
			).pipe(
				Effect.andThen(
					Effect.succeed({
						behavior: 'deny' as const,
						message: 'Internal error processing approval',
						toolUseID: input.toolUseID,
					}),
				),
			)
		}),
	)
})
