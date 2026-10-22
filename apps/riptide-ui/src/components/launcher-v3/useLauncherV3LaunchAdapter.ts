import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useMountEffect } from '@/hooks/useMountEffect'
import { isRepositorySourcesRequiredError } from '@/lib/repository-sources'
import { getTaskCreationError } from '@/lib/task-creation-error'
import type { LauncherV3Command } from '@/modules/launcher-v3/launcher-v3-form'
import {
	launchTask,
	type LauncherV3LaunchDependencies,
	type LauncherV3LaunchResult,
	type LauncherV3NavigationTarget,
	type LauncherV3Operation,
} from '@/modules/launcher-v3/launcher-v3-launch'

import type { LauncherV3DraftLifecycle } from './drafts/useLauncherV3DraftController'
import type {
	LauncherProgressOperation,
	LauncherProgressOperationStatus,
	LauncherProgressRecovery,
	LauncherV3Operations,
} from './progress/LauncherProgress'

type LaunchExecutionDependencies = Omit<LauncherV3LaunchDependencies, 'operations'>

export interface LauncherV3LaunchAdapterDependencies extends LaunchExecutionDependencies {
	draftLifecycle: LauncherV3DraftLifecycle
	/** Resolves true when the project's repository sources still need setup. */
	repositorySourcesMissing?: (command: LauncherV3Command) => Promise<boolean>
	onRepositorySourcesRequired?: (command: LauncherV3Command) => void
	success: {
		applyOptimisticLaunch(
			command: LauncherV3Command,
			result: LauncherV3LaunchResult,
			confirmation: Promise<void>,
		): void
		rememberLaunch(command: LauncherV3Command): void
		navigate(target: LauncherV3NavigationTarget): void | Promise<void>
	}
}

interface AdapterState {
	steps: readonly LauncherProgressOperation[]
	recovery: LauncherProgressRecovery | null
}

type RecoveryAction = 'retry' | 'skip' | 'reset'

interface PendingRecoveryAction {
	allowed: ReadonlySet<RecoveryAction>
	resolve(action: RecoveryAction): void
}

interface ActiveAttempt {
	command: LauncherV3Command
	ids: {
		taskId: string
		firstSessionId: string
		firstEventId: string
	}
	cancelled: boolean
	detachedFromLauncher: boolean
	lastOperation: LauncherV3Operation | null
	pendingAction: PendingRecoveryAction | null
}

const STEP_DEFINITIONS = [
	{ id: 'building-request', name: 'Prepare launch' },
	{ id: 'creating-task', name: 'Create task' },
	{ id: 'confirming-sync', name: 'Confirm task and session sync' },
] as const

const IDLE_STATE: AdapterState = { steps: [], recovery: null }

function stepsWithStatuses(
	buildingRequest: LauncherProgressOperationStatus,
	creatingTask: LauncherProgressOperationStatus,
	confirmingSync: LauncherProgressOperationStatus,
): readonly LauncherProgressOperation[] {
	const [buildingStep, creatingStep, confirmingStep] = STEP_DEFINITIONS
	return [
		{ ...buildingStep, status: buildingRequest },
		{ ...creatingStep, status: creatingTask },
		{ ...confirmingStep, status: confirmingSync },
	]
}

function stateForOperation(operation: LauncherV3Operation): AdapterState {
	switch (operation.phase) {
		case 'building-request':
			return { steps: stepsWithStatuses('running', 'pending', 'pending'), recovery: null }
		case 'creating-task':
			return { steps: stepsWithStatuses('success', 'running', 'pending'), recovery: null }
		case 'confirming-sync':
			return { steps: stepsWithStatuses('success', 'success', 'running'), recovery: null }
		case 'complete':
			return { steps: stepsWithStatuses('success', 'success', 'success'), recovery: null }
	}
}

function definiteFailureState(operation: LauncherV3Operation | null, error: unknown): AdapterState {
	const failureIndex = operation?.phase === 'creating-task' ? 1 : operation?.phase === 'confirming-sync' ? 2 : 0
	const statuses: [
		LauncherProgressOperationStatus,
		LauncherProgressOperationStatus,
		LauncherProgressOperationStatus,
	] = ['pending', 'pending', 'pending']
	for (let index = 0; index < failureIndex; index += 1) statuses[index] = 'success'
	statuses[failureIndex] = 'error'
	return {
		steps: stepsWithStatuses(statuses[0], statuses[1], statuses[2]),
		recovery: {
			kind: 'definite-failure',
			message: getTaskCreationError(error, 'Task creation failed.').errorMessage,
		},
	}
}

function waitForRecoveryAction(attempt: ActiveAttempt, allowed: readonly RecoveryAction[]): Promise<RecoveryAction> {
	return new Promise((resolve) => {
		attempt.pendingAction = { allowed: new Set(allowed), resolve }
	})
}

/** React-owned launch loop with stable recovery identities across every retry. */
export function useLauncherV3LaunchAdapter(dependencies: LauncherV3LaunchAdapterDependencies): {
	onSubmit: (command: LauncherV3Command) => Promise<void>
	operations: LauncherV3Operations
} {
	const [state, setState] = useState<AdapterState>(IDLE_STATE)
	const activeAttemptRef = useRef<ActiveAttempt | null>(null)
	const launcherUnmountedRef = useRef(false)
	const dependenciesRef = useRef(dependencies)
	dependenciesRef.current = dependencies

	const isCurrent = useCallback(
		(attempt: ActiveAttempt) => activeAttemptRef.current === attempt && !attempt.cancelled,
		[],
	)

	const setCurrentState = useCallback(
		(attempt: ActiveAttempt, next: AdapterState) => {
			if (isCurrent(attempt) && !attempt.detachedFromLauncher) setState(next)
		},
		[isCurrent],
	)

	const completeSuccess = useCallback(
		async (
			attempt: ActiveAttempt,
			result: LauncherV3LaunchResult,
			dependenciesForAttempt: LauncherV3LaunchAdapterDependencies,
		) => {
			if (!isCurrent(attempt)) return
			let resolveOptimisticConfirmation!: () => void
			let rejectOptimisticConfirmation!: (error: unknown) => void
			const optimisticConfirmation = new Promise<void>((resolve, reject) => {
				resolveOptimisticConfirmation = resolve
				rejectOptimisticConfirmation = reject
			})
			dependenciesForAttempt.success.applyOptimisticLaunch(attempt.command, result, optimisticConfirmation)
			dependenciesForAttempt.success.rememberLaunch(attempt.command)
			const navigation = attempt.detachedFromLauncher
				? undefined
				: dependenciesForAttempt.success.navigate(result.navigation)
			const confirmation = Promise.all([
				dependenciesForAttempt.tasks.waitForTask(result.taskId, result.transactionId ?? ''),
				dependenciesForAttempt.tasks.waitForSession(result.sessionId, result.transactionId ?? ''),
			]).then(() => undefined)
			void confirmation.then(resolveOptimisticConfirmation, rejectOptimisticConfirmation)
			await navigation
			return { confirmation }
		},
		[isCurrent],
	)

	const onSubmit = useCallback(
		async (command: LauncherV3Command) => {
			if (activeAttemptRef.current) return
			const launchIdentity = dependenciesRef.current.draftLifecycle.ensureLaunchIdentity()

			const attempt: ActiveAttempt = {
				command,
				ids: {
					taskId: launchIdentity.draftId,
					firstSessionId: launchIdentity.firstSessionId,
					firstEventId: launchIdentity.firstEventId,
				},
				cancelled: false,
				detachedFromLauncher: launcherUnmountedRef.current,
				lastOperation: null,
				pendingAction: null,
			}
			const dependenciesForAttempt = dependenciesRef.current
			dependenciesForAttempt.draftLifecycle.markLaunching()
			activeAttemptRef.current = attempt

			if (dependenciesForAttempt.repositorySourcesMissing && dependenciesForAttempt.onRepositorySourcesRequired) {
				const missing = await dependenciesForAttempt.repositorySourcesMissing(command)
				attempt.detachedFromLauncher ||= launcherUnmountedRef.current
				if (missing && !attempt.detachedFromLauncher) {
					activeAttemptRef.current = null
					dependenciesForAttempt.draftLifecycle.markIdle()
					dependenciesForAttempt.onRepositorySourcesRequired(command)
					return
				}
			}

			const report = (operation: LauncherV3Operation) => {
				if (!isCurrent(attempt)) return
				attempt.lastOperation = operation
				setCurrentState(attempt, stateForOperation(operation))
			}

			try {
				while (isCurrent(attempt)) {
					dependenciesForAttempt.draftLifecycle.markLaunching()
					let result: LauncherV3LaunchResult
					try {
						result = await launchTask(
							{ command, ids: attempt.ids },
							{ tasks: dependenciesForAttempt.tasks, operations: { report } },
						)
					} catch (error) {
						if (!isCurrent(attempt)) return
						dependenciesForAttempt.draftLifecycle.markIdle()
						if (attempt.detachedFromLauncher) {
							toast.error('Could not launch task', {
								description: 'Your draft is saved on this device. Open the launcher to try again.',
							})
							return
						}
						if (
							isRepositorySourcesRequiredError(error) &&
							dependenciesForAttempt.onRepositorySourcesRequired
						) {
							setCurrentState(attempt, IDLE_STATE)
							dependenciesForAttempt.onRepositorySourcesRequired(attempt.command)
							return
						}
						setCurrentState(attempt, definiteFailureState(attempt.lastOperation, error))
						const action = await waitForRecoveryAction(attempt, ['retry', 'reset'])
						attempt.pendingAction = null
						if (!isCurrent(attempt)) return
						if (action === 'reset') {
							setCurrentState(attempt, IDLE_STATE)
							return
						}
						attempt.lastOperation = null
						continue
					}

					const success = await completeSuccess(attempt, result, dependenciesForAttempt)
					if (!success) return
					void success.confirmation
						.then(() => {
							dependenciesForAttempt.draftLifecycle.markCommitted(result.taskId)
							report({
								phase: 'complete',
								taskId: result.taskId,
								sessionId: result.sessionId,
								transactionId: result.transactionId,
							})
						})
						.catch(() => undefined)
					return
				}
			} finally {
				if (activeAttemptRef.current === attempt) activeAttemptRef.current = null
			}
		},
		[completeSuccess, isCurrent, setCurrentState],
	)

	const chooseRecoveryAction = useCallback((action: RecoveryAction) => {
		const attempt = activeAttemptRef.current
		const pending = attempt?.pendingAction
		if (!attempt || !pending?.allowed.has(action)) return
		attempt.pendingAction = null
		pending.resolve(action)
	}, [])

	const onRetry = useCallback(() => chooseRecoveryAction('retry'), [chooseRecoveryAction])
	const onSkip = useCallback(() => chooseRecoveryAction('skip'), [chooseRecoveryAction])
	const onReset = useCallback(() => chooseRecoveryAction('reset'), [chooseRecoveryAction])

	// A launch request in flight when the launcher unmounts still reaches the server.
	useMountEffect(() => {
		// StrictMode runs this effect mount → cleanup → mount in development; without this
		// reset the cleanup's flag would outlive the fake unmount and every launch would be
		// treated as detached, so the repository-sources dialog could never open.
		launcherUnmountedRef.current = false
		const draftLifecycle = dependenciesRef.current.draftLifecycle
		draftLifecycle.enableCommitCleanup()
		return () => {
			launcherUnmountedRef.current = true
			const attempt = activeAttemptRef.current
			if (!attempt) return
			if (attempt.pendingAction) {
				attempt.cancelled = true
				attempt.pendingAction.resolve('reset')
				attempt.pendingAction = null
				activeAttemptRef.current = null
				return
			}
			attempt.detachedFromLauncher = true
		}
	})

	const operations = useMemo<LauncherV3Operations>(
		() => ({ ...state, onRetry, onSkip, onReset }),
		[state, onRetry, onSkip, onReset],
	)

	return { onSubmit, operations }
}
