import { BypassPermissionsDialog } from '@humanlayer/ui/components/bypass-permissions-dialog'
import { DraftLauncherForm, type ModelOption, type SlashCommand } from '@humanlayer/ui/components/draft-launcher-form'
import type { PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'
import type { Content } from '@tiptap/core'
import { type FC, useEffect, useState } from 'react'

// No-op file mention suggestion — enables the file-mention node type in the editor
// without wiring up the autocomplete popup
const NOOP_FILE_MENTION_SUGGESTION = {
	render: () => ({
		onStart: () => {},
		onUpdate: () => {},
		onExit: () => {},
		onKeyDown: () => false,
	}),
}

const EMPTY_DIRECTORIES: string[] = []

// Mock slash commands for Storybook
const MOCK_SLASH_COMMANDS: SlashCommand[] = [
	{ name: '/help', source: 'global' },
	{ name: '/clear', source: 'global' },
	{ name: '/research', source: 'local' },
	{ name: '/implement', source: 'local' },
	{ name: '/test', source: 'local' },
	{ name: '/cl:research_codebase', source: 'bundled' },
	{ name: '/cl:create_plan', source: 'bundled' },
]

export interface DraftLauncherFormWrapperProps {
	initialTitle?: string
	initialWorkingDir?: string
	initialContent?: Content | null
	initialModel?: ModelOption
	recentDirectories?: string[]
	pendingUploadCount?: number
	/** Show the update-task-dir checkbox (simulates a valid, non-matching working directory) */
	showUpdateTaskDirCheckbox?: boolean
	/** Initial value of the update-task-dir checkbox */
	initialUpdateTaskDir?: boolean
	/** Label for the update-task-dir checkbox */
	updateTaskDirCheckboxLabel?: string
	onLaunch?: (data: {
		title: string
		workingDir: string
		content: Content | null
		model: ModelOption
		bypassEnabled: boolean
		permissionsMode: PermissionsModeNoBypass
	}) => void
	onDiscard?: () => void
}

export const DraftLauncherFormWrapper: FC<DraftLauncherFormWrapperProps> = ({
	initialTitle = '',
	initialWorkingDir = '',
	initialContent = null,
	initialModel = 'sonnet',
	recentDirectories = EMPTY_DIRECTORIES,
	pendingUploadCount = 0,
	showUpdateTaskDirCheckbox = false,
	initialUpdateTaskDir = false,
	updateTaskDirCheckboxLabel,
	onLaunch,
	onDiscard,
}) => {
	const [title, setTitle] = useState(initialTitle)
	const [workingDir, setWorkingDir] = useState(initialWorkingDir)
	const [content, setContent] = useState<Content | null>(initialContent)
	const [model, setModel] = useState<ModelOption>(initialModel)
	const [bypassEnabled, setBypassEnabled] = useState(false)
	const [permissionsMode, setPermissionsMode] = useState<PermissionsModeNoBypass>('default')
	const [bypassTimeoutMinutes, setBypassTimeoutMinutes] = useState<number | null>(15)
	const [bypassDialogOpen, setBypassDialogOpen] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [updateTaskDir, setUpdateTaskDir] = useState(initialUpdateTaskDir)

	const handleToggleBypass = () => {
		if (bypassEnabled) {
			setBypassEnabled(false)
		} else {
			setBypassDialogOpen(true)
		}
	}

	const handleBypassConfirm = (timeoutMinutes: number | null) => {
		setBypassTimeoutMinutes(timeoutMinutes)
		setBypassEnabled(true)
	}

	const handleDiscard = () => {
		onDiscard?.()
		// Reset form state
		setTitle(initialTitle)
		setWorkingDir(initialWorkingDir)
		setContent(initialContent)
		setModel(initialModel)
		setBypassEnabled(false)
		setPermissionsMode('default')
	}

	const handleSubmit = async () => {
		setIsSubmitting(true)
		await new Promise((resolve) => setTimeout(resolve, 1500))
		onLaunch?.({
			title,
			workingDir,
			content,
			model,
			bypassEnabled,
			permissionsMode,
		})
		setIsSubmitting(false)
	}

	const isContentEmpty =
		!content ||
		(typeof content === 'object' &&
			!Array.isArray(content) &&
			content.type === 'doc' &&
			(!content.content ||
				content.content.length === 0 ||
				(content.content.length === 1 &&
					content.content[0]?.type === 'paragraph' &&
					!content.content[0]?.content)))

	// Keyboard shortcut handling
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const activeElement = document.activeElement
			const isFormFocused =
				activeElement?.tagName === 'INPUT' ||
				activeElement?.tagName === 'TEXTAREA' ||
				activeElement?.getAttribute('contenteditable') === 'true'

			// Cmd+Enter or Ctrl+Enter - launch (works even in form)
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
				if (!isSubmitting && !(!workingDir || isContentEmpty)) {
					e.preventDefault()
					void handleSubmit()
				}
			}

			// E key - discard (only when form not focused)
			if (e.key === 'e' && !isFormFocused) {
				e.preventDefault()
				handleDiscard()
			}

			// Escape - blur active element
			if (e.key === 'Escape' && isFormFocused && activeElement instanceof HTMLElement) {
				activeElement.blur()
			}
		}

		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [isSubmitting, workingDir, isContentEmpty, handleSubmit, handleDiscard])

	return (
		<>
			<DraftLauncherForm
				title={title}
				onTitleChange={setTitle}
				workingDir={workingDir}
				onWorkingDirChange={setWorkingDir}
				content={content}
				onContentChange={setContent}
				recentDirectories={recentDirectories}
				model={model}
				onModelChange={setModel}
				bypassEnabled={bypassEnabled}
				onToggleBypass={handleToggleBypass}
				permissionsMode={permissionsMode}
				onPermissionModeChange={setPermissionsMode}
				bypassTimeoutMinutes={bypassTimeoutMinutes}
				onSubmit={handleSubmit}
				onDiscard={handleDiscard}
				isSubmitting={isSubmitting}
				submitDisabled={!workingDir || isContentEmpty || pendingUploadCount > 0}
				slashCommands={MOCK_SLASH_COMMANDS}
				fileMentionSuggestion={NOOP_FILE_MENTION_SUGGESTION}
				className="w-full max-w-2xl h-[500px]"
				pendingUploadCount={pendingUploadCount}
				showUpdateTaskDirCheckbox={showUpdateTaskDirCheckbox}
				updateTaskDir={updateTaskDir}
				onUpdateTaskDirChange={setUpdateTaskDir}
				updateTaskDirCheckboxLabel={updateTaskDirCheckboxLabel}
			/>
			<BypassPermissionsDialog
				open={bypassDialogOpen}
				onOpenChange={setBypassDialogOpen}
				onConfirm={handleBypassConfirm}
			/>
		</>
	)
}
