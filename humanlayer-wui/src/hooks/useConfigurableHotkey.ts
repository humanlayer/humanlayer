import { useHotkeys, Options } from 'react-hotkeys-hook'
import { useHotkeyStore } from '@/stores/hotkeyStore'
import { HOTKEY_DEFINITIONS, HotkeyId } from '@/config/hotkeys'

/**
 * A wrapper around useHotkeys that reads the key binding from the hotkey store.
 * This allows users to customize their keyboard shortcuts.
 *
 * @param hotkeyId - The ID of the hotkey from HOTKEY_DEFINITIONS
 * @param callback - The callback to execute when the hotkey is pressed
 * @param options - Additional options to pass to useHotkeys (scopes are taken from the definition)
 * @param deps - Dependencies array for the callback
 */
export function useConfigurableHotkey(
  hotkeyId: HotkeyId,
  callback: () => void,
  options?: Omit<Options, 'scopes'>,
  deps?: unknown[],
) {
  const getBinding = useHotkeyStore(state => state.getBinding)
  const definition = HOTKEY_DEFINITIONS[hotkeyId]

  const keys = getBinding(hotkeyId)
  const scopes = Array.isArray(definition?.scope)
    ? definition.scope
    : definition?.scope
      ? [definition.scope]
      : ['*']

  return useHotkeys(
    keys,
    callback,
    {
      ...options,
      scopes,
    },
    deps ?? [],
  )
}

/**
 * Hook to get the current binding for a hotkey.
 * Useful for displaying the current shortcut in tooltips or UI.
 */
export function useHotkeyBinding(hotkeyId: HotkeyId): string {
  return useHotkeyStore(state => state.getBinding(hotkeyId))
}

/**
 * Hook to check if a hotkey has been customized from its default.
 */
export function useIsHotkeyCustomized(hotkeyId: HotkeyId): boolean {
  const customBindings = useHotkeyStore(state => state.customBindings)
  return hotkeyId in customBindings
}
