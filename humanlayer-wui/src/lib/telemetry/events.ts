/**
 * PostHog event names - centralized for consistency
 * All events should be past tense and snake_case
 */
export const POSTHOG_EVENTS = {
  // App lifecycle
  APP_LAUNCHED: 'app_launched',

  // Session management
  SESSION_CREATED: 'session_created',
  SESSION_CONTINUED: 'session_continued',
  SESSION_ARCHIVED: 'session_archived',
  SESSION_UNARCHIVED: 'session_unarchived',
  SESSION_FORKED: 'session_forked',

  // Draft management
  DRAFT_CREATED: 'draft_created',
  DRAFT_DELETED: 'draft_deleted',
  DRAFT_LAUNCHER_OPENED: 'draft_launcher_opened',
  DRAFT_LAUNCHER_EXITED: 'draft_launcher_exited',

  // Commands and agents
  SLASH_COMMAND_USED: 'slash_command_used',
  SUBAGENT_INVOKED: 'subagent_invoked',

  // Fork flow
  FORK_MODAL_OPENED: 'fork_modal_opened',

  // Settings and preferences
  SETTINGS_OPENED: 'settings_opened',
  SETTINGS_CHANGED: 'settings_changed',
  TELEMETRY_OPT_IN: 'telemetry_opt_in',
  TELEMETRY_OPT_OUT: 'telemetry_opt_out',
  MODEL_SELECTED: 'model_selected',

  // UI interactions
  COMMAND_LAUNCHER_OPENED: 'command_launcher_opened',
  COMMAND_LAUNCHER_SELECTION: 'command_launcher_selection',
  HOTKEY_HELPER_VIEWED: 'hotkey_helper_viewed',

  // Approval flow (optional - low priority)
  APPROVAL_RECEIVED: 'approval_received',
  APPROVAL_RESPONDED: 'approval_responded',
  APPROVAL_TIMEOUT: 'approval_timeout',
} as const

export type PostHogEvent = (typeof POSTHOG_EVENTS)[keyof typeof POSTHOG_EVENTS]
