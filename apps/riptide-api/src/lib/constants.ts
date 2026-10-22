/**
 * Maximum allowed size for text content in artifacts.
 * Text artifacts are stored directly in PostgreSQL, competing with operational queries.
 * 10MB is generous for code files while being more conservative than the 50MB binary limit.
 */
export const MAX_TEXT_CONTENT_BYTES = 10 * 1024 * 1024 // 10 MB

/** Maximum request size for daemon CodeLayer state uploads. */
export const MAX_CODELAYER_STATE_BYTES = 50 * 1024 * 1024 // 50 MB
