import type { HotkeyCallback } from '@humanlayer/react-hotkeys-hook'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import type { DependencyList } from 'react'
import { toast } from 'sonner'

import { CodeLayerToastButtons } from '@/components/CodeLayerToastButtons'
import { DismissableToastTitle } from '@/components/DismissableToastTitle'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { formatShortcut, hotkeysCatalog, resolveKeybindingDisplay } from '@/hotkeysCatalog'

import { type AppHotkeysOptions, useAppHotkeys } from './useAppHotkeys'

/** Stable ID so repeat presses replace the toast instead of stacking copies. */
const ARCHIVE_ADOPTION_TOAST_ID = 'archive-keybinding-adoption'

/** Confirm the switch back to plain `e` and point at Settings for later changes. */
function showArchiveSwitchedToast(): void {
	const settingsLabel = formatShortcut(hotkeysCatalog.global.shortcuts.settings.display)
	toast.success(
		<span className="inline-flex items-center gap-1.5">
			Changed Archive hotkey to <KeyboardShortcut size="xs">E</KeyboardShortcut>
		</span>,
		{
			duration: 3000,
			description: (
				<span className="leading-relaxed">
					You can change this later in Settings (
					<KeyboardShortcut size="xs">{settingsLabel}</KeyboardShortcut>
					).
				</span>
			),
		},
	)
}

/**
 * Explain the new default Archive binding and offer a one-click switch back
 * to plain `e`. Raised by the guarded plain-`e` fallback while `mod+e` is
 * the selected Archive binding.
 */
function showArchiveAdoptionToast(): void {
	const modLabel = formatShortcut(resolveKeybindingDisplay('mod+e'))
	toast.info(
		<DismissableToastTitle
			title={
				<span className="inline-flex items-center gap-1.5">
					Archive is now <KeyboardShortcut size="xs">{modLabel}</KeyboardShortcut>
				</span>
			}
			description={
				<span className="leading-relaxed">
					Press <KeyboardShortcut size="xs">{modLabel}</KeyboardShortcut> to archive, or use{' '}
					<KeyboardShortcut size="xs">E</KeyboardShortcut> instead.
				</span>
			}
			onDismiss={() => toast.dismiss(ARCHIVE_ADOPTION_TOAST_ID)}
		/>,
		{
			id: ARCHIVE_ADOPTION_TOAST_ID,
			duration: 8000,
			action: (
				<CodeLayerToastButtons
					variant="info"
					toastId={ARCHIVE_ADOPTION_TOAST_ID}
					action={{
						label: 'Use E instead',
						onClick: () => {
							toast.dismiss(ARCHIVE_ADOPTION_TOAST_ID)
							useSettingsStore.getState().setArchiveKeybinding('e')
							showArchiveSwitchedToast()
						},
					}}
				/>
			),
		},
	)
}

/**
 * Archive keybinding adapter. Registers the caller's archive callback under
 * the Archive binding selected in settings (`e` or `mod+e`) with the caller's
 * own scopes, area, guards, and options untouched. While `mod+e` is selected,
 * it also registers a plain-`e` fallback under the same guards that shows the
 * adoption toast — it never archives on that press.
 */
export function useArchiveHotkey(
	handleArchive: HotkeyCallback,
	options: AppHotkeysOptions = {},
	dependencies: DependencyList = [],
): void {
	const binding = useSettingsStore((state) => state.archiveKeybinding)
	useAppHotkeys(binding, handleArchive, options, [binding, ...dependencies])

	const callerEnabled = options.enabled ?? true
	useAppHotkeys(
		'e',
		() => showArchiveAdoptionToast(),
		{ ...options, enabled: binding === 'mod+e' ? callerEnabled : false },
		[binding, ...dependencies],
	)
}
