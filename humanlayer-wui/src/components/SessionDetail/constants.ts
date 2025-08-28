/**
 * Constants specific to SessionDetail components
 */

// ===============================
// Token Usage Configuration
// ===============================

/** Token usage thresholds for visual warnings */
export const TOKEN_USAGE_THRESHOLDS = {
  /** Show warning color at 60% usage */
  WARNING: 60,
  /** Show error color at 90% usage */
  CRITICAL: 90,
} as const

/** Default context limit when not provided by backend (200k total - 32k output reserved) */
export const DEFAULT_CONTEXT_LIMIT = 168000

// ===============================
// Display Configuration
// ===============================

/** Maximum length for displaying tool parameters in session detail */
export const MAX_TOOL_PARAMETER_DISPLAY_LENGTH = 100

/** Default truncation length for long text content */
export const DEFAULT_TEXT_TRUNCATION_LENGTH = 200

// ===============================
// Interaction Timing
// ===============================

/** Delay for highlighting new content (milliseconds) */
export const NEW_CONTENT_HIGHLIGHT_DELAY = 300

/** Duration for auto-scroll animations (milliseconds) */
export const AUTO_SCROLL_DURATION = 500
