import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { WorkspaceSetupStage, WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { AlertTriangle, Check, Circle, CircleDashed, Clock3, Stethoscope } from 'lucide-react'
import type { ReactNode } from 'react'

const STAGES: WorkspaceSetupStage[] = [
	'setup_requested',
	'preflight',
	'worktree',
	'copy_globs',
	'setup_command',
	'done',
]

type DisplayState = 'success' | 'running' | 'queued' | 'failed' | 'skipped'

const stateStyles: Record<DisplayState, string> = {
	success: 'text-[var(--terminal-success)]',
	running: 'text-[var(--terminal-success)]',
	queued: 'text-muted-foreground',
	failed: 'text-destructive',
	skipped: 'text-amber-500',
}

const stateLabels: Record<DisplayState, string> = {
	success: 'Success',
	running: 'Running',
	queued: 'Queued',
	failed: 'Failed',
	skipped: 'Skipped',
}

function stageIndex(stage: WorkspaceSetupStage): number {
	return STAGES.indexOf(stage)
}

function repoStageState(
	row: TaskWorkspaceSetupForHost,
	localPath: string,
	repoStatus: WorkspaceSetupStage,
	stage: 'preflight' | 'worktree' | 'copy_globs' | 'setup_command',
): DisplayState {
	const skip = row.workspace_setup_state.acceptedSkips?.some(
		(candidate) => candidate.localPath === localPath && candidate.stage === stage,
	)
	if (skip) return 'skipped'
	if (row.error?.localPath === localPath && row.error.stage === stage) return 'failed'
	if (stageIndex(repoStatus) > stageIndex(stage)) return 'success'
	if (repoStatus === stage) return 'running'
	return 'queued'
}

const stageLabels: Record<WorkspaceSetupStage, string> = {
	setup_requested: 'Queued',
	preflight: 'Preflight',
	worktree: 'Worktree',
	copy_globs: 'Copy files',
	setup_command: 'Setup command',
	done: 'Ready',
}

export function WorkspaceSetupRepoSuffix({ row, localPath }: { row: TaskWorkspaceSetupForHost; localPath: string }) {
	const repo = row.workspace_setup_state.repos.find((candidate) => candidate.localPath === localPath)
	if (!repo) return null
	const skipped = row.workspace_setup_state.acceptedSkips?.some((candidate) => candidate.localPath === localPath)
	const failed = row.error?.localPath === localPath
	let style = stateStyles.running
	if (failed) style = stateStyles.failed
	else if (repo.status === 'done') style = stateStyles.success
	else if (repo.status === 'setup_requested') style = stateStyles.queued
	const className = `flex items-center gap-1 whitespace-nowrap font-mono text-[10px] ${style}`
	if (failed)
		return (
			<span className={className}>
				<AlertTriangle className="size-3" />
				Failed
			</span>
		)
	if (repo.status === 'done')
		return (
			<span className={className}>
				<Check className="size-3" />
				Ready{skipped ? ' · skipped' : ''}
			</span>
		)
	if (repo.status === 'setup_requested')
		return (
			<span className={className}>
				<CircleDashed className="size-3" />
				Queued
			</span>
		)
	return (
		<span className={className}>
			<SyncGridAnimation variant="ring" synchronized size="xs" className="text-[var(--terminal-success)]" />
			{stageLabels[repo.status]}
			{skipped ? ' · skipped' : ''}
		</span>
	)
}

function StateIcon({ state }: { state: DisplayState }) {
	const className = `mt-0.5 size-4 shrink-0 ${stateStyles[state]}`
	if (state === 'success') return <Check className={className} />
	if (state === 'failed') return <AlertTriangle className={className} />
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
	alert = false,
}: {
	name: ReactNode
	detail?: ReactNode
	state: DisplayState
	children?: ReactNode
	alert?: boolean
}) {
	return (
		<div
			className={`flex items-start gap-2.5 border-t border-border/50 py-2 first:border-t-0 ${alert ? 'bg-destructive/5' : ''}`}
			role={alert ? 'alert' : undefined}
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

function FailureActions({
	canSkip,
	busyAction,
	onRetry,
	onSkip,
	onDiagnose,
	onChangeRepositoryDirectory,
}: Pick<WorkspaceSetupCardProps, 'busyAction' | 'onRetry' | 'onSkip' | 'onDiagnose' | 'onChangeRepositoryDirectory'> & {
	canSkip: boolean
}) {
	if (!onRetry && !onSkip && !onDiagnose && !onChangeRepositoryDirectory) return null
	return (
		<div className="mt-2 flex flex-wrap gap-1.5">
			{onRetry ? (
				<Button size="sm" className="h-7 rounded-none px-2.5 text-xs" onClick={onRetry} disabled={!!busyAction}>
					{busyAction === 'retry' ? 'Retrying...' : 'Retry'}
				</Button>
			) : null}
			{canSkip && onSkip ? (
				<Button
					size="sm"
					variant="outline"
					className="h-7 rounded-none px-2.5 text-xs"
					onClick={onSkip}
					disabled={!!busyAction}
				>
					{busyAction === 'skip' ? 'Skipping...' : 'Skip step'}
				</Button>
			) : null}
			{onChangeRepositoryDirectory ? (
				<Button
					size="sm"
					variant="outline"
					className="h-7 rounded-none px-2.5 text-xs"
					onClick={onChangeRepositoryDirectory}
					disabled={!!busyAction}
				>
					Choose another folder
				</Button>
			) : null}
			{onDiagnose ? (
				<Button size="sm" variant="ghost" className="h-7 rounded-none px-2.5 text-xs" onClick={onDiagnose}>
					<Stethoscope className="mr-1.5 size-3.5" />
					Diagnose
				</Button>
			) : null}
		</div>
	)
}

export function WorkspaceSetupRepoDetails({
	row,
	localPath,
	workspaceSpec,
	busyAction,
	onRetry,
	onSkip,
	onDiagnose,
	onChangeRepositoryDirectory,
}: WorkspaceSetupCardProps & { localPath: string }) {
	const repo = row.workspace_setup_state.repos.find((candidate) => candidate.localPath === localPath)
	if (!repo) return null
	const error = row.error
	const specRepo = workspaceSpec?.repos.find((candidate) => candidate.localPath === localPath)
	const command =
		repo.setupCommand?.command ??
		specRepo?.setupCommand ??
		(error?.localPath === localPath ? error.command : undefined)
	const operations = [
		{
			stage: 'preflight' as const,
			name: 'Preflight',
			detail: repo.preflight?.resolvedSourceCommit
				? `Source ${repo.preflight.resolvedSourceCommit.slice(0, 7)}`
				: 'Resolve source commit',
		},
		{ stage: 'worktree' as const, name: 'Worktree', detail: repo.worktree?.targetPath ?? 'Create worktree' },
		{
			stage: 'copy_globs' as const,
			name: 'Copy files',
			detail: repo.copyGlobs?.filesCopied?.length ? repo.copyGlobs.filesCopied.join(', ') : 'No files copied',
		},
		{ stage: 'setup_command' as const, name: 'Setup command', detail: command ?? 'No command configured' },
	]
	const operationStates = operations.map((operation) => ({
		...operation,
		state: repoStageState(row, localPath, repo.status, operation.stage),
	}))
	const completedSummary = operationStates
		.filter((operation) => operation.state === 'success' || operation.state === 'skipped')
		.map((operation) => {
			if (operation.stage === 'preflight' && repo.preflight?.resolvedSourceCommit) {
				return {
					...operation,
					summary: `${operation.state === 'skipped' ? 'Skipped' : 'Preflight'} ${repo.preflight.resolvedSourceCommit.slice(0, 7)}`,
				}
			}
			if (operation.stage === 'copy_globs') {
				const count = repo.copyGlobs?.filesCopied?.length ?? 0
				return {
					...operation,
					summary:
						operation.state === 'skipped' ? 'Copy skipped' : `${count} ${count === 1 ? 'file' : 'files'}`,
				}
			}
			return {
				...operation,
				summary: operation.state === 'skipped' ? `${operation.name} skipped` : operation.name,
			}
		})
	const activeOperations = operationStates.filter(
		(operation) => operation.state === 'running' || operation.state === 'failed',
	)
	return (
		<div className="mt-1.5 ml-5 border-l border-border/60 pl-3">
			{completedSummary.length > 0 ? (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[10px]">
					{completedSummary.map((operation) => (
						<span
							key={operation.stage}
							className={`inline-flex items-center gap-1 ${stateStyles[operation.state]}`}
						>
							{operation.state === 'skipped' ? (
								<Clock3 className="size-2.5" />
							) : (
								<Check className="size-2.5" />
							)}
							{operation.summary}
						</span>
					))}
				</div>
			) : null}
			{activeOperations.map((operation) => {
				const failed = operation.state === 'failed'
				const skip = row.workspace_setup_state.acceptedSkips?.find(
					(candidate) => candidate.localPath === localPath && candidate.stage === operation.stage,
				)
				const detail = failed
					? `${error?.message}${error?.exitCode !== undefined ? ` - exit ${error.exitCode}` : ''}${error?.stderr ? ` - ${error.stderr}` : ''}`
					: (skip?.errorMessage ?? operation.detail)
				return (
					<SetupOperationRow
						key={operation.stage}
						name={operation.name}
						detail={detail}
						state={operation.state}
						alert={failed}
					>
						{failed ? (
							<FailureActions
								canSkip={operation.stage === 'copy_globs' || operation.stage === 'setup_command'}
								busyAction={busyAction}
								onRetry={onRetry}
								onSkip={onSkip}
								onDiagnose={onDiagnose}
								onChangeRepositoryDirectory={
									operation.stage === 'preflight' ? onChangeRepositoryDirectory : undefined
								}
							/>
						) : null}
					</SetupOperationRow>
				)
			})}
		</div>
	)
}

export interface WorkspaceSetupCardProps {
	row: TaskWorkspaceSetupForHost
	hostName?: string | null
	workspaceSpec?: WorkspaceSpec | null
	hasSession?: boolean
	setupBlocksFirstSession?: boolean
	busyAction?: 'retry' | 'skip' | 'updateRepositoryDirectory' | null
	onRetry?: () => void
	onSkip?: () => void
	onDiagnose?: () => void
	onChangeRepositoryDirectory?: () => void
}

export function WorkspaceSetupCard({
	row,
	hostName,
	workspaceSpec,
	hasSession = false,
	setupBlocksFirstSession = false,
	busyAction,
	onRetry,
	onSkip,
	onDiagnose,
	onChangeRepositoryDirectory,
}: WorkspaceSetupCardProps) {
	const error = row.error
	const repos = row.workspace_setup_state.repos

	return (
		<Card className="min-w-0 shrink-0 rounded-none border-border/80 bg-card/95 shadow-none">
			<CardHeader className="gap-1.5 px-3 pb-2 pt-3">
				<div className="min-w-0 space-y-1.5">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<CardTitle className="font-mono text-xs uppercase tracking-[0.12em]">Workspace setup</CardTitle>
						<Badge
							variant={error ? 'destructive' : 'secondary'}
							className="rounded-none text-[10px] uppercase"
						>
							{error ? 'Needs attention' : row.status === 'setup_requested' ? 'Queued' : 'Converging'}
						</Badge>
					</div>
					<div className="min-w-0 font-mono text-[10px] text-muted-foreground">
						<div className="truncate" title={hostName ?? row.host_id}>
							{repos.length} {repos.length === 1 ? 'repo' : 'repos'} - {hostName ?? row.host_id}
						</div>
						{workspaceSpec?.workspaceBaseDirectory ? (
							<div className="truncate" title={workspaceSpec.workspaceBaseDirectory}>
								{workspaceSpec.workspaceBaseDirectory}
							</div>
						) : null}
					</div>
				</div>
			</CardHeader>
			<CardContent className="min-w-0 px-3 pb-3">
				<div className="space-y-3">
					{repos.map((repo) => {
						const specRepo = workspaceSpec?.repos.find(
							(candidate) => candidate.localPath === repo.localPath,
						)
						const command =
							repo.setupCommand?.command ??
							specRepo?.setupCommand ??
							(error?.localPath === repo.localPath ? error.command : undefined)
						const operations = [
							{
								stage: 'preflight' as const,
								name: 'Preflight',
								detail: repo.preflight?.resolvedSourceCommit
									? `Source ${repo.preflight.resolvedSourceCommit.slice(0, 7)}`
									: 'Resolve source commit',
							},
							{
								stage: 'worktree' as const,
								name: 'Worktree',
								detail: repo.worktree?.targetPath ?? 'Create worktree',
							},
							{
								stage: 'copy_globs' as const,
								name: 'Copy files',
								detail: repo.copyGlobs?.filesCopied?.length
									? repo.copyGlobs.filesCopied.join(', ')
									: 'No files copied',
							},
							{
								stage: 'setup_command' as const,
								name: 'Setup command',
								detail: command ?? 'No command configured',
							},
						]
						return (
							<section key={repo.localPath} aria-label={`${repo.localPath} setup`}>
								<div className="border-b border-border/70 pb-1 font-mono text-xs text-foreground">
									{repo.localPath}
								</div>
								{operations.map((operation) => {
									const state = repoStageState(row, repo.localPath, repo.status, operation.stage)
									const failed = state === 'failed'
									const skip = row.workspace_setup_state.acceptedSkips?.find(
										(candidate) =>
											candidate.localPath === repo.localPath &&
											candidate.stage === operation.stage,
									)
									const detail = failed
										? `${error?.message}${error?.exitCode !== undefined ? ` - exit ${error.exitCode}` : ''}${error?.stderr ? ` - ${error.stderr}` : ''}`
										: (skip?.errorMessage ?? operation.detail)
									return (
										<SetupOperationRow
											key={operation.stage}
											name={operation.name}
											detail={detail}
											state={state}
											alert={failed}
										>
											{failed ? (
												<FailureActions
													canSkip={
														operation.stage === 'copy_globs' ||
														operation.stage === 'setup_command'
													}
													busyAction={busyAction}
													onRetry={onRetry}
													onSkip={onSkip}
													onDiagnose={onDiagnose}
													onChangeRepositoryDirectory={
														operation.stage === 'preflight'
															? onChangeRepositoryDirectory
															: undefined
													}
												/>
											) : null}
										</SetupOperationRow>
									)
								})}
							</section>
						)
					})}
				</div>

				<div
					className={`mt-2 flex items-start gap-2 border px-2.5 py-2 text-[11px] ${setupBlocksFirstSession ? 'border-amber-500/40 text-amber-500' : 'border-accent/40 text-accent'}`}
				>
					<Circle className="mt-0.5 size-2.5 shrink-0 fill-current" />
					{!hasSession
						? 'Workspace setup is running independently. No session has started.'
						: setupBlocksFirstSession
							? 'Sessions wait until every workspace setup step finishes.'
							: 'Sessions can start as soon as all worktrees exist.'}
				</div>
			</CardContent>
		</Card>
	)
}
