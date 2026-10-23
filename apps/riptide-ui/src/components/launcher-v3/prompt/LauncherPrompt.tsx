import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	RichTextEditor,
	type RichTextEditorProps,
	type RichTextEditorRef,
	type SlashCommand,
} from '@humanlayer/ui/components/rich-text-editor'
import { useRef, useState } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

import { LAUNCHER_FALLBACK_SLASH_COMMANDS } from './launcher-slash-commands'

const NOOP_FILE_MENTION_SUGGESTION = {
	render: () => ({
		onStart: () => {},
		onUpdate: () => {},
		onExit: () => {},
		onKeyDown: () => false,
	}),
}

export interface LauncherPromptProps {
	prompt: LauncherV3FormValues['prompt']
	disabled?: boolean
	onFilePaste?: (files: File[]) => void
	onPromptChange: (value: LauncherV3FormValues['prompt']) => void
	onPromptBlur: () => void
	onSubmit?: () => void
	/** Key gesture that submits from the editor. Defaults to Mod+Enter. */
	submitShortcut?: RichTextEditorProps['submitShortcut']
	slashCommands?: SlashCommand[]
}

export function LauncherPrompt({
	prompt,
	disabled = false,
	onFilePaste,
	onPromptChange,
	onPromptBlur,
	onSubmit,
	submitShortcut = 'mod+enter',
	slashCommands = LAUNCHER_FALLBACK_SLASH_COMMANDS,
}: LauncherPromptProps) {
	const editorRef = useRef<RichTextEditorRef>(null)
	const [focused, setFocused] = useState(false)

	useHotkeys(
		'enter',
		(event) => {
			const activeElement = document.activeElement
			if (activeElement && activeElement !== document.body) return
			event.preventDefault()
			editorRef.current?.focus()
		},
		{
			enabled: !disabled,
			enableOnFormTags: false,
			enableOnContentEditable: false,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
	)

	return (
		<section aria-label="Task prompt" className="min-w-0 bg-transparent">
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, react-doctor/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- Padding forwards pointer focus to the nested editor. */}
			<div className="min-h-[190px] cursor-text p-4" onClick={() => editorRef.current?.focus()}>
				<RichTextEditor
					ref={editorRef}
					value={prompt}
					onChange={onPromptChange}
					onFilePaste={onFilePaste}
					ariaLabel="Task prompt"
					onFocus={() => setFocused(true)}
					onBlur={() => {
						setFocused(false)
						onPromptBlur()
					}}
					onSubmit={onSubmit}
					submitShortcut={submitShortcut}
					placeholder={focused ? 'Describe a task...' : 'ENTER to type something'}
					disabled={disabled}
					autoFocus="start"
					className="max-h-[min(25vh,200px)] text-base"
					fileMentionSuggestion={NOOP_FILE_MENTION_SUGGESTION}
					slashCommands={slashCommands}
					showSkillsHint
				/>
			</div>
		</section>
	)
}
