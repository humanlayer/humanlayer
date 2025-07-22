export type HotkeyCategory = 'global' | 'session_list' | 'session_detail'

export interface HotkeyDefinition {
  key: string
  description: string
  category: HotkeyCategory
}

// Define the available hotkey keys
export type HotkeyKey =
  | 'SHOW_HELP'
  | 'SEARCH'
  | 'COMMAND_PALETTE'
  | 'CREATE_SESSION'
  | 'TOGGLE_THEME'
  | 'NAVIGATE_APPROVALS'
  | 'NAVIGATE_SESSIONS'
  | 'JUMP_TO_TOP'
  | 'JUMP_TO_BOTTOM'
  | 'TOGGLE_ARCHIVED_VIEW'
  | 'TOGGLE_ARCHIVED_VIEW_BACK'
  | 'EXIT_ARCHIVED_VIEW'
  | 'NAVIGATE_NEXT_EVENT'
  | 'NAVIGATE_PREVIOUS_EVENT'
  | 'INTERRUPT_SESSION'
  | 'APPROVE_REQUEST'
  | 'DENY_REQUEST'
  | 'NAVIGATE_DOWN'
  | 'NAVIGATE_UP'
  | 'BULK_SELECT_DOWN'
  | 'BULK_SELECT_UP'
  | 'SELECT_ALL'
  | 'OPEN_SESSION'
  | 'ARCHIVE_SESSION'
  | 'TOGGLE_SELECTION'
  | 'OPEN_FORK_VIEW'
  | 'INSPECT_TOOL_RESULT'
  | 'COPY_MESSAGE_CONTENT'
  | 'NAVIGATE_TO_PARENT'
  | 'ARCHIVE_SESSION_DETAIL'
  | 'JUMP_TO_BOTTOM_DETAIL'
  | 'JUMP_TO_TOP_DETAIL'
  | 'CLOSE_MODAL'
  | 'AUTO_ACCEPT_EDITS'
  | 'OPEN_FORK_VIEW_MODAL'
  | 'FOCUS_INPUT'
  | 'COPY_CONTENT'
  | 'COPY_CONTENT_ALT'

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
  COMMAND_PALETTE: {
    key: 'cmd+k',
    description: 'Open command palette',
    category: 'global',
  },
  CREATE_SESSION: {
    key: 'c',
    description: 'Create new session',
    category: 'global',
  },
  TOGGLE_THEME: {
    key: 'ctrl+t',
    description: 'Toggle theme',
    category: 'global',
  },
  NAVIGATE_APPROVALS: {
    key: 'g>a',
    description: 'Go to approvals',
    category: 'global',
  },
  NAVIGATE_SESSIONS: {
    key: 'g>s',
    description: 'Go to sessions',
    category: 'global',
  },
  JUMP_TO_TOP: {
    key: 'g>g',
    description: 'Jump to top',
    category: 'session_list',
  },
  JUMP_TO_BOTTOM: {
    key: 'shift+g',
    description: 'Jump to bottom',
    category: 'session_list',
  },
  TOGGLE_ARCHIVED_VIEW: {
    key: 'tab',
    description: 'Toggle archived view',
    category: 'session_list',
  },
  TOGGLE_ARCHIVED_VIEW_BACK: {
    key: 'shift+tab',
    description: 'Toggle archived view',
    category: 'session_list',
  },
  EXIT_ARCHIVED_VIEW: {
    key: 'escape',
    description: 'Exit archived view',
    category: 'session_list',
  },
  NAVIGATE_NEXT_EVENT: {
    key: 'j',
    description: 'Next event',
    category: 'session_detail',
  },
  NAVIGATE_PREVIOUS_EVENT: {
    key: 'k',
    description: 'Previous event',
    category: 'session_detail',
  },
  INTERRUPT_SESSION: {
    key: 'ctrl+x',
    description: 'Interrupt session',
    category: 'session_detail',
  },
  APPROVE_REQUEST: {
    key: 'a',
    description: 'Approve request',
    category: 'session_detail',
  },
  DENY_REQUEST: {
    key: 'd',
    description: 'Deny request',
    category: 'session_detail',
  },
  NAVIGATE_DOWN: {
    key: 'j',
    description: 'Navigate down',
    category: 'session_list',
  },
  NAVIGATE_UP: {
    key: 'k',
    description: 'Navigate up',
    category: 'session_list',
  },
  BULK_SELECT_DOWN: {
    key: 'shift+j',
    description: 'Bulk select down',
    category: 'session_list',
  },
  BULK_SELECT_UP: {
    key: 'shift+k',
    description: 'Bulk select up',
    category: 'session_list',
  },
  SELECT_ALL: {
    key: 'cmd+a',
    description: 'Select all',
    category: 'session_list',
  },
  OPEN_SESSION: {
    key: 'enter',
    description: 'Open session',
    category: 'session_list',
  },
  ARCHIVE_SESSION: {
    key: 'e',
    description: 'Archive/unarchive session',
    category: 'session_list',
  },
  TOGGLE_SELECTION: {
    key: 'x',
    description: 'Toggle selection',
    category: 'session_list',
  },
  OPEN_FORK_VIEW: {
    key: 'o',
    description: 'Open fork view',
    category: 'session_list',
  },
  INSPECT_TOOL_RESULT: {
    key: 'i',
    description: 'Inspect tool result',
    category: 'session_detail',
  },
  COPY_MESSAGE_CONTENT: {
    key: 'y',
    description: 'Copy message content',
    category: 'session_detail',
  },
  NAVIGATE_TO_PARENT: {
    key: 'p',
    description: 'Navigate to parent session',
    category: 'session_detail',
  },
  ARCHIVE_SESSION_DETAIL: {
    key: 'e',
    description: 'Archive session',
    category: 'session_detail',
  },
  JUMP_TO_BOTTOM_DETAIL: {
    key: 'shift+g',
    description: 'Jump to bottom',
    category: 'session_detail',
  },
  JUMP_TO_TOP_DETAIL: {
    key: 'g>g',
    description: 'Jump to top',
    category: 'session_detail',
  },
  CLOSE_MODAL: {
    key: 'escape',
    description: 'Close modal/dialog',
    category: 'global',
  },
  AUTO_ACCEPT_EDITS: {
    key: 'shift+tab',
    description: 'Auto-accept edits mode',
    category: 'session_detail',
  },
  OPEN_FORK_VIEW_MODAL: {
    key: 'cmd+y',
    description: 'Open fork view',
    category: 'session_detail',
  },
  FOCUS_INPUT: {
    key: 'enter',
    description: 'Focus message input',
    category: 'session_detail',
  },
  COPY_CONTENT: {
    key: 'cmd+c',
    description: 'Copy content',
    category: 'global',
  },
  COPY_CONTENT_ALT: {
    key: 'cmd+shift+c',
    description: 'Copy alternative content',
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
