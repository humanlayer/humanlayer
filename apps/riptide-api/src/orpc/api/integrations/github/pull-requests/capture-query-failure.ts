import { Effect } from 'effect'

import { Sentry } from '../../../../../instrument'

// `PostgresDb.query` only logs, so without this the narrowed failure reaches nobody.
export const captureQueryFailure = (operation: string, organizationId: string) => (cause: unknown) =>
	Effect.logError('GitHub PR panel database read failed').pipe(
		Effect.annotateLogs({ operation, organization_id: organizationId }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(cause, {
					tags: { integration: 'github', error_type: 'github_pr_panel_query' },
					extra: { operation, organization_id: organizationId },
				}),
			),
		),
	)
