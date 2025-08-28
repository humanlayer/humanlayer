/**
 * Centralized constants for timing values and cross-cutting concerns
 */

// ===============================
// Timing Constants
// ===============================

/** Application timing constants for intervals and delays */
export const TIMING = {
  // Connection and health check intervals
  CONNECTION_HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  HEALTH_CHECK_INTERVAL: 5000, // 5 seconds for general health checks

  // Retry and timeout values
  CONNECTION_RETRY_DELAY: 500, // 500ms between connection retries
  REQUEST_TIMEOUT: 5000, // 5 seconds for HTTP requests

  // UI interaction delays
  NOTIFICATION_DURATION: 3000, // 3 seconds for notifications
  DEBOUNCE_DELAY: 300, // 300ms for search debouncing
  SESSION_NAVIGATION_RECENT_THRESHOLD: 3000, // 3 seconds to consider "recently navigated"

  // Cache and persistence timers
  OPTIMISTIC_UPDATE_STALE_THRESHOLD: 2000, // 2 seconds to consider optimistic updates stale
  G_PREFIX_MODE_AUTO_RESET: 2000, // 2 seconds to auto-reset g-prefix mode
  APPROVAL_RETRY_INTERVAL: 5000, // 5 seconds for approval polling

  // Demo and animation timing
  DEMO_DEFAULT_DELAY: 1000, // 1 second default delay for demo sequences
  DEMO_SHORT_DELAY: 500, // 500ms for quick transitions
  DEMO_LONG_DELAY: 2000, // 2 seconds for longer pauses
} as const

// ===============================
// Size and Length Limits
// ===============================

/** UI display limits and thresholds */
export const DISPLAY_LIMITS = {
  // Text truncation limits
  MAX_PARAMETER_LENGTH: 100, // Maximum length for formatted parameters
  MAX_PATH_LENGTH: 40, // Default max length for path truncation
  MIN_PATH_END_CHARS: 30, // Minimum chars to show at end of truncated paths
  MAX_NOTIFICATION_TEXT_LENGTH: 40, // Maximum length for notification text
  SESSION_TITLE_TRUNCATE_LENGTH: 100, // Max length for session titles in notifications

  // Collection size limits
  MAX_RECENT_SESSIONS_SET_SIZE: 50, // Maximum number of recent sessions to track

  // Date formatting thresholds
  RELATIVE_DATE_THRESHOLD_DAYS: 7, // Show relative dates for items newer than 7 days
} as const

// ===============================
// HTTP and Network Constants
// ===============================

/** Network configuration values */
export const NETWORK = {
  DEFAULT_DAEMON_PORT: '7777',
  MAX_CONNECTION_RETRIES: 3,

  // HTTP Status codes for error handling
  STATUS_CODES: {
    CONFLICT: 409,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
  },
} as const

// ===============================
// Theme and Color Constants
// ===============================

/** Theme configuration */
export const THEME = {
  DEFAULT_THEME: 'solarized-dark',
  STORAGE_KEY: 'wui-theme',
} as const

// ===============================
// Search and Fuzzy Search
// ===============================

/** Search configuration values */
export const SEARCH = {
  FUZZY_THRESHOLD: 0.1, // Fuzzy search threshold
  MIN_MATCH_CHAR_LENGTH: 1, // Minimum character length for fuzzy matches
  BASE_SCORE_BONUS: 100, // Base score bonus for exact matches
  EXACT_MATCH_BONUS: 100, // Additional bonus for exact path matches
} as const
