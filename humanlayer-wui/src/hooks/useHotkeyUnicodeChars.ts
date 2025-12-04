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

/**
 * Format a react-hotkeys-hook binding string for display.
 * Converts internal format (meta+shift+s) to display format (⌘⇧S on Mac, Ctrl+Shift+S on Windows)
 *
 * @param binding - The binding string from react-hotkeys-hook (e.g., "meta+shift+s, ctrl+shift+s")
 * @param isMac - Whether the current platform is Mac
 * @returns The formatted display string
 */
export function formatBindingForDisplay(binding: string, isMac: boolean): string {
  // Take the first binding if there are alternatives
  const parts = binding.split(',')
  // Prefer the mac binding on mac, otherwise prefer non-ctrl binding
  let primary = parts[0].trim()
  if (isMac && parts.length > 1) {
    const macBinding = parts.find(p => p.includes('meta') || p.includes('cmd'))
    if (macBinding) primary = macBinding.trim()
  } else if (!isMac && parts.length > 1) {
    const winBinding = parts.find(p => p.includes('ctrl'))
    if (winBinding) primary = winBinding.trim()
  }

  // Handle sequence bindings (g>s)
  if (primary.includes('>')) {
    const seqParts = primary.split('>')
    return seqParts.map(p => p.trim().toUpperCase()).join(' then ')
  }

  // Parse modifier+key format
  const keyParts = primary.split('+').map(p => p.trim().toLowerCase())

  const modifiers: string[] = []
  let mainKey = ''

  for (const part of keyParts) {
    if (part === 'meta' || part === 'cmd' || part === 'command') {
      modifiers.push(isMac ? '⌘' : 'Ctrl')
    } else if (part === 'ctrl' || part === 'control') {
      modifiers.push(isMac ? '⌃' : 'Ctrl')
    } else if (part === 'alt' || part === 'option') {
      modifiers.push(isMac ? '⌥' : 'Alt')
    } else if (part === 'shift') {
      modifiers.push(isMac ? '⇧' : 'Shift')
    } else if (part === 'enter' || part === 'return') {
      mainKey = isMac ? '↵' : 'Enter'
    } else if (part === 'escape' || part === 'esc') {
      mainKey = 'Esc'
    } else if (part === 'backspace') {
      mainKey = isMac ? '⌫' : 'Backspace'
    } else if (part === 'tab') {
      mainKey = isMac ? '⇥' : 'Tab'
    } else if (part === 'arrowup') {
      mainKey = '↑'
    } else if (part === 'arrowdown') {
      mainKey = '↓'
    } else if (part === 'arrowleft') {
      mainKey = '←'
    } else if (part === 'arrowright') {
      mainKey = '→'
    } else {
      mainKey = part.toUpperCase()
    }
  }

  if (isMac) {
    // Mac style: ⌘⇧S (no separators)
    return [...modifiers, mainKey].join('')
  } else {
    // Windows/Linux style: Ctrl+Shift+S
    return [...modifiers, mainKey].join('+')
  }
}
