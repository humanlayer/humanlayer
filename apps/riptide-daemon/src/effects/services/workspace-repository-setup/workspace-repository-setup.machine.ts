import { Event, Machine, State } from '@humanlayer/effect-machine'
import { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { Cause, Effect } from 'effect'
import * as Schema from 'effect/Schema'

import { observeUnexpectedWorkspaceRepositoryCauses } from '../workspace-repository-actor-operations/workspace-repository-actor-observability'
import {
	WorkspaceRepositoryActorOperations,
	type WorkspaceRepositoryActorOperationError,
} from '../workspace-repository-actor-operations/workspace-repository-actor-operations.service'

export const WorkspaceRepositorySetupState = State({
	SetupRequested: { snapshot: WorkspaceRepositoryActorSnapshot },
	CheckingSource: { snapshot: WorkspaceRepositoryActorSnapshot },
	CloningSource: { snapshot: WorkspaceRepositoryActorSnapshot },
	RefreshingSource: { snapshot: WorkspaceRepositoryActorSnapshot },
	ResolvingCommit: { snapshot: WorkspaceRepositoryActorSnapshot },
	Materializing: { snapshot: WorkspaceRepositoryActorSnapshot },
	PublishingBranch: { snapshot: WorkspaceRepositoryActorSnapshot },
	CopyingFiles: { snapshot: WorkspaceRepositoryActorSnapshot },
	RunningSetupCommand: { snapshot: WorkspaceRepositoryActorSnapshot },
	Done: { snapshot: WorkspaceRepositoryActorSnapshot },
	Parked: { snapshot: WorkspaceRepositoryActorSnapshot },
	Archived: { snapshot: WorkspaceRepositoryActorSnapshot },
	Failed: { snapshot: WorkspaceRepositoryActorSnapshot, message: Schema.String },
})

export const WorkspaceRepositorySetupEvent = Event({
	SetupStarted: { snapshot: WorkspaceRepositoryActorSnapshot },
	SourceChecked: { snapshot: WorkspaceRepositoryActorSnapshot },
	SourceCloned: { snapshot: WorkspaceRepositoryActorSnapshot },
	SourceRefreshed: { snapshot: WorkspaceRepositoryActorSnapshot },
	CommitResolved: { snapshot: WorkspaceRepositoryActorSnapshot },
	WorktreeMaterialized: { snapshot: WorkspaceRepositoryActorSnapshot },
	BranchPublished: { snapshot: WorkspaceRepositoryActorSnapshot },
	FilesCopied: { snapshot: WorkspaceRepositoryActorSnapshot },
	SetupCommandFinished: { snapshot: WorkspaceRepositoryActorSnapshot },
	Reconcile: { snapshot: WorkspaceRepositoryActorSnapshot },
	Park: { snapshot: WorkspaceRepositoryActorSnapshot },
	Fail: { snapshot: WorkspaceRepositoryActorSnapshot, message: Schema.String },
})

type SetupEvent = typeof WorkspaceRepositorySetupEvent.Type

export const workspaceRepositorySetupStateFromSnapshot = (snapshot: WorkspaceRepositoryActorSnapshot) => {
	if (snapshot.workspace.archived) return WorkspaceRepositorySetupState.Archived({ snapshot })
	if (snapshot.status.error !== null) return WorkspaceRepositorySetupState.Parked({ snapshot })
	switch (snapshot.status.status) {
		case 'setup_requested':
			return WorkspaceRepositorySetupState.SetupRequested({ snapshot })
		case 'checking_source':
			return WorkspaceRepositorySetupState.CheckingSource({ snapshot })
		case 'cloning_source':
			return WorkspaceRepositorySetupState.CloningSource({ snapshot })
		case 'refreshing_source':
			return WorkspaceRepositorySetupState.RefreshingSource({ snapshot })
		case 'resolving_commit':
			return WorkspaceRepositorySetupState.ResolvingCommit({ snapshot })
		case 'materializing':
			return WorkspaceRepositorySetupState.Materializing({ snapshot })
		case 'publishing_branch':
			return WorkspaceRepositorySetupState.PublishingBranch({ snapshot })
		case 'copying_files':
			return WorkspaceRepositorySetupState.CopyingFiles({ snapshot })
		case 'running_setup_command':
			return WorkspaceRepositorySetupState.RunningSetupCommand({ snapshot })
		case 'done':
			return WorkspaceRepositorySetupState.Done({ snapshot })
	}
}

const runOperation = <R>(
	snapshot: WorkspaceRepositoryActorSnapshot,
	operation: Effect.Effect<WorkspaceRepositoryActorSnapshot, WorkspaceRepositoryActorOperationError, R>,
	onCommitted: (snapshot: WorkspaceRepositoryActorSnapshot) => SetupEvent,
) =>
	operation.pipe(
		Effect.map(onCommitted),
		Effect.catchTag('DaemonWorkspaceRepositoryStatusChanged', (error) =>
			Effect.succeed(WorkspaceRepositorySetupEvent.Reconcile({ snapshot: error.snapshot })),
		),
		Effect.catchTag('WorkspaceRepositoryParked', (error) =>
			Effect.succeed(WorkspaceRepositorySetupEvent.Park({ snapshot: error.snapshot })),
		),
		observeUnexpectedWorkspaceRepositoryCauses({
			workspaceId: snapshot.workspace.id,
			repositoryIdentity: snapshot.repository.repositoryIdentity,
			stage: snapshot.status.status,
		}),
		Effect.catchCause((cause) => {
			if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
			return Effect.succeed(
				WorkspaceRepositorySetupEvent.Fail({
					snapshot,
					message: Cause.pretty(cause),
				}),
			)
		}),
	)

export const makeWorkspaceRepositorySetupMachine = (initialSnapshot: WorkspaceRepositoryActorSnapshot) =>
	Machine.make({
		state: WorkspaceRepositorySetupState,
		event: WorkspaceRepositorySetupEvent,
		initial: workspaceRepositorySetupStateFromSnapshot(initialSnapshot),
	})
		.task(
			WorkspaceRepositorySetupState.SetupRequested,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.start(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.SetupStarted({ snapshot }),
					),
				),
			{ name: 'setup_started', onSuccess: (event) => event },
		)
		.on(WorkspaceRepositorySetupState.SetupRequested, WorkspaceRepositorySetupEvent.SetupStarted, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.CheckingSource,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.checkSource(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.SourceChecked({ snapshot }),
					),
				),
			{ name: 'check_source', onSuccess: (event) => event },
		)
		.on(WorkspaceRepositorySetupState.CheckingSource, WorkspaceRepositorySetupEvent.SourceChecked, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.CloningSource,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.cloneSource(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.SourceCloned({ snapshot }),
					),
				),
			{ name: 'clone_source', onSuccess: (event) => event },
		)
		.on(WorkspaceRepositorySetupState.CloningSource, WorkspaceRepositorySetupEvent.SourceCloned, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.RefreshingSource,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.refreshSource(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.SourceRefreshed({ snapshot }),
					),
				),
			{ name: 'refresh_source', onSuccess: (event) => event },
		)
		.on(
			WorkspaceRepositorySetupState.RefreshingSource,
			WorkspaceRepositorySetupEvent.SourceRefreshed,
			({ event }) => workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.ResolvingCommit,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.resolveCommit(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.CommitResolved({ snapshot }),
					),
				),
			{ name: 'resolve_commit', onSuccess: (event) => event },
		)
		.on(WorkspaceRepositorySetupState.ResolvingCommit, WorkspaceRepositorySetupEvent.CommitResolved, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.Materializing,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.materialize(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.WorktreeMaterialized({ snapshot }),
					),
				),
			{ name: 'materialize_worktree', onSuccess: (event) => event },
		)
		.on(
			WorkspaceRepositorySetupState.Materializing,
			WorkspaceRepositorySetupEvent.WorktreeMaterialized,
			({ event }) => workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.PublishingBranch,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.publishBranch(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.BranchPublished({ snapshot }),
					),
				),
			{ name: 'publish_branch', onSuccess: (event) => event },
		)
		.on(
			WorkspaceRepositorySetupState.PublishingBranch,
			WorkspaceRepositorySetupEvent.BranchPublished,
			({ event }) => workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.CopyingFiles,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.copyFiles(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.FilesCopied({ snapshot }),
					),
				),
			{ name: 'copy_files', onSuccess: (event) => event },
		)
		.on(WorkspaceRepositorySetupState.CopyingFiles, WorkspaceRepositorySetupEvent.FilesCopied, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.task(
			WorkspaceRepositorySetupState.RunningSetupCommand,
			({ state }) =>
				Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
					runOperation(state.snapshot, operations.runSetupCommand(state.snapshot), (snapshot) =>
						WorkspaceRepositorySetupEvent.SetupCommandFinished({ snapshot }),
					),
				),
			{ name: 'run_setup_command', onSuccess: (event) => event },
		)
		.on(
			WorkspaceRepositorySetupState.RunningSetupCommand,
			WorkspaceRepositorySetupEvent.SetupCommandFinished,
			({ event }) => workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.onAny(WorkspaceRepositorySetupEvent.Reconcile, ({ event }) =>
			workspaceRepositorySetupStateFromSnapshot(event.snapshot),
		)
		.onAny(WorkspaceRepositorySetupEvent.Park, ({ event }) =>
			WorkspaceRepositorySetupState.Parked({ snapshot: event.snapshot }),
		)
		.onAny(WorkspaceRepositorySetupEvent.Fail, ({ event }) =>
			WorkspaceRepositorySetupState.Failed({ snapshot: event.snapshot, message: event.message }),
		)
		.final(WorkspaceRepositorySetupState.Done)
		.final(WorkspaceRepositorySetupState.Parked)
		.final(WorkspaceRepositorySetupState.Archived)
		.final(WorkspaceRepositorySetupState.Failed)
