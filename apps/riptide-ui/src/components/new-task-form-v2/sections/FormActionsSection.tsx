/**
 * FormActionsSection.tsx
 *
 * Section component for submit button, cancel, and operations progress.
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Internalizes:
 * - Host availability from useLiveQuery
 * - workspaceNowBlocked/hasDeselectedAllWorkspaceRepos computed from store state
 * - Workspace eligibility checking
 *
 * Props that must be passed in:
 * - displayName: Derived from ticket/AI in parent
 * - canLaunchDaemon/onLaunchDaemon: From useLaunchDaemon (complex setup)
 * - All operation callbacks: Need parent orchestration
 */

import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { useAuth } from '@workos-inc/authkit-react'
import type { FC } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useWatch } from 'react-hook-form'

import { LaunchDaemonEntryPoint } from '@/components/launch-daemon/LaunchDaemonEntryPoint'
import { LaunchDaemonModal } from '@/components/launch-daemon/LaunchDaemonModal'
import { type OperationStatus, OperationStatusRow } from '@/components/OperationStatusRow'
import { type ResolutionHint, useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { useLaunchDaemon } from '@/hooks/use-launch-daemon'
import { useWorkspaceConfigLoadState, useWorkspaceRepoSelection } from '@/hooks/use-workspace-config-state'
import { getWorkspaceNowExecutionMode } from '@/lib/new-task-form-helpers'
import { isElectron, isTauri } from '@/lib/utils'
import { checkWorkspaceNowEligibility } from '@/lib/workspace-config'
import { useRiptideApi } from '@/orpc/client'

import type { WorkspaceTiming } from './shared'

// --- SubmitOperationsProgress component ---

interface SubmitOperationsProgressProps {
	operations: Array<{
		id: string
		name: string
		status: OperationStatus
		errorMessage?: string
		resolutionHint?: ResolutionHint
		command?: string
		scope?: 'task' | 'session' | 'workspace'
	}>
	onCreateTaskRetry: () => void
	onOperationRetry: (opId: string) => void
	onWorkspaceOperationRetry: (opId: string) => void
	onOperationSkip: (opId: string) => void
	onOperationProceedAnyway: (opId: string) => void
	onOperationRemoveAll: (opId: string) => void
	onReset: () => void
	onSkipToTask: () => void
	showSkipToTask: boolean
}

const SubmitOperationsProgress: FC<SubmitOperationsProgressProps> = ({
	operations,
	onCreateTaskRetry,
	onOperationRetry,
	onWorkspaceOperationRetry,
	onOperationSkip,
	onOperationProceedAnyway,
	onOperationRemoveAll,
	onReset,
	onSkipToTask,
	showSkipToTask,
}) => {
	const progressCardRef = useRef<HTMLDivElement | null>(null)
	const hasScrolledToProgressRef = useRef(false)

	const handleProgressCardRef = useCallback((node: HTMLDivElement | null) => {
		progressCardRef.current = node

		if (!node) {
			hasScrolledToProgressRef.current = false
			return
		}

		if (hasScrolledToProgressRef.current) return
		hasScrolledToProgressRef.current = true

		requestAnimationFrame(() => {
			node.scrollIntoView({ behavior: 'smooth', block: 'start' })
		})
	}, [])

	if (operations.length === 0) return null

	const groupedOperations = operations.reduce(
		(groups, op) => {
			const scope = op.scope ?? (op.id.startsWith('ws-') ? 'workspace' : 'task')
			groups[scope].push(op)
			return groups
		},
		{ workspace: [] as typeof operations, task: [] as typeof operations, session: [] as typeof operations },
	)

	const sections = [
		{ key: 'workspace' as const, title: 'Workspace setup', operations: groupedOperations.workspace },
		{ key: 'task' as const, title: 'Task creation', operations: groupedOperations.task },
		{ key: 'session' as const, title: 'Session launch', operations: groupedOperations.session },
	].filter((section) => section.operations.length > 0)

	return (
		<Card ref={handleProgressCardRef} className="mt-4 scroll-mt-4">
			<CardHeader className="pt-4 pb-0">
				<div className="flex items-center justify-between gap-3">
					<CardTitle className="text-sm">Setting up task</CardTitle>
					<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
						<span className="relative flex size-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
							<span className="relative inline-flex size-2 rounded-full bg-current" />
						</span>
						Stay on this page
					</div>
				</div>
				<p className="pt-1 text-xs text-muted-foreground">
					Task setup is running. Keep this page open until the steps finish.
				</p>
			</CardHeader>
			<CardContent className="space-y-4 pb-4">
				{sections.map((section) => (
					<div key={section.key} className="space-y-2">
						<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
							{section.title}
						</p>
						<div className="space-y-0 divide-y border rounded-md px-4">
							{section.operations.map((op) => {
								const isWorkspaceOp = op.id.startsWith('ws-')
								const isWorkspaceSetupOp = op.id.startsWith('ws-setup-')
								const isCreateTaskOp = op.id === 'create-task'
								const hasError = op.status === 'error'

								return (
									<div key={op.id}>
										<OperationStatusRow
											name={op.name}
											status={op.status}
											errorMessage={op.errorMessage}
											resolutionHint={op.resolutionHint}
											command={op.command}
											onRetry={
												hasError && !isWorkspaceOp && !isCreateTaskOp
													? () => onOperationRetry(op.id)
													: undefined
											}
											onSkip={
												hasError && !isWorkspaceOp && !isCreateTaskOp
													? () => onOperationSkip(op.id)
													: undefined
											}
										/>
										{hasError && isCreateTaskOp && (
											<div className="flex gap-2 pb-2 pl-2">
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={onCreateTaskRetry}
													className="text-xs h-7"
												>
													Retry
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => onOperationSkip(op.id)}
													className="text-xs h-7"
												>
													Skip
												</Button>
											</div>
										)}
										{/* Workspace setup failure actions */}
										{hasError && isWorkspaceSetupOp && (
											<div className="flex gap-2 pb-2 pl-2">
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => onWorkspaceOperationRetry(op.id)}
													className="text-xs h-7"
												>
													Retry
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => onOperationProceedAnyway(op.id)}
													className="text-xs h-7"
												>
													Proceed Anyway
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => onOperationRemoveAll(op.id)}
													className="text-xs h-7 text-destructive border-destructive/30 hover:bg-destructive/10"
												>
													Remove All Worktrees
												</Button>
											</div>
										)}
										{/* Other workspace errors */}
										{hasError && isWorkspaceOp && !isWorkspaceSetupOp && (
											<div className="flex gap-2 pb-2 pl-2">
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={onReset}
													className="text-xs h-7"
												>
													Reset
												</Button>
											</div>
										)}
									</div>
								)
							})}
						</div>
					</div>
				))}
				{showSkipToTask && (
					<div className="pt-2">
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={onSkipToTask}
							className="text-muted-foreground p-0 h-auto"
						>
							Skip to Task {'->'}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

// --- Main section component ---

export interface FormActionsSectionProps {
	// Form state (derived from ticket/AI in parent)
	displayName: string
	linearLookupBlocked?: boolean
	creationBlockedReason?: string | null

	// Actions
	onSubmit: () => void
	onCancel: () => void

	// Operations progress
	onCreateTaskRetry: () => void
	onOperationRetry: (opId: string) => void
	onWorkspaceOperationRetry: (opId: string) => void
	onOperationSkip: (opId: string) => void
	onOperationProceedAnyway: (opId: string) => void
	onOperationRemoveAll: (opId: string) => void
	onReset: () => void
	onSkipToTask: () => void
}

export const FormActionsSection: FC<FormActionsSectionProps> = ({
	displayName,
	linearLookupBlocked = false,
	creationBlockedReason = null,
	onSubmit,
	onCancel,
	onCreateTaskRetry,
	onOperationRetry,
	onWorkspaceOperationRetry,
	onOperationSkip,
	onOperationProceedAnyway,
	onOperationRemoveAll,
	onReset,
	onSkipToTask,
}) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)
	const launchModalOpen = useNewTaskFormStore((s) => s.launchModalOpen)
	const setLaunchModalOpen = useNewTaskFormStore((s) => s.setLaunchModalOpen)

	// Effective host (shared derivation)
	const { hostId, hasHosts: hostAvailable, isRemoteHost } = useEffectiveHost()

	// Launch daemon setup
	const { user, organizationId } = useAuth()
	const { client } = useRiptideApi()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const daemonDrivenWorkspaceSetupEnabled = useSettingsStore((s) => s.daemonDrivenWorkspaceSetupEnabled)
	const workspaceNowExecutionMode = getWorkspaceNowExecutionMode(daemonDrivenWorkspaceSetupEnabled)
	const launchDaemon = useLaunchDaemon({
		syncMode: syncForceMode,
		tokenFactory: (id) => client.auth.daemon.token.create({ hostId: id }),
		userId: user?.id ?? null,
		organizationId: organizationId ?? null,
	})

	const directory = useWatch({ control: form?.control, name: 'directory' })
	const workspaceTiming = useWatch({ control: form?.control, name: 'workspaceTiming' }) as WorkspaceTiming | undefined

	// Workspace config load state + repo selection (deduped React Query + derived prefs)
	const workspaceConfigLoadState = useWorkspaceConfigLoadState(directory ?? '')
	const { excludedLocalPaths } = useWorkspaceRepoSelection(workspaceConfigLoadState, directory ?? '')

	// Derive workspace config state
	const effectiveWorkspaceConfig =
		workspaceConfigLoadState.status === 'ready' ? workspaceConfigLoadState.config : null

	// Compute workspace eligibility
	const workspaceNowEligibility = useMemo(
		() =>
			checkWorkspaceNowEligibility({
				isRemoteHost,
				isTauri: isTauri() || isElectron(),
				config: workspaceConfigLoadState.status === 'loading' ? null : effectiveWorkspaceConfig,
				executionMode: workspaceNowExecutionMode,
			}),
		[isRemoteHost, effectiveWorkspaceConfig, workspaceConfigLoadState.status, workspaceNowExecutionMode],
	)

	// Compute blocking states
	const workspaceNowBlocked = workspaceTiming === 'now' && !workspaceNowEligibility.eligible
	const selectedWorkspaceRepoCount = effectiveWorkspaceConfig
		? effectiveWorkspaceConfig.repos.filter((repo) => !excludedLocalPaths.has(repo.localPath)).length
		: 0
	const hasDeselectedAllWorkspaceRepos =
		workspaceTiming === 'now' &&
		workspaceNowEligibility.eligible &&
		(effectiveWorkspaceConfig?.repos.length ?? 0) > 1 &&
		selectedWorkspaceRepoCount === 0

	if (!form) return null

	const isSubmitting = submitState.isSubmitting
	const operations = submitState.operations
	const showSkipToTask = !!submitState.createdTaskId && submitState.isSubmitting

	const submitDisabled =
		!displayName?.trim() ||
		!directory?.trim() ||
		!hostId ||
		isSubmitting ||
		workspaceNowBlocked ||
		hasDeselectedAllWorkspaceRepos ||
		linearLookupBlocked ||
		Boolean(creationBlockedReason)

	return (
		<>
			{/* Host warning */}
			{!hostAvailable && (
				<div className="flex items-center gap-2 text-sm text-destructive">
					<span>No hosts available. Please start a daemon first.</span>
					{launchDaemon.canLaunch && (
						<LaunchDaemonEntryPoint onClick={() => setLaunchModalOpen(true)} variant="link" />
					)}
				</div>
			)}

			{/* Actions */}
			{creationBlockedReason && (
				<p className="text-right text-xs text-muted-foreground">{creationBlockedReason}</p>
			)}
			<div className="flex justify-end gap-2 pt-4">
				<Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
					Cancel
					<KeyboardShortcut className="ml-2">Esc</KeyboardShortcut>
				</Button>
				<Button onClick={onSubmit} disabled={submitDisabled}>
					{isSubmitting ? 'Creating...' : 'Create Task'}
					<KeyboardShortcut className="ml-2">⌘+Enter</KeyboardShortcut>
				</Button>
			</div>

			{/* Inline operations progress during submit */}
			<SubmitOperationsProgress
				operations={operations}
				onCreateTaskRetry={onCreateTaskRetry}
				onOperationRetry={onOperationRetry}
				onWorkspaceOperationRetry={onWorkspaceOperationRetry}
				onOperationSkip={onOperationSkip}
				onOperationProceedAnyway={onOperationProceedAnyway}
				onOperationRemoveAll={onOperationRemoveAll}
				onReset={onReset}
				onSkipToTask={onSkipToTask}
				showSkipToTask={showSkipToTask}
			/>

			<LaunchDaemonModal
				open={launchModalOpen}
				onOpenChange={(open) => {
					setLaunchModalOpen(open)
					if (!open) launchDaemon.reset()
				}}
				state={launchDaemon.state}
				onLaunch={launchDaemon.launch}
				onReset={launchDaemon.reset}
				canLaunch={launchDaemon.canLaunch}
				isRunning={launchDaemon.isRunning}
			/>
		</>
	)
}
