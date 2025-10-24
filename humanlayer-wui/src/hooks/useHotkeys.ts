import { useHotkeys as useHotkeysOriginal } from 'react-hotkeys-hook'
import { useLocalStorage } from './useLocalStorage'
import { KEYBOARD_LAYOUT_CHAR_KEY } from '@/lib/preferences'

/**
 * Wrapper around react-hotkeys-hook that respects keyboard layout preferences.
 * By default, uses logical key matching (character-based) for better support
 * of non-QWERTY layouts like DVORAK.
 */
export function useHotkeys(
  keys: string | string[],
  callback: (event: KeyboardEvent, handler: any) => void,
  options?: any,
  dependencies?: any[],
) {
  // Get user preference for keyboard layout matching
  // Default to true (logical/character matching) for DVORAK support
  const [useKeyChar] = useLocalStorage(KEYBOARD_LAYOUT_CHAR_KEY, true)

  // Apply the preference to the options
  const enhancedOptions = {
    ...options,
    // Only override if not explicitly set in options
    useKey: options?.useKey !== undefined ? options.useKey : useKeyChar,
  }

  return useHotkeysOriginal(keys, callback, enhancedOptions, dependencies)
}
