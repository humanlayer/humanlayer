import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { useAgentSlashCommands } from '@/hooks/live-queries/use-agent-slash-commands'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

import { LAUNCHER_FALLBACK_SLASH_COMMANDS } from './launcher-slash-commands'
import { LauncherPrompt } from './LauncherPrompt'

export interface LauncherPromptWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
	onFilePaste?: (files: File[]) => void
	onSubmit?: () => void
}

export function LauncherPromptWired({ control, disabled, onFilePaste, onSubmit }: LauncherPromptWiredProps) {
	const { field: prompt } = useController({ control, name: 'prompt' })
	const sendMessageKeybinding = useSettingsStore((state) => state.sendMessageKeybinding)
	const hostId = useWatch({ control, name: 'hostId' })
	const agent = useWatch({ control, name: 'agent' })
	const directory = useWatch({ control, name: 'directory' })
	const slashCommands = useAgentSlashCommands({
		hostId,
		agent,
		workspacePath: directory,
		fallbackCommands: LAUNCHER_FALLBACK_SLASH_COMMANDS,
		omitStartOfMessageOnly: true,
	})
	return (
		<LauncherPrompt
			prompt={prompt.value}
			disabled={disabled}
			onFilePaste={onFilePaste}
			onPromptChange={prompt.onChange}
			onPromptBlur={prompt.onBlur}
			onSubmit={onSubmit}
			submitShortcut={sendMessageKeybinding}
			slashCommands={slashCommands}
		/>
	)
}
