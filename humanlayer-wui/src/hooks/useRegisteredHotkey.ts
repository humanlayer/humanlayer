import { useHotkeys, Options } from 'react-hotkeys-hook'
import { HotkeyKey, getHotkey } from '@/config/hotkeys'

interface ExtendedOptions extends Options {
  dependencies?: any[]
}

export function useRegisteredHotkey(
  hotkeyKey: HotkeyKey,
  callback: (e: KeyboardEvent) => void,
  options?: ExtendedOptions,
) {
  const definition = getHotkey(hotkeyKey)
  const { dependencies, ...hotkeysOptions } = options || {}

  // Use the hotkey definition from registry
  useHotkeys(definition.key, callback, hotkeysOptions, dependencies)
}
