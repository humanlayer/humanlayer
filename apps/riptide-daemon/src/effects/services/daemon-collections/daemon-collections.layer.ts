import { createEffect, eq } from '@tanstack/db'
import { Effect, Layer, Queue, Stream } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import { createApprovalsCollection } from '@/collections/electric/approvals'
import { createProviderLoginRequestsCollection } from '@/collections/electric/provider-login-requests'
import { createSessionsCollection } from '@/collections/electric/sessions'
import { createTasksCollection, loadHostTasks } from '@/collections/electric/tasks'
import {
	awaitWorkspaceSetupCollectionReady,
	createWorkspaceSetupCollection,
} from '@/collections/electric/workspace-setup'
import type { SessionChangeMessage } from '@/collections/types'

import {
	type ApprovalChangeMessage,
	type CollectionChange,
	DaemonCollections,
	type ProviderLoginChangeMessage,
	type TaskChangeMessage,
	type WorkspaceSetupChangeMessage,
	type WorkspaceSetupSession,
	type WorkspaceSetupTask,
} from './daemon-collections.service'

export interface DaemonCollectionsOptions {
	readonly hostId: string
	readonly token: string
	readonly syncOrigin: string
	readonly targetSessionId?: string
}

type CollectionSubscription = { readonly unsubscribe: () => void }
type DisposableCollection = { readonly cleanup: () => Promise<void> }

type ChangeSubscribable<A> = {
	subscribeChanges(
		listener: (changes: Array<A>) => void,
		options: { readonly includeInitialState?: boolean },
	): CollectionSubscription
}

const subscribe = <A>(collection: ChangeSubscribable<A>, includeInitialState = true): Stream.Stream<A> =>
	Stream.callback<A>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() =>
				collection.subscribeChanges(
					(changes: readonly A[]) => {
						for (const change of changes) Queue.offerUnsafe(queue, change)
					},
					{ includeInitialState },
				),
			),
			(subscription) => Effect.sync(() => subscription.unsubscribe()),
		),
	)

// includeInitialState on an on-demand collection requests the whole shape, so replay only loaded rows.
export const subscribeLoaded = <A extends { readonly id: string }>(collection: {
	readonly toArray: ReadonlyArray<A>
	subscribeChanges(
		listener: (changes: Array<CollectionChange<A>>) => void,
		options: { readonly includeInitialState?: boolean },
	): CollectionSubscription
}): Stream.Stream<CollectionChange<A>> =>
	Stream.callback<CollectionChange<A>>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const subscription = collection.subscribeChanges(
					(changes) => {
						for (const change of changes) Queue.offerUnsafe(queue, change)
					},
					{ includeInitialState: false },
				)
				for (const value of collection.toArray) Queue.offerUnsafe(queue, { type: 'insert', value })
				return subscription
			}),
			(subscription) => Effect.sync(() => subscription.unsubscribe()),
		),
	)

export const filterAutomationSessionChanges = (
	stream: Stream.Stream<SessionChangeMessage>,
	targetSessionId: string | undefined,
): Stream.Stream<SessionChangeMessage> =>
	stream.pipe(Stream.filter((change) => targetSessionId === undefined || change.value.id === targetSessionId))

const disposeCollection = (collection: DisposableCollection) =>
	Effect.promise(async () => {
		await collection.cleanup()
	})

export const makeWorkspaceSetupSessionsStream = (
	collections: DaemonServices['collections'],
	onSubscribed: () => void = () => undefined,
): Stream.Stream<WorkspaceSetupSession> =>
	Stream.callback((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const effect = createEffect<WorkspaceSetupSession>({
					query: (q) =>
						q
							.from({ session: collections.sessions })
							.leftJoin({ workspaceSetup: collections.workspaceSetup }, ({ session, workspaceSetup }) =>
								eq(session.task_id, workspaceSetup.task_id),
							)
							.select(({ session, workspaceSetup }) => ({ session, workspaceSetup })),
					onBatch: (events) => {
						for (const event of events) if (event.type !== 'exit') Queue.offerUnsafe(queue, event.value)
					},
				})
				onSubscribed()
				return effect
			}),
			(effect) => Effect.promise(() => effect.dispose()),
		),
	)

type LoadingWorkspaceSetupTask = Omit<WorkspaceSetupTask, 'task'> & {
	readonly task: WorkspaceSetupTask['task'] | undefined
}

const hasTask = (row: LoadingWorkspaceSetupTask): row is WorkspaceSetupTask => row.task !== undefined

export const makeWorkspaceSetupsStream = (
	collections: DaemonServices['collections'],
	hostId: string,
): Stream.Stream<WorkspaceSetupTask> =>
	Stream.callback((queue) =>
		Effect.acquireRelease(
			Effect.sync(() =>
				createEffect<WorkspaceSetupTask>({
					query: (q) =>
						q
							.from({ workspaceSetup: collections.workspaceSetup })
							.leftJoin({ task: collections.tasks }, ({ workspaceSetup, task }) =>
								eq(workspaceSetup.task_id, task.id),
							)
							.where(({ workspaceSetup }) => eq(workspaceSetup.host_id, hostId))
							.select(({ task, workspaceSetup }) => ({ task, workspaceSetup })),
					onBatch: (events) => {
						for (const event of events) if (hasTask(event.value)) Queue.offerUnsafe(queue, event.value)
					},
				}),
			),
			(effect) => Effect.promise(() => effect.dispose()),
		),
	)

export function DaemonCollectionsLive(options: DaemonCollectionsOptions | DaemonServices['collections']) {
	if ('sessions' in options) {
		const sessionChanges = subscribe<SessionChangeMessage>(options.sessions)
		const taskChanges = subscribe<TaskChangeMessage>(options.tasks)
		const approvalChanges = subscribe<ApprovalChangeMessage>(options.approvals)
		const workspaceSetupChanges = subscribe<WorkspaceSetupChangeMessage>(options.workspaceSetup)
		const providerLoginChanges = subscribe<ProviderLoginChangeMessage>(options.providerLoginRequests)
		return Layer.succeed(DaemonCollections, {
			current: Effect.succeed(options),
			sessionChanges,
			taskChanges,
			approvalChanges,
			workspaceSetupChanges,
			providerLoginChanges,
			workspaceSetups: makeWorkspaceSetupsStream(options, ''),
			workspaceSetupSessions: makeWorkspaceSetupSessionsStream(options),
			streamSessionChanges: (sessionId: string) =>
				subscribe<SessionChangeMessage>(options.sessions, false).pipe(
					Stream.filter((change) => change.value.id === sessionId),
				),
			streamApprovalChanges: (approvalId: string) =>
				approvalChanges.pipe(Stream.filter((change) => change.value.id === approvalId)),
		})
	}

	return Layer.effect(
		DaemonCollections,
		Effect.gen(function* () {
			const tasks = createTasksCollection(options.syncOrigin, options.token)
			const workspaceSetup = createWorkspaceSetupCollection(options.syncOrigin, options.token)
			const collections: DaemonServices['collections'] = {
				sessions: createSessionsCollection(options.syncOrigin, options.token, options.hostId),
				tasks,
				approvals: createApprovalsCollection(options.syncOrigin, options.token),
				workspaceSetup,
				providerLoginRequests: createProviderLoginRequestsCollection(options.syncOrigin, options.token),
			}
			yield* Effect.addFinalizer(() =>
				Effect.forEach(Object.values(collections), disposeCollection, { discard: true }),
			)

			yield* Effect.promise(() => awaitWorkspaceSetupCollectionReady(workspaceSetup))
			yield* Effect.acquireRelease(
				Effect.promise(() => loadHostTasks(collections)),
				(hostTasks) => Effect.promise(() => hostTasks.release()),
			)

			const sessionChanges = filterAutomationSessionChanges(
				subscribe<SessionChangeMessage>(collections.sessions),
				options.targetSessionId,
			)
			const taskChanges: Stream.Stream<TaskChangeMessage> = subscribeLoaded(collections.tasks)
			const approvalChanges = subscribe<ApprovalChangeMessage>(collections.approvals)
			const workspaceSetupChanges = subscribe<WorkspaceSetupChangeMessage>(collections.workspaceSetup)
			const providerLoginChanges = subscribe<ProviderLoginChangeMessage>(collections.providerLoginRequests)
			const workspaceSetupSessions = makeWorkspaceSetupSessionsStream(collections).pipe(
				Stream.filter(
					(row) => options.targetSessionId === undefined || row.session.id === options.targetSessionId,
				),
			)
			const workspaceSetups = makeWorkspaceSetupsStream(collections, options.hostId)

			return {
				current: Effect.succeed(collections),
				sessionChanges,
				taskChanges,
				approvalChanges,
				workspaceSetupChanges,
				providerLoginChanges,
				workspaceSetups,
				workspaceSetupSessions,
				streamSessionChanges: (sessionId: string) =>
					subscribe<SessionChangeMessage>(collections.sessions, false).pipe(
						Stream.filter((change) => change.value.id === sessionId),
					),
				streamApprovalChanges: (approvalId: string) =>
					approvalChanges.pipe(Stream.filter((change) => change.value.id === approvalId)),
			}
		}),
	)
}
