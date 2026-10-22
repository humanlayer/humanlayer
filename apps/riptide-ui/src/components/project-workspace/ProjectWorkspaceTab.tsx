import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { WorkspaceTabPure, type WorkspaceTreeNode } from '@humanlayer/ui/components/workspace-tab-pure'
import { AlertTriangle, Check, CircleDashed, Clock3, Monitor } from 'lucide-react'
import type { ReactNode } from 'react'

import type { WorkspaceOwnerDisplay } from '@/components/workspace-owner-display'

import { projectWorkspaceRepositoryKey } from './project-workspace-repository-key'

type WorkspaceStatus = RiptideApiOutputs['projectWorkspaces']['getStatus']
type Materialization = WorkspaceStatus['materializations'][number]
type Repository = Materialization['repositories'][number]
type SetupStage = Repository['status']['status']
type DisplayState = 'success' | 'running' | 'queued' | 'failed' | 'skipped' | 'warning'

const setupStages: SetupStage[] = [
	'setup_requested',
	'checking_source',
	'cloning_source',
	'refreshing_source',
	'resolving_commit',
	'materializing',
	'publishing_branch',
	'copying_files',
	'running_setup_command',
	'done',
]

const stageLabels: Record<SetupStage, string> = {
	setup_requested: 'Queued',
	checking_source: 'Check source',
	cloning_source: 'Clone source',
	refreshing_source: 'Refresh source',
	resolving_commit: 'Resolve commit',
	materializing: 'Worktree',
	publishing_branch: 'Publish branch',
	copying_files: 'Copy files',
	running_setup_command: 'Setup command',
	done: 'Ready',
}

const stateStyles: Record<DisplayState, string> = {
	success: 'text-[var(--terminal-success)]',
	running: 'text-[var(--terminal-success)]',
	queued: 'text-muted-foreground',
	failed: 'text-destructive',
	skipped: 'text-amber-500',
	warning: 'text-[var(--terminal-warning)]',
}

const stateLabels: Record<DisplayState, string> = {
	success: 'Success',
	running: 'Running',
	queued: 'Queued',
	failed: 'Failed',
	skipped: 'Skipped',
	warning: 'Warning',
}

interface SetupOperation {
	readonly id: string
	readonly name: string
	readonly stages: readonly SetupStage[]
	readonly completionStage: SetupStage
	readonly detail: ReactNode
	readonly skippableStage?: 'copying_files' | 'running_setup_command'
	readonly warning?: boolean
}

const withTrailingSlash = (path: string) => (path.endsWith('/') ? path : `${path}/`)

function repositoryDisplayName(repositoryIdentity: string): string {
	const parts = repositoryIdentity.replace(/^\/+|\/+$/g, '').split('/')
	return parts.length > 2 ? parts.slice(1).join('/') : parts.join('/')
}

function repositoryOperations(repository: Repository): readonly SetupOperation[] {
	const setup = repository.status
	const sourcePreference =
		setup.sourcePolicy === 'filesystem_required'
			? 'Existing checkout'
			: setup.sourcePolicy === 'managed_clone'
				? 'Managed clone'
				: 'Legacy automatic selection'
	const sourceDetail = (
		<span className="space-y-0.5">
			<span className="block">Source preference: {sourcePreference}</span>
			<span className="block">
				Selected source:{' '}
				{setup.sourcePath ??
					(setup.sourcePolicy === 'managed_clone' ? 'Managed clone pending' : 'Not selected')}
			</span>
		</span>
	)
	const copyDetail = setup.copyResult
		? setup.copyResult.copiedFiles.length > 0
			? setup.copyResult.copiedFiles.join(', ')
			: 'No files copied'
		: repository.repository.copyGlobs.length > 0
			? repository.repository.copyGlobs.join(', ')
			: 'No files configured'
	const setupCommand = setup.setupCommandResult?.command ?? repository.repository.setupCommand
	const operations: SetupOperation[] = [
		{
			id: 'source',
			name: 'Source repository',
			stages: ['checking_source', 'cloning_source', 'refreshing_source'],
			completionStage: 'refreshing_source',
			detail: sourceDetail,
		},
		{
			id: 'commit',
			name: 'Resolve commit',
			stages: ['resolving_commit'],
			completionStage: 'resolving_commit',
			detail: setup.resolvedCommit
				? `Source ${setup.resolvedCommit.slice(0, 7)}`
				: repository.repository.defaultBranch,
		},
		{
			id: 'worktree',
			name: 'Worktree',
			stages: ['materializing'],
			completionStage: 'materializing',
			detail: setup.materialization?.path ?? 'Create worktree',
		},
	]
	if (repository.repository.autoPushBranch) {
		operations.push({
			id: 'publish',
			name: 'Publish branch',
			stages: ['publishing_branch'],
			completionStage: 'publishing_branch',
			detail:
				setup.branchPublishStatus === 'warning'
					? 'The branch could not be pushed. Setup continued.'
					: repository.repository.branch,
			warning: setup.branchPublishStatus === 'warning',
		})
	}
	operations.push(
		{
			id: 'copy',
			name: 'Copy files',
			stages: ['copying_files'],
			completionStage: 'copying_files',
			detail: copyDetail,
			skippableStage: 'copying_files',
		},
		{
			id: 'setup',
			name: 'Setup command',
			stages: ['running_setup_command'],
			completionStage: 'running_setup_command',
			detail: setupCommand || 'No command configured',
			skippableStage: 'running_setup_command',
		},
	)
	return operations
}

function operationState(repository: Repository, operation: SetupOperation): DisplayState {
	const setup = repository.status
	if (operation.skippableStage && setup.acceptedSkips.some((skip) => skip.stage === operation.skippableStage)) {
		return 'skipped'
	}
	if (setup.error && operation.stages.includes(setup.error.stage)) return 'failed'
	if (operation.warning) return 'warning'
	if (operation.stages.includes(setup.status)) return 'running'
	return setupStages.indexOf(setup.status) > setupStages.indexOf(operation.completionStage) ? 'success' : 'queued'
}

function operationDetail(repository: Repository, operation: SetupOperation): ReactNode {
	const setup = repository.status
	if (setup.error && operation.stages.includes(setup.error.stage)) {
		return [
			setup.error.message,
			setup.error.exitCode === undefined ? null : `exit ${setup.error.exitCode}`,
			setup.error.stderr,
		]
			.filter(Boolean)
			.join(' - ')
	}
	const skip = operation.skippableStage
		? setup.acceptedSkips.find((candidate) => candidate.stage === operation.skippableStage)
		: undefined
	return skip?.message ?? operation.detail
}

function StateIcon({ state }: { state: DisplayState }) {
	const className = `mt-0.5 size-4 shrink-0 ${stateStyles[state]}`
	if (state === 'success') return <Check className={className} />
	if (state === 'failed' || state === 'warning') return <AlertTriangle className={className} />
	if (state === 'running') {
		return <SyncGridAnimation variant="ring" synchronized size="xs" className={className} />
	}
	if (state === 'skipped') return <Clock3 className={className} />
	return <CircleDashed className={className} />
}

function SetupOperationRow({
	name,
	detail,
	state,
	children,
}: {
	name: ReactNode
	detail?: ReactNode
	state: DisplayState
	children?: ReactNode
}) {
	return (
		<div
			className={`flex items-start gap-2.5 border-t border-border/50 py-2 first:border-t-0 ${state === 'failed' ? 'bg-destructive/5' : ''}`}
			role={state === 'failed' ? 'alert' : undefined}
		>
			<StateIcon state={state} />
			<div className="min-w-0 flex-1">
				<div className="text-xs text-foreground">{name}</div>
				{detail ? (
					<div className={`mt-0.5 break-words text-[11px] [overflow-wrap:anywhere] ${stateStyles[state]}`}>
						{detail}
					</div>
				) : null}
				{children}
			</div>
			<span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] ${stateStyles[state]}`}>
				{stateLabels[state]}
			</span>
		</div>
	)
}

function RepositorySuffix({ repository }: { repository: Repository }) {
	const setup = repository.status
	const skipped = setup.acceptedSkips.length > 0
	const warning = setup.branchPublishStatus === 'warning'
	let style = stateStyles.running
	if (setup.error) style = stateStyles.failed
	else if (setup.status === 'done') style = stateStyles.success
	else if (setup.status === 'setup_requested') style = stateStyles.queued
	const className = `flex items-center gap-1 whitespace-nowrap font-mono text-[10px] ${style}`
	if (setup.error) {
		return (
			<span className={className}>
				<AlertTriangle className="size-3" />
				Failed
			</span>
		)
	}
	if (setup.status === 'done') {
		return (
			<span className={className}>
				<Check className="size-3" />
				Ready{warning ? ' · warning' : skipped ? ' · skipped' : ''}
			</span>
		)
	}
	if (setup.status === 'setup_requested') {
		return (
			<span className={className}>
				<CircleDashed className="size-3" />
				Queued
			</span>
		)
	}
	return (
		<span className={className}>
			<SyncGridAnimation variant="ring" synchronized size="xs" className="text-[var(--terminal-success)]" />
			{stageLabels[setup.status]}
		</span>
	)
}

function RepositoryDetails({
	repository,
	mutationsEnabled,
	busy,
	onRetry,
	onSkip,
	onChooseSource = () => undefined,
	onSwitchToManaged = () => undefined,
}: {
	repository: Repository
	mutationsEnabled: boolean
	busy: boolean
	onRetry: () => void
	onSkip: () => void
	onChooseSource: () => void
	onSwitchToManaged: () => void
}) {
	const operations = repositoryOperations(repository).map((operation) => ({
		...operation,
		state: operationState(repository, operation),
	}))
	const completed = operations.filter((operation) => ['success', 'skipped', 'warning'].includes(operation.state))
	const active = operations.filter((operation) => operation.state === 'running' || operation.state === 'failed')
	const canRecoverRequiredFilesystemSource =
		repository.status.sourcePolicy === 'filesystem_required' &&
		repository.status.status === 'checking_source' &&
		repository.status.error?.stage === 'checking_source'
	if (active.length === 0 && completed.every((operation) => operation.state === 'success')) return null

	return (
		<div className="mt-1.5 ml-5 border-l border-border/60 pl-3">
			{completed.length > 0 ? (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[10px]">
					{completed.map((operation) => (
						<span
							key={operation.id}
							className={`inline-flex items-center gap-1 ${stateStyles[operation.state]}`}
						>
							{operation.state === 'success' ? (
								<Check className="size-2.5" />
							) : (
								<Clock3 className="size-2.5" />
							)}
							{operation.name}
							{operation.state === 'skipped'
								? ' skipped'
								: operation.state === 'warning'
									? ' warning'
									: ''}
						</span>
					))}
				</div>
			) : null}
			{active.map((operation) => (
				<SetupOperationRow
					key={operation.id}
					name={operation.name}
					detail={operationDetail(repository, operation)}
					state={operation.state}
				>
					{operation.state === 'failed' ? (
						<div className="mt-2 flex flex-wrap gap-1.5">
							{canRecoverRequiredFilesystemSource ? (
								<>
									<Button
										size="sm"
										className="h-7 rounded-none px-2.5 text-xs"
										disabled={!mutationsEnabled || busy}
										onClick={onChooseSource}
									>
										Choose another folder
									</Button>
									<Button
										variant="outline"
										size="sm"
										className="h-7 rounded-none px-2.5 text-xs"
										disabled={!mutationsEnabled || busy}
										onClick={onSwitchToManaged}
									>
										{busy ? 'Switching...' : 'Switch to managed clone'}
									</Button>
								</>
							) : (
								<Button
									size="sm"
									className="h-7 rounded-none px-2.5 text-xs"
									disabled={!mutationsEnabled || busy}
									onClick={onRetry}
								>
									{busy ? 'Retrying...' : 'Retry'}
								</Button>
							)}
							{operation.skippableStage ? (
								<Button
									variant="outline"
									size="sm"
									className="h-7 rounded-none px-2.5 text-xs"
									disabled={!mutationsEnabled || busy}
									onClick={onSkip}
								>
									{busy ? 'Skipping...' : 'Skip step'}
								</Button>
							) : null}
						</div>
					) : null}
				</SetupOperationRow>
			))}
		</div>
	)
}

export function ProjectWorkspaceTab({
	status,
	mutationsEnabled,
	mutationsDisabledMessage,
	busyRepositoryKey,
	ownersByUserId,
	onRetry,
	onSkip,
	onChooseSource = () => undefined,
	onSwitchToManaged = () => undefined,
}: {
	status: WorkspaceStatus
	mutationsEnabled: boolean
	mutationsDisabledMessage?: string
	busyRepositoryKey: string | null
	ownersByUserId: ReadonlyMap<string, WorkspaceOwnerDisplay>
	onRetry: (repository: Repository) => void
	onSkip: (repository: Repository) => void
	onChooseSource?: (repository: Repository) => void
	onSwitchToManaged?: (repository: Repository) => void
}) {
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto">
			{!mutationsEnabled ? (
				<p className="border border-border/70 px-3 py-2 text-xs text-muted-foreground">
					{mutationsDisabledMessage ?? 'Setup status remains visible, but recovery actions are unavailable.'}
				</p>
			) : null}
			{status.materializations.map((materialization) => {
				const hostLabel = materialization.hostName?.trim() || `Host ${materialization.hostId.slice(0, 6)}`
				const owner = ownersByUserId.get(materialization.userId) ?? {
					name: materialization.userId.slice(0, 8),
					initials: '?',
				}
				const repositoryByNodeId = new Map(
					materialization.repositories.map((repository) => [
						projectWorkspaceRepositoryKey(repository),
						repository,
					]),
				)
				const nodes: WorkspaceTreeNode[] = [
					{
						id: 'workspace-root',
						label: withTrailingSlash(materialization.location.filePath),
						kind: 'root',
					},
					...materialization.repositories.map((repository) => ({
						id: projectWorkspaceRepositoryKey(repository),
						label: repositoryDisplayName(repository.status.repositoryIdentity),
						primary: repository.repository.default,
						kind: 'repo' as const,
					})),
				]
				const rawState = JSON.stringify(
					{ workspace: status.workspace, materialization },
					(_key, value) => (typeof value === 'bigint' ? value.toString() : value),
					2,
				)
				return (
					<section
						key={`${materialization.userId}:${materialization.hostId}`}
						aria-label={`Workspace on ${hostLabel}`}
						className="min-w-0"
					>
						<header className="flex items-center gap-2.5 border border-border/70 bg-muted/30 px-2.5 py-2">
							<Avatar className="size-7 shrink-0 border border-border" title={owner.name}>
								<AvatarImage src={owner.profilePictureUrl ?? ''} alt={owner.name} />
								<AvatarFallback className="text-xs">{owner.initials}</AvatarFallback>
							</Avatar>
							<Monitor className="size-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden />
							<div className="min-w-0 flex-1">
								<div className="truncate font-mono text-xs font-medium text-foreground">
									{hostLabel}
								</div>
								<div className="truncate font-mono text-[10px] text-muted-foreground">
									{status.workspace.name}
								</div>
							</div>
							<code className="shrink-0 text-xs text-muted-foreground" title={materialization.hostId}>
								{materialization.hostId.slice(0, 6)}
							</code>
						</header>
						<div className="ml-[13px] border-l border-border/70 pb-1 pl-3 pt-3">
							<WorkspaceTabPure
								nodes={nodes}
								rawState={rawState}
								onCopyNode={(node) =>
									void navigator.clipboard?.writeText(node.label.replace(/\/$/, ''))
								}
								renderRepoSuffix={(node) => {
									const repository = repositoryByNodeId.get(node.id)
									return repository ? <RepositorySuffix repository={repository} /> : null
								}}
								renderRepoDetails={(node) => {
									const repository = repositoryByNodeId.get(node.id)
									if (!repository) return null
									return (
										<RepositoryDetails
											repository={repository}
											mutationsEnabled={mutationsEnabled}
											busy={busyRepositoryKey === projectWorkspaceRepositoryKey(repository)}
											onRetry={() => onRetry(repository)}
											onSkip={() => onSkip(repository)}
											onChooseSource={() => onChooseSource(repository)}
											onSwitchToManaged={() => onSwitchToManaged(repository)}
										/>
									)
								}}
								className="h-auto shrink-0"
							/>
						</div>
					</section>
				)
			})}
		</div>
	)
}
