import ansiRegex from 'ansi-regex'

interface AnsiSegment {
  text: string
  style?: {
    color?: string
    className?: string
  }
}

// Map ANSI codes to CSS variables
const colorMap: Record<number, string> = {
  30: 'var(--terminal-color-0)', // Black
  31: 'var(--terminal-color-1)', // Red
  32: 'var(--terminal-color-2)', // Green
  33: 'var(--terminal-color-3)', // Yellow
  34: 'var(--terminal-color-4)', // Blue
  35: 'var(--terminal-color-5)', // Magenta
  36: 'var(--terminal-color-6)', // Cyan
  37: 'var(--terminal-color-7)', // White
  90: 'var(--terminal-color-8)', // Bright Black
  91: 'var(--terminal-color-9)', // Bright Red
  92: 'var(--terminal-color-10)', // Bright Green
  93: 'var(--terminal-color-11)', // Bright Yellow
  94: 'var(--terminal-color-12)', // Bright Blue
  95: 'var(--terminal-color-13)', // Bright Magenta
  96: 'var(--terminal-color-14)', // Bright Cyan
  97: 'var(--terminal-color-15)', // Bright White
}

export function parseAnsiToSegments(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const regex = ansiRegex()
  let lastIndex = 0
  let currentStyle: AnsiSegment['style'] = undefined

  let match
  while ((match = regex.exec(text)) !== null) {
    // Add text before the escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        style: currentStyle ? { ...currentStyle } : undefined,
      })
    }

    // Parse the escape sequence
    const sequence = match[0]
    const codes = sequence.match(/\d+/g)?.map(Number) || []

    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentStyle = undefined
      } else if (colorMap[code]) {
        // Foreground color
        currentStyle = currentStyle || {}
        currentStyle.color = colorMap[code]
      }
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: currentStyle ? { ...currentStyle } : undefined,
    })
  }

  return segments
}

// Component for rendering ANSI text
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

// Helper to check if content likely contains ANSI codes
export function hasAnsiCodes(text: string): boolean {
  return ansiRegex().test(text)
}
