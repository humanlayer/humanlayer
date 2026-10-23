/**
 * Rules for sanitizing message text before submission
 * Each rule has a pattern to match and a replacement string
 */
const MESSAGE_TEXT_SANITIZATION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
	// Replace non-breaking spaces (U+00A0) with regular spaces
	// TipTap sometimes inserts these when inserting content after mention nodes
	{ pattern: /\u00A0/g, replacement: ' ' },
]

/**
 * Sanitize message text before sending to backend
 * Applies all sanitization rules in order
 */
export function sanitizeMessageText(input: string): string {
	let sanitized = input
	for (const rule of MESSAGE_TEXT_SANITIZATION_RULES) {
		sanitized = sanitized.replace(rule.pattern, rule.replacement)
	}
	return sanitized
}
