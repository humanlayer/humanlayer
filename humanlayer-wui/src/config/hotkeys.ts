export type HotkeyCategory = 'global' | 'session_list' | 'session_detail'

export interface HotkeyDefinition {
  key: string
  description: string
  category: HotkeyCategory
}

// Define the available hotkey keys
export type HotkeyKey = 'SHOW_HELP' | 'SEARCH'

// Hotkey registry
export const HOTKEYS: Record<HotkeyKey, HotkeyDefinition> = {
  SHOW_HELP: {
    key: '?',
    description: 'Toggle keyboard shortcuts',
    category: 'global',
  },
  SEARCH: {
    key: '/',
    description: 'Search sessions',
    category: 'global',
  },
}

// Helper to get hotkey definition
export function getHotkey(key: HotkeyKey): HotkeyDefinition {
  return HOTKEYS[key]
}

// Helper to get all hotkeys as an array
export function getAllHotkeys(): Array<HotkeyDefinition & { id: HotkeyKey }> {
  return Object.entries(HOTKEYS).map(([id, definition]) => ({
    id: id as HotkeyKey,
    ...definition,
  }))
}

// Helper to get hotkeys by category
export function getHotkeysByCategory(
  category: HotkeyCategory,
): Array<HotkeyDefinition & { id: HotkeyKey }> {
  return getAllHotkeys().filter(hk => hk.category === category)
}
