import { approvals } from '@humanlayer/db/tables/approvals'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, count, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import {
	getSessionAccessControlLevel,
	hasRequiredSessionAccess,
	SessionAccessControl,
} from '../../../lib/session-multiplayer-prompting-auth'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

/**
 * Resolve a pending approval (approve or deny).
 * Updates session status back to 'running' if no more pending approvals.
 *
 * Authorization:
 * - If approval has a task_id, user must have edit permission on the task
 * - If no task_id, user must be the resource_owner_user_id
 */
export const resolveApprovalEffectProcedure = effectOrpcBaseOrganizationRequired.approvals.resolve.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { organizationId, userId } = context.auth
	const { approvalId, decision, comment, appliedSuggestions } = input
	const nowMillis = Date.now()

	const result = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				// 1. Get the pending approval to check authorization
				const [pendingApproval] = yield* tx.query(
					tx.client
						.select({
							id: approvals.id,
							status: approvals.status,
							session_id: approvals.session_id,
							host_id: approvals.host_id,
							task_id: approvals.task_id,
							resource_owner_user_id: approvals.resource_owner_user_id,
							created_by: sessions.created_by,
						})
						.from(approvals)
						.innerJoin(sessions, eq(approvals.session_id, sessions.id))
						.where(and(eq(approvals.id, approvalId), eq(approvals.organization_id, organizationId))),
				)

				if (!pendingApproval) {
					return yield* Effect.fail(errors.NOT_FOUND())
				}

				const sessionId = pendingApproval.session_id
				if (!sessionId) {
					return yield* Effect.fail(
						errors.INTERNAL_SERVER_ERROR({ data: { message: 'approval is missing session_id' } }),
					)
				}

				// Idempotent: if already resolved, return success to prevent client-side errors
				if (pendingApproval.status !== 'pending') {
					const txid = yield* getTransactionId(tx)
					return { success: true, txid }
				}

				// 2. Check session access permissions
				const accessLevel = yield* getSessionAccessControlLevel(
					tx,
					{ organizationId, sessionId, actorUserId: userId },
					nowMillis,
				)
				if (!hasRequiredSessionAccess(accessLevel, SessionAccessControl.prompt)) {
					return yield* Effect.fail(errors.FORBIDDEN())
				}

				// 3. Update approval status with approved_by_user_id
				const resolvedComment =
					decision === 'deny' && comment
						? `The user denied this tool call with feedback: ${comment}`
						: (comment ?? null)
				yield* tx.query(
					tx.client
						.update(approvals)
						.set({
							status: decision === 'approve' ? 'approved' : 'denied',
							comment: resolvedComment,
							responded_at: BigInt(nowMillis),
							approved_by_user_id: userId,
							applied_suggestions: decision === 'approve' ? (appliedSuggestions ?? null) : null,
						})
						.where(eq(approvals.id, approvalId)),
				)

				// 4. Check if any other pending approvals exist for this session
				const [pendingResult] = yield* tx.query(
					tx.client
						.select({ count: count() })
						.from(approvals)
						.where(
							and(
								eq(approvals.session_id, sessionId),
								eq(approvals.organization_id, organizationId),
								eq(approvals.status, 'pending'),
							),
						),
				)

				// 5. If no more pending approvals, set session back to running
				if (pendingResult && pendingResult.count === 0) {
					yield* tx.query(
						tx.client
							.update(sessions)
							.set({
								status: 'running',
								last_activity_at: BigInt(nowMillis),
							})
							.where(eq(sessions.id, sessionId)),
					)
				}

				const txid = yield* getTransactionId(tx)
				return { success: true, txid }
			}),
		)
		.pipe(
			Effect.tap(({ success }) =>
				Effect.logInfo('Approval resolved').pipe(
					Effect.annotateLogs({ approvalId, decision, success, userId }),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				SessionDoesNotExistError: () => Effect.fail(errors.NOT_FOUND()),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	return {
		success: result.success,
		transactionId: result.txid,
	}
})
