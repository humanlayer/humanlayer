import ansiRegex from 'ansi-regex'

export interface AnsiSegment {
	text: string
	style?: {
		color?: string
		className?: string
	}
}

// Map ANSI SGR codes to terminal color CSS variables
const colorMap: Record<number, string> = {
	// Standard colors (30-37)
	30: 'var(--terminal-color-0)', // Black
	31: 'var(--terminal-color-1)', // Red
	32: 'var(--terminal-color-2)', // Green
	33: 'var(--terminal-color-3)', // Yellow
	34: 'var(--terminal-color-4)', // Blue
	35: 'var(--terminal-color-5)', // Magenta
	36: 'var(--terminal-color-6)', // Cyan
	37: 'var(--terminal-color-7)', // White
	// Bright colors (90-97)
	90: 'var(--terminal-color-8)', // Bright Black
	91: 'var(--terminal-color-9)', // Bright Red
	92: 'var(--terminal-color-10)', // Bright Green
	93: 'var(--terminal-color-11)', // Bright Yellow
	94: 'var(--terminal-color-12)', // Bright Blue
	95: 'var(--terminal-color-13)', // Bright Magenta
	96: 'var(--terminal-color-14)', // Bright Cyan
	97: 'var(--terminal-color-15)', // Bright White
}

/**
 * Parse ANSI-escaped text into styled segments.
 * Supports SGR codes 30-37 (standard colors), 90-97 (bright colors), and 0 (reset).
 */
export function parseAnsiToSegments(text: string): AnsiSegment[] {
	const segments: AnsiSegment[] = []
	const regex = ansiRegex()
	let lastIndex = 0
	let currentStyle: AnsiSegment['style']

	let match: RegExpExecArray | null
	// biome-ignore lint: assignment in while condition is intentional for regex iteration
	while ((match = regex.exec(text)) !== null) {
		// Add text before the escape sequence
		if (match.index > lastIndex) {
			segments.push({
				text: text.slice(lastIndex, match.index),
				style: currentStyle ? { ...currentStyle } : undefined,
			})
		}

		// Parse the escape sequence codes
		const sequence = match[0]
		const codes = sequence.match(/\d+/g)?.map(Number) || []

		for (const code of codes) {
			if (code === 0) {
				// Reset all styling
				currentStyle = undefined
			} else if (colorMap[code]) {
				// Apply foreground color
				currentStyle = currentStyle || {}
				currentStyle.color = colorMap[code]
			}
		}

		lastIndex = regex.lastIndex
	}

	// Add remaining text after last escape sequence
	if (lastIndex < text.length) {
		segments.push({
			text: text.slice(lastIndex),
			style: currentStyle ? { ...currentStyle } : undefined,
		})
	}

	return segments
}

/**
 * React component that renders ANSI-escaped text with terminal colors.
 */
export function AnsiText({ content }: { content: string }) {
	const segments = parseAnsiToSegments(content)

	return (
		<>
			{segments.map((segment, i) => (
				<span
					key={i}
					style={segment.style?.color ? { color: segment.style.color } : undefined}
					className={segment.style?.className}
				>
					{segment.text}
				</span>
			))}
		</>
	)
}

/**
 * Check if text contains ANSI escape sequences.
 * Use this to conditionally render AnsiText vs plain text.
 */
export function hasAnsiCodes(text: string): boolean {
	return ansiRegex().test(text)
}
