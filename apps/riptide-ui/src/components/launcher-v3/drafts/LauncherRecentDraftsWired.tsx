import { useMutation } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useWatch, type Control, type UseFormGetValues, type UseFormReset } from 'react-hook-form'
import { toast } from 'sonner'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { useDraftTasks } from '@/hooks/live-queries/useDraftTasks'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useTaskActions } from '@/hooks/useTaskActions'
import {
	importLauncherV3Draft,
	recoveryFromDraft,
	type LauncherV3DraftPersistence,
} from '@/modules/launcher-v3/launcher-v3-drafts'
import {
	createLauncherV3DefaultValues,
	isLauncherV3Touched,
	launcherV3DraftIsMeaningful,
	toPersistedLauncherV3Draft,
	type LauncherV3FormValues,
} from '@/modules/launcher-v3/launcher-v3-form'
import { useRiptideApi } from '@/orpc/client'
import { formatTimestamp } from '@/utils/formatting'

import { LauncherV3Status } from '../LauncherV3View'
import { LauncherRecentDrafts } from './LauncherRecentDrafts'
import type { LauncherV3DraftController } from './useLauncherV3DraftController'

const RECOVERY_DEBOUNCE_MS = 350
const UNTITLED_DRAFT_NAME = 'Untitled Draft'
const UPLOAD_BOUND_DRAFT_IDENTITY_ERROR =
	'Could not save this draft because its attachment identity is no longer available.'

function createNavigationDecisionLatch() {
	let pending: Promise<boolean> | null = null
	return {
		run(decide: () => Promise<boolean>): Promise<boolean> {
			if (pending) return pending
			pending = decide()
			const clear = () => {
				pending = null
			}
			void pending.then(clear, clear)
			return pending
		},
	}
}

type DraftRow = ReturnType<typeof useDraftTasks>[number] & {
	slug?: string | null
	default_working_directory?: string | null
}

function displayText(draft: DraftRow): string {
	const name = draft.name.trim()
	if (name && name !== UNTITLED_DRAFT_NAME) {
		return name
	}
	return draft.ticket_description?.trim() || 'Untitled draft'
}

function DebouncedRecovery({
	values,
	disabled,
	persistence,
	lifecycle,
	onWriteFailure,
}: {
	values: LauncherV3FormValues
	disabled: boolean
	persistence: LauncherV3DraftPersistence
	lifecycle: LauncherV3DraftController['lifecycle']
	onWriteFailure: () => void
}) {
	useMountEffect(() => {
		if (disabled || !launcherV3DraftIsMeaningful(values)) {
			return
		}
		const timeout = window.setTimeout(() => {
			if (lifecycle.isCommitted()) {
				return
			}
			const draftId = lifecycle.ensureLaunchIdentity().draftId
			const persisted = toPersistedLauncherV3Draft(values)
			if (!persistence.writeRecovery(recoveryFromDraft(draftId, persisted.local))) {
				onWriteFailure()
			}
		}, RECOVERY_DEBOUNCE_MS)
		return () => window.clearTimeout(timeout)
	})
	return null
}

export interface LauncherRecentDraftsWiredProps {
	control: Control<LauncherV3FormValues>
	reset: UseFormReset<LauncherV3FormValues>
	getValues: UseFormGetValues<LauncherV3FormValues>
	baseline: LauncherV3FormValues
	disabled?: boolean
	draftController: LauncherV3DraftController
}

/** RHF, router, server action, and browser recovery adapter. */
export function LauncherRecentDraftsWired({
	control,
	reset,
	getValues,
	baseline,
	disabled = false,
	draftController,
}: LauncherRecentDraftsWiredProps) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const taskActions = useTaskActions()
	const { client } = useRiptideApi()
	const { confirmTx } = useSyncInternal()
	const { lifecycle, persistence } = draftController
	const draftTasks = useDraftTasks(user?.id) as DraftRow[]
	const values = createLauncherV3DefaultValues(useWatch({ control }) as LauncherV3FormValues)
	const [activeBaseline, setActiveBaseline] = useState(baseline)
	const recoveryWarningShownRef = useRef(false)
	const navigationDecisionLatch = useMemo(() => createNavigationDecisionLatch(), [])
	const [hasRestored, setHasRestored] = useState(Boolean(lifecycle.activeId()))
	const warnRecoveryUnavailable = useCallback(() => {
		if (recoveryWarningShownRef.current) {
			return
		}
		recoveryWarningShownRef.current = true
		toast.warning('Draft backup is unavailable in this browser.')
	}, [])

	useMountEffect(() => {
		const recovery = persistence.readRecovery()
		if (!recovery || launcherV3DraftIsMeaningful(getValues())) {
			return
		}
		const restored = importLauncherV3Draft({
			localExtras: recovery.values,
			defaults: activeBaseline,
		})
		lifecycle.setActive(recovery.draftId, { uploadBound: restored.attachments.length > 0 })
		setActiveBaseline(restored)
		setHasRestored(true)
		reset(restored)
	})

	// Draft query results are owned by Electric; confirmTx waits for that cache to receive the mutation.
	const { mutateAsync: saveDraft, isPending: isSavingDraft } = useMutation({
		mutationKey: ['launcher-v3', 'save-draft'],
		mutationFn: async (persisted: ReturnType<typeof toPersistedLauncherV3Draft>) => {
			const save = async (id: string) => {
				const response = await client.tasks.saveDraft({
					id,
					name: persisted.durable.name || UNTITLED_DRAFT_NAME,
					slug: persisted.durable.slug ?? null,
					defaultWorkingDirectory: persisted.durable.defaultWorkingDirectory ?? null,
					ticketId: persisted.durable.ticketId ?? null,
					ticketDescription: persisted.durable.ticketDescription ?? null,
					ticketProvider: persisted.durable.ticketProvider ?? null,
					githubConnectionId: persisted.durable.githubConnectionId ?? null,
					ticketRepositoryId: persisted.durable.ticketRepositoryId ?? null,
					ticketRepositoryFullName: persisted.durable.ticketRepositoryFullName ?? null,
					workflowType: persisted.durable.workflowType,
					worktreeTiming: persisted.durable.worktreeTiming,
					autoAdvanceQuestionsToResearch: persisted.durable.autoAdvanceQuestionsToResearch,
					autoAdvanceResearchToDesign: persisted.durable.autoAdvanceResearchToDesign,
					autoAdvancePlanToWorktree: persisted.durable.autoAdvancePlanToWorktree,
					autoAdvanceWorktreeToImplementation: persisted.durable.autoAdvanceWorktreeToImplementation,
					autoAdvanceImplementationToPr: persisted.durable.autoAdvanceImplementationToPr,
				})
				if (response.result === 'saved') {
					await confirmTx.tasks(response.transactionId)
				}
				return response
			}

			let id = lifecycle.ensureLaunchIdentity().draftId
			let response = await save(id)
			if (response.result === 'draft-id-unavailable') {
				const reassignment = lifecycle.reassignId()
				if (reassignment.result === 'upload-bound-conflict') {
					persistence.writeExtras(id, persisted.local)
					persistence.writeRecovery(recoveryFromDraft(id, persisted.local))
					throw new Error(UPLOAD_BOUND_DRAFT_IDENTITY_ERROR)
				}
				id = reassignment.replacementId
				lifecycle.ensureLaunchIdentity()
				response = await save(id)
			}
			if (response.result === 'draft-id-unavailable') {
				throw new Error('Draft ID unavailable')
			}
			if (!persistence.writeExtras(id, persisted.local)) {
				throw new Error('Draft extras could not be verified')
			}
			for (const displacedId of lifecycle.takeDisplacedIds(id)) {
				persistence.removeRecovery(displacedId)
				persistence.removeExtras(displacedId)
				persistence.removeLaunchIdentity(displacedId)
			}
			persistence.removeRecovery(id)
		},
		onError: (error) => {
			toast.error(
				error instanceof Error && error.message === UPLOAD_BOUND_DRAFT_IDENTITY_ERROR
					? error.message
					: 'Could not save draft. Your work is still available on this device.',
			)
		},
	})

	const saveCurrentDraft = useCallback(async (): Promise<boolean> => {
		if (lifecycle.isCommitted()) {
			return true
		}
		const current = createLauncherV3DefaultValues(getValues())
		if (disabled || !launcherV3DraftIsMeaningful(current)) {
			return true
		}
		if (lifecycle.state() === 'launching') {
			const persisted = toPersistedLauncherV3Draft(current)
			if (
				persistence.writeRecovery(recoveryFromDraft(lifecycle.ensureLaunchIdentity().draftId, persisted.local))
			) {
				return true
			}
			warnRecoveryUnavailable()
			return window.confirm('Draft backup is unavailable. Leave and lose this draft?')
		}
		if (!user?.id) {
			return true
		}
		try {
			await saveDraft(toPersistedLauncherV3Draft(current))
			return true
		} catch {
			return false
		}
	}, [disabled, getValues, lifecycle, persistence, saveDraft, user?.id, warnRecoveryUnavailable])
	const blockNavigationUnlessDraftSaved = useCallback((): Promise<boolean> => {
		return navigationDecisionLatch.run(() => saveCurrentDraft().then((saved) => !saved))
	}, [navigationDecisionLatch, saveCurrentDraft])

	useBlocker({
		shouldBlockFn: blockNavigationUnlessDraftSaved,
		enableBeforeUnload: false,
	})

	const recentDrafts = useMemo(
		() =>
			draftTasks.slice(0, 5).map((draft) => ({
				id: draft.id,
				text: displayText(draft),
				timeLabel: draft.updated_at === null ? '' : formatTimestamp(new Date(Number(draft.updated_at))),
			})),
		[draftTasks],
	)

	const restoreDraft = useCallback(
		async (id: string) => {
			if (!(await saveCurrentDraft())) {
				return
			}
			const draft = draftTasks.find((candidate) => candidate.id === id)
			if (!draft) {
				return
			}
			const restored = importLauncherV3Draft({
				draftRow: draft,
				localExtras: persistence.readExtras(id),
				defaults: activeBaseline,
			})
			lifecycle.setActive(id, { uploadBound: restored.attachments.length > 0 })
			setActiveBaseline(restored)
			setHasRestored(true)
			reset(restored)
		},
		[activeBaseline, draftTasks, lifecycle, persistence, reset, saveCurrentDraft],
	)

	const archiveDraft = useCallback(
		(id: string) => {
			taskActions.archiveTask({ taskId: id, archived: true, cascadeToSessions: false })
			persistence.removeExtras(id)
			persistence.removeRecovery(id)
			persistence.removeLaunchIdentity(id)
		},
		[persistence, taskActions],
	)

	const viewAllDrafts = useCallback(() => navigate({ to: '/sessions', search: { tab: 'drafts' } }), [navigate])
	const visible =
		!disabled &&
		!hasRestored &&
		!launcherV3DraftIsMeaningful(values) &&
		!isLauncherV3Touched(values, activeBaseline) &&
		recentDrafts.length > 0
	const recoveryKey = JSON.stringify(toPersistedLauncherV3Draft(values).local)

	return (
		<>
			<DebouncedRecovery
				key={recoveryKey}
				values={values}
				disabled={disabled}
				persistence={persistence}
				lifecycle={lifecycle}
				onWriteFailure={warnRecoveryUnavailable}
			/>
			<LauncherRecentDrafts
				drafts={recentDrafts}
				visible={visible}
				disabled={disabled || isSavingDraft}
				onRestore={(id) => void restoreDraft(id)}
				onArchive={archiveDraft}
				onViewAll={viewAllDrafts}
			/>
			<LauncherV3Status message={isSavingDraft ? 'Saving draft...' : null} waiting={isSavingDraft} />
		</>
	)
}
