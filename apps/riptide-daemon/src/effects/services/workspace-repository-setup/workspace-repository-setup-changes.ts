import {
	workspaceRepositoryStatusSelectSchema,
	type WorkspaceRepositoryStatusForUserForHost,
} from '@humanlayer/db/tables/workspace-repository-status-for-user-for-host'
import type { WorkspaceRepositoryStatusIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { createElectricCollection } from '@humanlayer/sync'
import { Context, Effect, Layer, Queue, Stream } from 'effect'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import type { CollectionChange } from '../daemon-collections/daemon-collections.service'

type SetupStatus = Pick<
	WorkspaceRepositoryStatusForUserForHost,
	'project_id' | 'workspace_id' | 'repository_identity' | 'status' | 'error'
>

export const makeWorkspaceRepositorySetupChangesStream = (collection: {
	subscribeChanges: (
		listener: (changes: Array<CollectionChange<SetupStatus>>) => void,
		options: { readonly includeInitialState: boolean },
	) => { readonly unsubscribe: () => void }
}): Stream.Stream<WorkspaceRepositoryStatusIdentity> =>
	Stream.callback<WorkspaceRepositoryStatusIdentity>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() =>
				collection.subscribeChanges(
					(batch) => {
						for (const change of batch) {
							const row = change.value
							if (change.type === 'delete' || row.status === 'done' || row.error !== null) continue
							Queue.offerUnsafe(queue, {
								projectId: row.project_id,
								workspaceId: row.workspace_id,
								repositoryIdentity: row.repository_identity,
							})
						}
					},
					{ includeInitialState: true },
				),
			),
			(subscription) => Effect.sync(() => subscription.unsubscribe()),
		),
	)

/** Invalidation hints only: the actor manager reloads authoritative state before doing work. */
export class WorkspaceRepositorySetupChanges extends Context.Service<
	WorkspaceRepositorySetupChanges,
	{ readonly changes: Stream.Stream<WorkspaceRepositoryStatusIdentity> }
>()('WorkspaceRepositorySetupChanges') {}

export const WorkspaceRepositorySetupChangesLive = (options: { readonly syncOrigin: string; readonly token: string }) =>
	Layer.effect(
		WorkspaceRepositorySetupChanges,
		Effect.gen(function* () {
			const collection = createElectricCollection({
				schema: workspaceRepositoryStatusSelectSchema,
				collectionName: 'workspaceRepositorySetup',
				syncOrigin: options.syncOrigin,
				syncVersion: 2,
				routePath: '/daemon/workspace-repository-statuses',
				headers: { 'x-daemon-authorization': options.token },
				shouldRetryOnFailure: true,
				logger,
				captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
				getKey: (row) => JSON.stringify([row.project_id, row.workspace_id, row.repository_identity]),
			})
			yield* Effect.addFinalizer(() => Effect.promise(() => collection.cleanup()))
			return { changes: makeWorkspaceRepositorySetupChangesStream(collection) }
		}),
	)
