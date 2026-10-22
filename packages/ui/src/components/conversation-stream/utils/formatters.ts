import type { ApprovalStatus } from '../types'

export function getApprovalStatusColor(status?: ApprovalStatus): string {
	switch (status) {
		case 'pending':
			return 'text-[var(--terminal-warning)]'
		case 'approved':
		case 'resolved':
			return 'text-[var(--terminal-success)]'
		case 'denied':
			return 'text-[var(--terminal-error)]'
		default:
			return ''
	}
}

export function formatFilePath(path: string | undefined, workingDir?: string): string {
	if (!path) {
		return ''
	}
	if (!workingDir || !path.startsWith(workingDir)) {
		return path
	}
	const relativePath = path.slice(workingDir.length)
	return relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
}

export function truncateText(text: string | undefined | null, maxLength: number): string {
	if (!text) return ''
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength - 3)}...`
}

export function formatToolResult(content: string, maxLines = 1): string | null {
	const lines = content.split('\n').filter((l) => l.trim())
	if (lines.length === 0) {
		return null
	}
	if (lines.length <= maxLines) {
		return lines.map((l) => (l.length > 80 ? `${l.slice(0, 77)}...` : l)).join('\n')
	}
	const suffix = ` ... (${lines.length} lines)`
	const displayLines = lines.slice(0, maxLines).map((l, i) => {
		if (i < maxLines - 1) {
			return l.length > 80 ? `${l.slice(0, 77)}...` : l
		}
		return `${l.length > 60 ? `${l.slice(0, 57)}...` : l}${suffix}`
	})
	return displayLines.join('\n')
}

/**
 * Parse exit code from plain-text Bash tool result content.
 * The Claude Agent SDK formats failures as "Exit code N\n..." with exit code on the first line.
 */
export function parseExitCode(content: string | undefined): number | null {
	if (!content) return null
	const match = content.match(/^Exit code (\d+)/)
	if (!match) return null
	const [, digits] = match
	return digits === undefined ? null : Number.parseInt(digits, 10)
}

/**
 * Counts the number of lines in content, excluding system-reminder sections.
 * Uses string manipulation instead of XML parsing to handle special characters
 * in source code files (e.g., <, >, &) that would break XML parsing.
 */
export function formatLineCount(content: string): string {
	// Handle empty content
	if (!content || !content.trim()) {
		return '0 lines'
	}

	// Count total lines
	const totalLines = content.split('\n').length

	// Check if content has system-reminder tag
	const hasSystemReminder = content.includes('<system-reminder>')

	let lineCount: number
	if (hasSystemReminder) {
		// Simple approach: subtract 5 lines for system reminder (matching SessionDetail)
		// This is a reasonable approximation that works for most cases
		lineCount = Math.max(0, totalLines - 5)
	} else {
		// No system reminder, count all lines
		lineCount = totalLines
	}

	const lineWord = lineCount === 1 ? 'line' : 'lines'

	return `${lineCount} ${lineWord}`
}

export function parseMcpToolName(toolName: string): { service: string; method: string } {
	const parts = toolName.split('__')
	return {
		service: parts[1] || 'unknown',
		method: parts.slice(2).join('__') || 'unknown',
	}
}

/**
 * Content block type from MCP tool responses.
 * MCP servers return content in the format:
 * [{ type: "text", text: "..." }, { type: "image", ... }, ...]
 */
interface McpContentBlock {
	type: string
	text?: string
}

/**
 * Parse MCP tool result content to extract human-readable text.
 *
 * MCP tool results are stored as JSON arrays: [{"type":"text","text":"..."}]
 * This extracts and joins all text blocks, with placeholders for non-text content.
 *
 * @param content - The raw tool result content string (JSON or plain text)
 * @returns Parsed text content with newlines, or original content if parsing fails
 */
export function parseMcpTextContent(content: string | undefined): string | undefined {
	if (!content) return undefined

	try {
		const parsed = JSON.parse(content)
		if (!Array.isArray(parsed)) {
			// Not an array, return as-is
			return content
		}

		const parts: string[] = []
		for (const block of parsed as McpContentBlock[]) {
			if (block.type === 'text') {
				// Only add text blocks with non-empty text
				if (block.text) {
					parts.push(block.text)
				}
			} else if (block.type === 'image') {
				parts.push('[image content]')
			} else if (block.type === 'resource') {
				parts.push('[resource content]')
			} else if (block.type) {
				// Unknown type, show generic placeholder
				parts.push(`[${block.type} content]`)
			}
		}

		// If we extracted content, join with newlines
		if (parts.length > 0) {
			return parts.join('\n')
		}

		// Array was empty or had no recognized blocks, return original
		return content
	} catch {
		// JSON parse failed, return content as-is (might be plain text)
		return content
	}
}

/**
 * Decodes unicode escape sequences in a string.
 * Handles cases like \u0026 -> &, \u003c -> <, etc.
 */
export function decodeUnicodeEscapes(text: string | undefined | null): string {
	if (!text) return text || ''
	// Replace unicode escape sequences with their actual characters
	return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, code) => {
		return String.fromCharCode(parseInt(code, 16))
	})
}

/**
 * Formats a tool name for display by replacing underscores with spaces
 * and capitalizing each word (title case).
 *
 * Examples:
 *   get_artifact_comments -> Get Artifact Comments
 *   library_researcher -> Library Researcher
 *   read -> Read
 */
export function formatToolNameForDisplay(toolName: string | undefined): string {
	if (!toolName) return 'Unknown Tool'
	return toolName
		.replace(/_/g, ' ')
		.split(' ')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}
