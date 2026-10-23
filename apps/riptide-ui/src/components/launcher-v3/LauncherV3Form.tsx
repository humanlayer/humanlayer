import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFormFieldSubmitHotkey } from '@/hooks/hotkeys/useFormFieldSubmitHotkey'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useViewportFileDrop } from '@/hooks/useViewportFileDrop'
import { formatShortcut, resolveKeybindingDisplay } from '@/hotkeysCatalog'
import { createUniqueUploadFileNames } from '@/lib/unique-upload-file-names'
import {
	createLauncherV3DefaultValues,
	getLaunchReadiness,
	refreshHostLaunchBlocker,
	toLaunchCommand,
	type LauncherV3Command,
	type LauncherV3FormValues,
	type LauncherV3LaunchBlocker,
} from '@/modules/launcher-v3/launcher-v3-form'
import { workspaceForLaunch } from '@/modules/launcher-v3/launcher-v3-workspace'

import { LauncherSuggestionChipsWired } from './chips/LauncherSuggestionChipsWired'
import { LauncherAgentControlWired } from './controls/LauncherAgentControlWired'
import { LauncherAutoAdvanceControlWired } from './controls/LauncherAutoAdvanceControlWired'
import { LauncherDirectoryControlWired } from './controls/LauncherDirectoryControlWired'
import { LauncherHostControlWired } from './controls/LauncherHostControlWired'
import { LauncherHostPressureNoticeWired } from './controls/LauncherHostPressureNoticeWired'
import { LauncherHostStateNoticeWired } from './controls/LauncherHostStateNoticeWired'
import { LauncherPermissionControlWired } from './controls/LauncherPermissionControlWired'
import { LauncherWorkflowControlWired } from './controls/LauncherWorkflowControlWired'
import {
	LauncherWorkspaceDrawerWired,
	LauncherWorktreeTimingControlWired,
	useLauncherV3Workspace,
} from './controls/LauncherWorktreeTimingControlWired'
import { useLauncherSelectedHost } from './controls/useLauncherSelectedHost'
import { LauncherProjectDrawerWired, useLauncherV3Project } from './controls/useLauncherV3Project'
import { CreateProjectDialog } from './CreateProjectDialog'
import { LauncherRecentDraftsWired } from './drafts/LauncherRecentDraftsWired'
import type { LauncherV3DraftController } from './drafts/useLauncherV3DraftController'
import { LauncherIdentityWired } from './identity/LauncherIdentityWired'
import { LauncherTrayView, LauncherV3Status, LauncherV3Submit, LauncherV3View } from './LauncherV3View'
import type { LauncherV3Operations } from './progress/LauncherProgress'
import { LauncherProgressWired } from './progress/LauncherProgressWired'
import { LauncherAttachmentChipsWired } from './prompt/LauncherAttachmentChipsWired'
import { LauncherAttachmentControlWired } from './prompt/LauncherAttachmentControlWired'
import { LauncherPromptWired } from './prompt/LauncherPromptWired'
import { LauncherWorkflowGraphWired } from './workflow/LauncherWorkflowGraphWired'

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024

async function computeSha256(file: File): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
	return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface LauncherV3FormProps {
	defaultValues?: Partial<LauncherV3FormValues>
	onSubmit: (command: LauncherV3Command) => void | Promise<void>
	operations: LauncherV3Operations
	onBack: () => void
	disabled?: boolean
	getPresignedUploadUrl: (input: {
		taskId: string
		fileName: string
		contentType: string
	}) => Promise<{ uploadUrl: string }>
	draftController: LauncherV3DraftController
}

export function LauncherV3Form({
	defaultValues,
	onSubmit,
	operations,
	onBack,
	disabled = false,
	getPresignedUploadUrl,
	draftController,
}: LauncherV3FormProps) {
	const initialValues = useMemo(() => createLauncherV3DefaultValues(defaultValues), [defaultValues])
	const { control, handleSubmit, formState, reset, getValues, setValue } = useForm<LauncherV3FormValues>({
		defaultValues: initialValues,
	})
	const [uploadingFileNames, setUploadingFileNames] = useState<Set<string>>(() => new Set())
	const [submitInFlight, setSubmitInFlight] = useState(false)
	const [blockedReason, setBlockedReason] = useState<LauncherV3LaunchBlocker | null>(null)
	const [waitingForIdentity, setWaitingForIdentity] = useState(false)
	const [projectCreateOpen, setProjectCreateOpen] = useState(false)
	const workspace = useLauncherV3Workspace(control)
	const project = useLauncherV3Project(control)
	const selectedHost = useLauncherSelectedHost(control)
	const selectedHostId = useWatch({ control, name: 'hostId' })
	const shownBlocker = refreshHostLaunchBlocker(blockedReason, selectedHostId, selectedHost)
	const updateWaitingForIdentity = (waiting: boolean) => {
		setWaitingForIdentity(waiting)
	}

	const submitCommittedSnapshot = handleSubmit(async (values) => {
		if (disabled || submitInFlight || uploadingFileNames.size > 0) return
		const readiness = getLaunchReadiness(values, selectedHost)
		if (!readiness.canLaunch) {
			updateWaitingForIdentity(
				readiness.blockedReason.code === 'no-title' || readiness.blockedReason.code === 'no-slug',
			)
			setBlockedReason(readiness.blockedReason)
			return
		}
		const projectProjection = project.projectForTaskSlug(values.slug)
		if (projectProjection.kind === 'blocked') {
			setBlockedReason({ code: 'no-directory', label: projectProjection.reason.message })
			return
		}
		const workspaceProjection =
			projectProjection.kind === 'ready'
				? { kind: 'not-now' as const }
				: workspace.projectForTaskSlug(values.slug)
		if (workspaceProjection.kind === 'blocked') {
			setBlockedReason({ code: 'no-directory', label: workspaceProjection.reason.message })
			return
		}

		updateWaitingForIdentity(false)
		setSubmitInFlight(true)
		setBlockedReason(null)
		try {
			const launchTarget =
				projectProjection.kind === 'ready'
					? { kind: 'project' as const, project: projectProjection.project }
					: workspaceForLaunch(workspaceProjection)
			await onSubmit(toLaunchCommand(values, launchTarget))
		} finally {
			setSubmitInFlight(false)
		}
	})
	const formDisabled = disabled || formState.isSubmitting
	const onAddFiles = (files: File[]) => {
		const unavailableNames = [
			...getValues('attachments').map((attachment) => attachment.fileName),
			...uploadingFileNames,
		]
		const uniqueNames = createUniqueUploadFileNames(
			files.map((file) => file.name),
			unavailableNames,
		)

		for (const [index, file] of files.entries()) {
			const fileName = uniqueNames[index]
			if (!fileName) continue
			if (file.size > MAX_UPLOAD_SIZE_BYTES) {
				toast.error(`Could not attach ${fileName}`, { description: 'File exceeds the 50 MiB upload limit' })
				continue
			}
			const contentType = file.type || 'application/octet-stream'
			setUploadingFileNames((current) => new Set(current).add(fileName))
			void (async () => {
				try {
					const contentHash = await computeSha256(file)
					const taskId = draftController.lifecycle.bindUploadsToActiveId()
					const { uploadUrl } = await getPresignedUploadUrl({ taskId, fileName, contentType })
					const response = await fetch(uploadUrl, {
						method: 'PUT',
						body: file,
						headers: { 'Content-Type': contentType },
					})
					if (!response.ok) throw new Error(`Upload rejected with ${response.status} ${response.statusText}`)
					setValue(
						'attachments',
						[...getValues('attachments'), { fileName, contentType, fileSizeBytes: file.size, contentHash }],
						{ shouldDirty: true },
					)
				} catch (error) {
					toast.error(`Could not attach ${fileName}`, {
						description: error instanceof Error ? error.message : 'Upload failed',
					})
				} finally {
					setUploadingFileNames((current) => {
						const next = new Set(current)
						next.delete(fileName)
						return next
					})
				}
			})()
		}
	}
	useViewportFileDrop(disabled ? null : onAddFiles)

	const sendMessageKeybinding = useSettingsStore((state) => state.sendMessageKeybinding)
	const sendMessageShortcutLabel = formatShortcut(resolveKeybindingDisplay(sendMessageKeybinding))

	// Mod+Enter always submits, in both Send-message binding modes.
	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			void submitCommittedSnapshot()
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
	)

	useFormFieldSubmitHotkey(
		() => void submitCommittedSnapshot(),
		{ enabled: sendMessageKeybinding === 'enter', scope: HOTKEY_SCOPES.TASK_NEW },
		[submitCommittedSnapshot],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			const activeElement = document.activeElement
			const eventTarget = event.target
			const focusedElement =
				activeElement instanceof HTMLElement && activeElement !== document.body
					? activeElement
					: eventTarget instanceof HTMLElement && eventTarget !== document.body
						? eventTarget
						: null
			if (focusedElement) {
				focusedElement.blur()
				return
			}
			onBack()
		},
		{
			enabled: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
	)

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.TASK_NEW} componentName="LauncherV3Form">
			<form className="h-full" aria-label="Launcher V3" noValidate onSubmit={submitCommittedSnapshot}>
				<LauncherV3View>
					<LauncherIdentityWired
						key="identity"
						control={control}
						disabled={formDisabled}
						onGeneratedIdentity={() => {
							if (waitingForIdentity) void submitCommittedSnapshot()
						}}
					/>
					<LauncherPromptWired
						key="prompt"
						control={control}
						disabled={formDisabled}
						onFilePaste={onAddFiles}
						onSubmit={() => void submitCommittedSnapshot()}
					/>
					<LauncherAttachmentChipsWired
						key="uploads"
						control={control}
						uploadingFileNames={[...uploadingFileNames]}
						disabled={formDisabled}
					/>
					<LauncherAgentControlWired key="agent" control={control} disabled={formDisabled} />
					<LauncherTrayView key="tray">
						<LauncherAttachmentControlWired
							key="attachments"
							control={control}
							onAddFiles={onAddFiles}
							disabled={formDisabled}
						/>
						<LauncherPermissionControlWired key="permission" control={control} disabled={formDisabled} />
						<LauncherHostControlWired key="host" control={control} disabled={formDisabled} />
						<LauncherDirectoryControlWired
							key="directory"
							control={control}
							disabled={formDisabled}
							onCreateProject={() => setProjectCreateOpen(true)}
						/>
						{project.projectId === null && (
							<LauncherWorktreeTimingControlWired
								key="worktree"
								control={control}
								disabled={formDisabled}
								workspace={workspace}
							/>
						)}
						<LauncherWorkflowControlWired key="workflow" control={control} disabled={formDisabled} />
						<LauncherAutoAdvanceControlWired key="auto-advance" control={control} disabled={formDisabled} />
						<LauncherV3Submit
							key="submit"
							disabled={disabled || uploadingFileNames.size > 0}
							submitting={formState.isSubmitting}
							waiting={waitingForIdentity}
							submitShortcutLabel={sendMessageShortcutLabel}
						/>
					</LauncherTrayView>
					<LauncherHostStateNoticeWired key="host-state" control={control} />
					<LauncherHostPressureNoticeWired key="host-pressure" control={control} />
					<LauncherSuggestionChipsWired key="chips" disabled={formDisabled} />
					{project.projectId === null ? (
						<LauncherWorkspaceDrawerWired
							key="workspace"
							control={control}
							disabled={formDisabled}
							workspace={workspace}
						/>
					) : (
						<LauncherProjectDrawerWired
							key="workspace"
							control={control}
							disabled={formDisabled}
							project={project}
						/>
					)}
					<LauncherWorkflowGraphWired key="workflow-graph" control={control} />
					<LauncherV3Status
						key="status"
						message={operations.steps.length || operations.recovery ? null : (shownBlocker?.label ?? null)}
						waiting={waitingForIdentity}
					/>
					<LauncherProgressWired key="progress" operations={operations} />
					<LauncherRecentDraftsWired
						key="drafts"
						control={control}
						reset={reset}
						getValues={getValues}
						baseline={initialValues}
						disabled={disabled}
						draftController={draftController}
					/>
				</LauncherV3View>
				<CreateProjectDialog
					open={projectCreateOpen}
					onOpenChange={setProjectCreateOpen}
					onCreated={(project) => {
						setValue('projectId', project.id, { shouldDirty: true })
						setValue('projectDefaultRepositoryIdentity', null, { shouldDirty: true })
					}}
				/>
			</form>
		</HotkeyScopeBoundary>
	)
}
