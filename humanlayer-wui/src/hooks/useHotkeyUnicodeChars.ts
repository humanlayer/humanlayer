import { useState, useEffect } from 'react'

/**
 * Hook to provide platform-specific Unicode characters for hotkey display
 * Automatically detects the OS and provides appropriate symbols
 */
export function useHotkeyUnicodeChars() {
  const [os, setOs] = useState('macOS')
  const [modKey, setModKey] = useState('⌘')
  const [optKey, setOptKey] = useState('⌥')

  useEffect(() => {
    const userAgent = window.navigator.userAgent
    const platform = window.navigator.platform

    if (platform.indexOf('Mac') !== -1) {
      setOs('macOS')
      setModKey('⌘')
      setOptKey('⌥')
    } else if (platform.indexOf('Win') !== -1) {
      setOs('Windows')
      setModKey('Ctrl')
      setOptKey('Alt')
    } else if (/Android/.test(userAgent)) {
      setOs('Android')
      setModKey('Ctrl')
      setOptKey('Alt')
    } else if (/iPhone|iPad|iPod/.test(userAgent)) {
      setOs('iOS')
      setModKey('⌘')
      setOptKey('⌥')
    } else if (/Linux/.test(platform)) {
      setOs('Linux')
      setModKey('Ctrl')
      setOptKey('Alt')
    }
  }, [])

  return {
    Mod: modKey,
    Opt: optKey,
    Shift: '⇧',
    Enter: '↵',
    Up: '↑',
    Right: '→',
    Down: '↓',
    Left: '←',
    Tab: '⇥',
    Escape: 'Esc',
    OperatingSystem: os,
    isMac: os === 'macOS' || os === 'iOS',
  }
}

/**
 * Format a hotkey string for display based on the current OS
 *
 * @param hotkey - The hotkey string (e.g., "⌘+K", "Ctrl+X")
 * @param unicodeChars - The unicode characters from useHotkeyUnicodeChars
 * @returns The formatted hotkey string
 */
export function formatHotkeyForDisplay(
  hotkey: string,
  unicodeChars: ReturnType<typeof useHotkeyUnicodeChars>,
): string {
  let formatted = hotkey

  // Replace Mac-specific symbols with cross-platform versions
  if (!unicodeChars.isMac) {
    formatted = formatted
      .replace(/⌘\+/g, `${unicodeChars.Mod}+`)
      .replace(/⌥\+/g, `${unicodeChars.Opt}+`)
      .replace(/⇧\+/g, 'Shift+')
  }

  // Keep Mac symbols on Mac
  if (unicodeChars.isMac) {
    formatted = formatted.replace(/Ctrl\+/gi, '⌘+').replace(/Alt\+/gi, '⌥+')
  }

  return formatted
}
