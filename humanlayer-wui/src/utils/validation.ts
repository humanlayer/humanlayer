/**
 * Check if a string value is empty or only contains whitespace
 */
export function isEmptyOrWhitespace(value: string): boolean {
  return !value.trim()
}

/**
 * Check if a string value has non-whitespace content
 */
export function hasContent(value: string): boolean {
  return value.trim().length > 0
}
