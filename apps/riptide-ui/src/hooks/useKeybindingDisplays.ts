import { useMemo } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { type KeybindingDisplays, resolveKeybindingDisplays } from '@/hotkeysCatalog'

/**
 * The settings-aware keycap displays for the two user-configurable
 * keybindings (Archive and Send message). Display-only: hotkey registration
 * reads the same store fields itself.
 */
export function useKeybindingDisplays(): KeybindingDisplays {
	const archiveKeybinding = useSettingsStore((state) => state.archiveKeybinding)
	const sendMessageKeybinding = useSettingsStore((state) => state.sendMessageKeybinding)
	return useMemo(
		() => resolveKeybindingDisplays({ archiveKeybinding, sendMessageKeybinding }),
		[archiveKeybinding, sendMessageKeybinding],
	)
}
