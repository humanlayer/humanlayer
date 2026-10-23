import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { DialogFooter } from '@humanlayer/ui/components/dialog'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'

import type { HotkeyScope } from '@/hooks/hotkeys/scopes'

import type { ProjectCreatorFormValues } from './ProjectCreator'
import { ProjectRepositoryEditor } from './ProjectRepositoryEditor'

export type RepositoryDraft = ProjectCreatorFormValues['repositories'][number]

/** Shared dialog body; creation keeps the editor's compact layout. */
export function RepositorySetupForm({
	initial,
	onSave,
	onCancel,
	onBack,
	onBusyChange,
	hotkeyScope,
	disabled = false,
	adding = false,
}: {
	initial: RepositoryDraft
	onSave: (draft: RepositoryDraft) => Promise<void>
	onCancel: () => void
	onBack?: () => void
	onBusyChange: (busy: boolean) => void
	/** Scope of the dialog hosting this form, so Mod+Enter only fires while that dialog owns the keyboard. */
	hotkeyScope: HotkeyScope
	disabled?: boolean
	adding?: boolean
}) {
	const form = useForm<ProjectCreatorFormValues>({ defaultValues: { repositories: [initial] } })
	const submitting = useRef(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const submit = async (values: ProjectCreatorFormValues) => {
		if (submitting.current || disabled) return
		const draft = values.repositories[0]
		if (!draft) return
		if (!draft.defaultBranch.trim()) {
			form.setError('repositories.0.defaultBranch', { message: 'Default branch is required' })
			return
		}
		submitting.current = true
		setBusy(true)
		onBusyChange(true)
		setError(null)
		try {
			await onSave(draft)
		} catch {
			setError('Failed to save repository. Your edits are retained; please try again.')
		} finally {
			submitting.current = false
			setBusy(false)
			onBusyChange(false)
		}
	}
	const submitFromHotkey = () => void form.handleSubmit(submit)()

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			submitFromHotkey()
		},
		{
			enabled: !busy && !disabled,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [hotkeyScope],
		},
		[busy, disabled, submitFromHotkey],
	)

	return (
		<form
			className="flex min-h-0 flex-col overflow-hidden"
			onSubmit={(event) => void form.handleSubmit(submit)(event)}
		>
			<div className="min-h-0 space-y-4 overflow-y-auto px-6 py-4">
				<ProjectRepositoryEditor
					control={form.control}
					index={0}
					roomy
					disabled={disabled || busy}
					onDefault={() => form.setValue('repositories.0.default', true)}
				/>
				<p className="text-xs text-muted-foreground">
					One glob per line, relative to the source repository. Setup runs after copying files. Use a command
					that finishes, not a long-running server.
				</p>
				<p className="text-xs text-muted-foreground">
					Local source folders are separate user/host settings. Manage them through the project's local paths
					action.
				</p>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</div>
			<DialogFooter className="shrink-0 border-t px-6 py-4">
				{onBack && (
					<Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
						Back
					</Button>
				)}
				<Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={busy || disabled}>
					{busy ? 'Saving…' : adding ? 'Add repository' : 'Save setup'}
				</Button>
			</DialogFooter>
		</form>
	)
}

export function repositoryRecipe(draft: RepositoryDraft) {
	return {
		remoteUrl: draft.remoteUrl,
		defaultBranch: draft.defaultBranch.trim(),
		default: draft.default,
		autoPushBranch: draft.autoPushBranch,
		copyGlobs: draft.copyGlobsText
			.split('\n')
			.map((glob) => glob.trim())
			.filter(Boolean),
		setupCommand: draft.setupCommand.trim() ? draft.setupCommand : undefined,
	}
}
