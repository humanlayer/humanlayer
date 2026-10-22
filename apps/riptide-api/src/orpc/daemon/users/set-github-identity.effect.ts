import { userIdentities } from '@humanlayer/db/tables/user-identities'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/**
 * Upsert the daemon user's GitHub identity, captured once at startup from their
 * own authenticated `gh api user`.
 *
 * ANTI-SPOOFING: the WorkOS user and org are ALWAYS taken from the daemon token
 * (context.auth), NEVER from input — this identity drives merged-PR credit, so
 * the daemon may only ever write ITS OWN mapping. Upsert target is
 * (organization_id, 'github', user_id): same external_id refreshes login/email,
 * a changed external_id overwrites (the user re-authed `gh` as a different
 * account). No transactionId — the table is not Electric-synced.
 *
 * TRUST MODEL (v1): the GitHub side is self-attested — the daemon reports what
 * its own authenticated `gh api user` returned, but nothing verifies the claim
 * server-side, and two org members CAN claim the same external_id (no uniqueness
 * on (org, provider, external_id)). Same trust level as all daemon-reported PR
 * data. Phase 2's GitHub OAuth verification supersedes these rows via `source`.
 */
export const setGithubIdentityProcedure = effectOrpcDaemonBase.users.setGithubIdentity
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth

		yield* postgres
			.query(
				postgres.client
					.insert(userIdentities)
					.values({
						organization_id: organizationId,
						user_id: userId,
						provider: 'github',
						external_id: input.externalId,
						external_login: input.login,
						email: input.email,
						source: 'daemon_gh_cli',
					})
					.onConflictDoUpdate({
						target: [userIdentities.organization_id, userIdentities.provider, userIdentities.user_id],
						set: {
							external_id: input.externalId,
							external_login: input.login,
							email: input.email,
							source: 'daemon_gh_cli',
							updated_at: BigInt(Date.now()),
						},
					}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { ok: true }
	})
