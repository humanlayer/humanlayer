import { useHotkeys, Options } from 'react-hotkeys-hook'
import { HotkeyKey, getHotkey } from '@/config/hotkeys'

export function useRegisteredHotkey(
  hotkeyKey: HotkeyKey,
  callback: (e: KeyboardEvent) => void,
  options?: Options,
) {
  const definition = getHotkey(hotkeyKey)

  // Use the hotkey definition from registry
  useHotkeys(definition.key, callback, options)
}
