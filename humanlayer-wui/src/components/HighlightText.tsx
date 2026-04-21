import { highlightSubstringMatches } from '@/lib/conversation-search'

interface HighlightTextProps {
  text: string
  query?: string
  isCurrentMatch?: boolean
}

export function HighlightText({ text, query, isCurrentMatch }: HighlightTextProps) {
  if (!query || !text) return <>{text}</>

  const segments = highlightSubstringMatches(text, query)
  if (segments.every(s => !s.isMatch)) return <>{text}</>

  const matchClass = isCurrentMatch
    ? 'bg-accent/40 text-accent-foreground rounded-sm px-0.5'
    : 'bg-yellow-500/30 text-inherit rounded-sm px-0.5'

  return (
    <>
      {segments.map((segment, i) =>
        segment.isMatch ? (
          <mark key={i} className={matchClass}>
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  )
}
