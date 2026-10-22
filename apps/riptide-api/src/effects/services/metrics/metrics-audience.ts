import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import * as Sentry from '@sentry/node'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { AppRuntime } from '../../app-runtime'
import { PostgresDb } from '../postgres/postgres-db.service'

type MetricsViewer = {
	organizationId: string
	isAdmin: boolean
}

/**
 * Who may read the per-member cost and output aggregates behind Advanced Metrics, given that the
 * org's plan already entitles it. Admins always may; everyone else only once an admin has opened
 * the page to the whole org.
 *
 * The gates and `auth.user.info` all answer this question, so they share the rule rather than
 * restating it — three copies would let the page and the API disagree about who its audience is.
 */
export function isInMetricsAudience({
	isAdmin,
	visibleToAllMembers,
}: {
	isAdmin: boolean
	visibleToAllMembers: boolean
}): boolean {
	return isAdmin || visibleToAllMembers
}

/**
 * Reads the primary, not the replica: an admin who has just closed the page off expects the next
 * request from a member to be refused, and replica lag would keep it open.
 *
 * Fails CLOSED, unlike the plan entitlement it sits beside — that one widens nothing on error,
 * this one would hand every member the org's per-person spend. A persistent failure here refuses
 * every member and looks exactly like an org that never opted in, so it reports to Sentry.
 */
export const organizationSharesMetricsWithMembers = ({ organizationId, isAdmin }: MetricsViewer) =>
	Effect.gen(function* () {
		if (isAdmin) return true

		const postgres = yield* PostgresDb
		const [settings] = yield* postgres.query(
			postgres.client
				.select({ visibleToAllMembers: organizationSettings.advanced_metrics_visible_to_all_members })
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
				.limit(1),
		)

		return isInMetricsAudience({ isAdmin, visibleToAllMembers: settings?.visibleToAllMembers ?? false })
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning('Advanced Metrics audience check failed closed').pipe(
				Effect.annotateLogs({ cause, organizationId }),
				Effect.tap(() =>
					Effect.sync(() =>
						Sentry.captureException(cause, {
							tags: { error_type: 'metrics_audience_failure' },
							extra: { organizationId },
						}),
					),
				),
				Effect.as(false),
			),
		),
		Effect.withSpan('metrics.shares_with_members'),
	)

export function sharesMetricsWithMembers(runtime: AppRuntime, viewer: MetricsViewer): Promise<boolean> {
	return runtime.runPromise(organizationSharesMetricsWithMembers(viewer))
}
