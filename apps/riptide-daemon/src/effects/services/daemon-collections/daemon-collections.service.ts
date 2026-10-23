import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { Task } from '@humanlayer/db/tables/tasks'
import { Context, type Effect, type Stream } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import type { SessionChangeMessage } from '@/collections/types'

type CollectionRow<Name extends keyof DaemonServices['collections']> =
	DaemonServices['collections'][Name]['toArray'][number]

export type ApprovalChangeMessage = CollectionChange<CollectionRow<'approvals'>>
export type TaskChangeMessage = CollectionChange<CollectionRow<'tasks'>>
export type WorkspaceSetupChangeMessage = CollectionChange<CollectionRow<'workspaceSetup'>>
export type ProviderLoginChangeMessage = CollectionChange<CollectionRow<'providerLoginRequests'>>

export interface DaemonCollectionsService {
	readonly current: Effect.Effect<DaemonServices['collections']>
	readonly sessionChanges: Stream.Stream<SessionChangeMessage>
	readonly taskChanges: Stream.Stream<TaskChangeMessage>
	readonly approvalChanges: Stream.Stream<ApprovalChangeMessage>
	readonly workspaceSetupChanges: Stream.Stream<WorkspaceSetupChangeMessage>
	readonly providerLoginChanges: Stream.Stream<ProviderLoginChangeMessage>
	readonly workspaceSetups: Stream.Stream<WorkspaceSetupTask>
	readonly workspaceSetupSessions: Stream.Stream<WorkspaceSetupSession>
	readonly streamSessionChanges: (sessionId: string) => Stream.Stream<SessionChangeMessage>
	readonly streamApprovalChanges: (approvalId: string) => Stream.Stream<ApprovalChangeMessage>
}

export interface CollectionChange<A> {
	readonly type: 'insert' | 'update' | 'delete'
	readonly value: A
	readonly previousValue?: A
}

export interface WorkspaceSetupSession {
	readonly session: DaemonServices['collections']['sessions']['toArray'][number]
	readonly workspaceSetup: DaemonServices['collections']['workspaceSetup']['toArray'][number] | null | undefined
}

export interface WorkspaceSetupTask {
	readonly task: Task
	readonly workspaceSetup: TaskWorkspaceSetupForHost
}

export class DaemonCollections extends Context.Service<DaemonCollections, DaemonCollectionsService>()(
	'DaemonCollections',
) {}
