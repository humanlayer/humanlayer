import { Effect } from 'effect'

import type { ResendError } from '../resend/resend-errors'
import type { WorkosUserDisplay } from '../workos/workos.service'
import {
	composeInitialEmail,
	composeReminderEmail,
	initialIdempotencyKey,
	reminderIdempotencyKey,
} from './access-request-emails'
import { type AdminInfo, logError, type NotifyResult, type RequestRow } from './access-request-internal'

export function buildRequesterDisplay(user: WorkosUserDisplay | null, fallbackEmail: string): string {
	if (!user) return fallbackEmail
	const fullName = [user.firstName, user.lastName].filter((s): s is string => Boolean(s)).join(' ')
	if (!fullName) return user.email
	return `${fullName} (${user.email})`
}

export function buildOwnerName(user: WorkosUserDisplay | null): string | null {
	if (!user) return null
	const fullName = [user.firstName, user.lastName].filter((s): s is string => Boolean(s)).join(' ')
	return fullName || null
}

export function buildInviteUrl(cloudOrigin: string, email: string): string {
	const base = cloudOrigin.replace(/\/+$/, '')
	return `${base}/admin/invitations?invite=${encodeURIComponent(email)}`
}

export function buildTaskUrl(appOrigin: string, taskId: string): string {
	const base = appOrigin.replace(/\/+$/, '')
	return `${base}/tasks/${encodeURIComponent(taskId)}`
}

export function buildArtifactUrl(cloudOrigin: string, artifactId: string): string {
	const base = cloudOrigin.replace(/\/+$/, '')
	return `${base}/artifacts/${encodeURIComponent(artifactId)}`
}

type ResendNotifyClient = {
	sendPlaintext: (input: {
		to: string
		subject: string
		text: string
		html?: string
		idempotencyKey: string
	}) => Effect.Effect<{ emailId: string }, ResendError>
	schedulePlaintext: (input: {
		to: string
		subject: string
		text: string
		html?: string
		scheduledAt: Date
		idempotencyKey: string
	}) => Effect.Effect<{ emailId: string; scheduledAt: string }, ResendError>
}

export function notifyAdmin(args: {
	request: RequestRow
	admin: AdminInfo
	scheduledAt: Date
	requesterDisplay: string
	requesterFirstName: string | null
	artifactOwnerName: string | null
	inviteUrl: string
	taskUrl: string | null
	artifactUrl: string | null
	resend: ResendNotifyClient
}): Effect.Effect<NotifyResult, ResendError> {
	return Effect.gen(function* () {
		const { request, admin, scheduledAt, resend } = args

		const templateInput = {
			organizationName: request.organizationName,
			recipientFirstName: admin.firstName,
			requesterDisplay: args.requesterDisplay,
			requesterFirstName: args.requesterFirstName,
			artifactTitle: request.artifact_title_snapshot,
			artifactUrl: args.artifactUrl,
			taskName: request.taskName,
			taskUrl: args.taskUrl,
			artifactOwnerName: args.artifactOwnerName,
			requestedAt: request.requestedAt,
			inviteUrl: args.inviteUrl,
		}
		const initialEmail = composeInitialEmail(templateInput)
		const reminderEmail = composeReminderEmail(templateInput)

		const initialResult = yield* resend.sendPlaintext({
			to: admin.email,
			subject: initialEmail.subject,
			text: initialEmail.text,
			html: initialEmail.html,
			idempotencyKey: initialIdempotencyKey({
				accessRequestId: request.id,
				requestGeneration: request.request_generation,
				adminUserId: admin.userId,
			}),
		})

		const reminderResult = yield* resend.schedulePlaintext({
			to: admin.email,
			subject: reminderEmail.subject,
			text: reminderEmail.text,
			html: reminderEmail.html,
			scheduledAt,
			idempotencyKey: reminderIdempotencyKey({
				accessRequestId: request.id,
				requestGeneration: request.request_generation,
				adminUserId: admin.userId,
			}),
		})

		return {
			ok: true as const,
			admin,
			initialEmailId: initialResult.emailId,
			reminderEmailId: reminderResult.emailId,
			scheduledAt: reminderResult.scheduledAt,
		}
	}).pipe(
		Effect.tapError((error) => logError(`notifyAdmin(${args.admin.userId})`, error)),
		Effect.catch((error) =>
			Effect.succeed({
				ok: false as const,
				admin: args.admin,
				error: error instanceof Error ? error.message : String(error),
			}),
		),
	)
}
