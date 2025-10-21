// Whitelist of allowed keys that are safe to send to PostHog
// For compliance and contract terms, we only send explicitly allowed properties
const ALLOWED_KEYS = [
  // App metadata
  'app_version',
  'build_type',
  'platform',
  'startup_time_ms',

  // Generic event metadata
  'category',
  'action',
  'count',
  'duration_ms',
  'timestamp',
  'page_name',

  // Model/provider (generic identifiers only)
  'model',
  'provider',
  'previous_model',
  'previous_provider',

  // Session properties
  'from_draft',

  // Command and agent properties
  'command_name',
  'subagent_type',
  'agent_name',
  'command_type',
  'command_category',

  // Draft properties
  'had_content',
  'lifetime_seconds',

  // Fork properties
  'archive_on_fork',

  // Settings properties
  'setting_name',

  // Approval properties
  'response',
  'response_time_ms',
  'tool_type',
  'timeout_seconds',

  // UI interaction properties
  'trigger_method',

  // Feature flags and settings (boolean values only)
  'feature_enabled',
  'setting_enabled',

  // UI interactions (generic only)
  'button_clicked',
  'menu_opened',
  'dialog_shown',

  // PostHog standard properties (automatically captured)
  // URL and navigation
  '$current_url',
  '$host',
  '$pathname',
  '$pageview',
  '$pageleave',
  '$autocapture',
  '$referrer',
  '$referring_domain',
  '$search_engine',

  // Browser and environment
  '$browser',
  '$browser_version',
  '$browser_language',
  '$browser_language_prefix',
  '$os',
  '$os_version',
  '$device',
  '$device_type',

  // Screen and viewport
  '$screen_height',
  '$screen_width',
  '$viewport_height',
  '$viewport_width',

  // Library and technical
  '$lib',
  '$lib_version',
  '$insert_id',
  '$time',
  '$timestamp',

  // Session and user
  '$session_id',
  '$event_type',
  'distinct_id',

  // Feature flags
  '$active_feature_flags',

  // Element properties (autocapture)
  '$el_text',
  'tag_name',
  'attr_class',
  'attr_id',
  'href',
] as const

export type AllowedPostHogKey = (typeof ALLOWED_KEYS)[number]

/**
 * Recursively sanitize an object, only keeping whitelisted keys
 * Logs warnings to console when keys are filtered for debugging
 */
export function sanitizeEventProperties(
  obj: Record<string, any>,
  depth = 0,
  path: string = 'root',
): Record<string, any> {
  // Prevent infinite recursion
  if (depth > 10) {
    console.warn(`[PostHog] Max depth reached at path: ${path}`)
    return {}
  }

  const sanitized: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = `${path}.${key}`

    // Check if key is in the whitelist
    const keyLower = key.toLowerCase()
    const isAllowed = ALLOWED_KEYS.some(allowed => keyLower === allowed.toLowerCase())

    if (!isAllowed) {
      // Noisy logging for filtered keys - helps catch mistakes
      console.warn(
        `[PostHog] Filtered non-whitelisted property: "${key}" at ${currentPath}`,
        `Value type: ${typeof value}`,
        `Consider adding to ALLOWED_KEYS if this should be tracked`,
      )
      continue // Skip this property entirely
    }

    // Property is allowed, process the value
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      const sanitizedNested = sanitizeEventProperties(value, depth + 1, currentPath)
      // Only keep if the nested object has whitelisted properties
      if (Object.keys(sanitizedNested).length > 0) {
        sanitized[key] = sanitizedNested
      }
    } else if (typeof value === 'string') {
      // Extra safety: check for patterns that look like secrets even in allowed keys
      // Look for API key patterns: long alphanumeric strings with minimal dashes/underscores
      const hasMultipleDashes = (value.match(/-/g) || []).length > 3
      const looksLikeSecret = value.length > 30 && /^[a-zA-Z0-9_-]+$/.test(value) && !hasMultipleDashes

      if (looksLikeSecret) {
        console.warn(
          `[PostHog] Filtered potential secret in whitelisted key: "${key}" at ${currentPath}`,
        )
        // Skip this property entirely, even though key is whitelisted
        continue
      } else if (value.includes('/home/') || value.includes('/Users/') || value.includes('C:\\')) {
        console.warn(`[PostHog] Filtered file path in whitelisted key: "${key}" at ${currentPath}`)
        // Skip this property entirely, even though key is whitelisted
        continue
      } else {
        sanitized[key] = value
      }
    } else {
      // Keep other types as-is (numbers, booleans, etc.)
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitize URL parameters using whitelist approach
 */
export function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const params = new URLSearchParams(urlObj.search)
    const sanitizedParams = new URLSearchParams()

    // Only keep whitelisted parameters
    for (const [key, value] of params.entries()) {
      const keyLower = key.toLowerCase()
      const isAllowed = ALLOWED_KEYS.some(allowed => keyLower === allowed.toLowerCase())

      if (isAllowed) {
        sanitizedParams.set(key, value)
      } else {
        console.warn(`[PostHog] Filtered non-whitelisted URL parameter: "${key}"`)
      }
    }

    urlObj.search = sanitizedParams.toString()
    return urlObj.toString()
  } catch {
    // If URL parsing fails, return placeholder
    console.warn('[PostHog] Failed to parse URL for sanitization')
    return '[INVALID_URL]'
  }
}
