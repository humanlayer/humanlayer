import { Effect } from 'effect'

import { Sentry } from '../../../instrument'
import { WorkosService, type WorkosUserDisplay } from './workos.service'

export function formatUserDisplayName(user: WorkosUserDisplay): string {
	if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`
	if (user.firstName) return user.firstName
	return user.email.split('@')[0] ?? user.email
}

export const resolveUserDisplayNames = (userIds: string[]) =>
	Effect.gen(function* () {
		const workos = yield* WorkosService
		const displayNameEntries = yield* Effect.forEach(
			[...new Set(userIds)],
			(userId) =>
				workos.getUser({ userId }).pipe(
					Effect.map((user) => [userId, formatUserDisplayName(user)] as const),
					Effect.tapError((error) =>
						Effect.logError('Failed to fetch user display name from WorkOS', error).pipe(
							Effect.annotateLogs({ userId }),
						),
					),
					Effect.tapError((error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'workos_display_name_resolution_failure' },
								extra: { userId },
							}),
						),
					),
					Effect.catch(() => Effect.succeed(null)),
				),
			{ concurrency: 5 },
		)

		return new Map(displayNameEntries.flatMap((entry) => (entry === null ? [] : [entry])))
	})

export const resolveUserDisplayName = (userId: string) =>
	resolveUserDisplayNames([userId]).pipe(Effect.map((displayNames) => displayNames.get(userId) ?? null))
