/**
 * UUID validation utilities for path parameter sanitization.
 * Provides defense-in-depth against SQL injection by rejecting
 * malformed path params before query construction.
 */

/**
 * Regex for validating UUID format (v1-v7 and NIL UUID).
 * Accepts lowercase/uppercase hex characters with standard UUID hyphenation.
 * This is permissive on the version/variant bytes to support all UUID versions
 * including UUIDv7 which this codebase uses.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates that a string is a well-formed UUID.
 *
 * @param value - The string to validate
 * @returns true if the value matches UUID format, false otherwise
 */
export function isUuid(value: string): boolean {
	return UUID_RE.test(value)
}
