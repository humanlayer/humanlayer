import * as Sentry from '@sentry/bun'
import { Effect } from 'effect'

export const reportTaskDiffError = (
	error: unknown,
	operation: string,
	attributes: Readonly<Record<string, string | number | boolean>> = {},
) =>
	Effect.logError('Task diff operation failed', error).pipe(
		Effect.annotateLogs({ operation, ...attributes }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: 'task_diff', operation },
					extra: attributes,
				}),
			),
		),
	)
