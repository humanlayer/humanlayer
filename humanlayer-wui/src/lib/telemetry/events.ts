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
} as const

export type PostHogEvent = (typeof POSTHOG_EVENTS)[keyof typeof POSTHOG_EVENTS]
