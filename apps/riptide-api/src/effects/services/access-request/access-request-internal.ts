import type { AccessRequestScheduledReminders } from '@humanlayer/db/zodschemas/access-request-email-metadata'
import * as Sentry from '@sentry/node'
import { DateTime, Effect } from 'effect'

export const DAY_MS = 24 * 60 * 60 * 1000

// The persisted JSON metadata accepts arbitrary strings. Preserve the native
// parser's legacy/local-time interpretation at this boundary: DateTime.make(string)
// instead assumes UTC for zone-less strings. Date.parse is pure, not a clock read;
// make(number) represents invalid input as None for each caller's distinct policy.
export function parseReminderScheduledAt(scheduledAt: string) {
	return DateTime.make(Date.parse(scheduledAt))
}

export type RequestRow = {
	id: string
	request_generation: number
	artifact_id: string
	artifact_title_snapshot: string
	artifact_owner_user_id: string
	organization_id: string
	workosOrganizationId: string
	organizationName: string
	requestedAt: Date
	requesterEmail: string
	requesterUserId: string | null
	taskId: string | null
	taskName: string | null
}

export type AdminInfo = {
	userId: string
	email: string
	firstName: string | null
}

export type NotifyResult =
	| {
			ok: true
			admin: AdminInfo
			initialEmailId: string
			reminderEmailId: string
			scheduledAt: string
	  }
	| {
			ok: false
			admin: AdminInfo
			error: string
	  }

export type ArtifactLookupRow = {
	id: string
	organization_id: string
	file_name: string
	resource_owner_user_id: string
	access_requests_enabled: boolean | null
	workos_organization_id: string | null
	organization_name: string | null
	task_id: string | null
	task_name: string | null
}

export type ArchivedRow = {
	id: string
	scheduled_reminders: AccessRequestScheduledReminders
}

export type PendingRowForInvite = {
	id: string
	scheduled_reminders: AccessRequestScheduledReminders
}

export type ReminderCancelResult = {
	reminderId: string
	canceledAt: string | null
	cancelError: string | null
}

export function logError(operation: string, error: unknown): Effect.Effect<void> {
	return Effect.gen(function* () {
		yield* Effect.logError(`[access-request] ${operation} failed`, error)
		yield* Effect.sync(() => {
			Sentry.captureException(error, {
				tags: { error_type: 'access_request', operation },
			})
		})
	})
}
