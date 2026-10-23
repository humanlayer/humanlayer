import { cn } from '@humanlayer/ui/lib/utils'
import { useCallback, type FC } from 'react'
import type React from 'react'
import { CommentedLine } from './commented-line'

export interface ArtifactRawProps {
  content: string
  fileName?: string
  className?: string
  commentedLines?: Map<number, Array<{ userId: string; displayName?: string; avatarUrl?: string }>>
  /** Disable the legacy line-comment treatment while retaining source search. */
  showCommentBadges?: boolean
  /** Current search query for multi-match highlighting */
  searchQuery?: string
  /** The currently-active match (line + 0-based occurrence within line); rendered with outline + scrolled into view */
  searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
  onLineClick?: (lineNumber: number) => void
}

/** Render a line with multi-match search highlighting */
function renderLineContent(
  line: string,
  searchQuery: string | undefined,
  isCurrentLine: boolean,
  currentOccurrence: number | undefined,
  activeMatchRef: React.Ref<HTMLElement>,
): React.ReactNode {
  if (!searchQuery) return line
  const lower = line.toLowerCase()
  const queryLower = searchQuery.toLowerCase()
  if (lower.indexOf(queryLower) === -1) return line

  const segments: React.ReactNode[] = []
  let cursor = 0
  let occurrence = 0
  while (cursor <= lower.length) {
    const idx = lower.indexOf(queryLower, cursor)
    if (idx === -1) {
      segments.push(line.slice(cursor))
      break
    }
    if (idx > cursor) segments.push(line.slice(cursor, idx))
    const isActive = isCurrentLine && occurrence === currentOccurrence
    segments.push(
      <mark
        key={`m-${idx}`}
        ref={isActive ? activeMatchRef : undefined}
        data-search-match=""
        data-search-active={isActive ? 'true' : undefined}
        className={
          isActive
            ? 'bg-[var(--terminal-warning)]/60 outline outline-1 outline-[var(--terminal-warning)] rounded-sm'
            : 'bg-[var(--terminal-warning)]/20 rounded-sm'
        }
      >
        {line.slice(idx, idx + searchQuery.length)}
      </mark>,
    )
    cursor = idx + Math.max(1, searchQuery.length)
    occurrence++
  }
  return <>{segments}</>
}

export const ArtifactRaw: FC<ArtifactRawProps> = ({
  content,
  fileName,
  className,
  commentedLines,
  showCommentBadges = true,
  searchQuery,
  searchCurrentMatch,
  onLineClick,
}) => {
  const lines = content.split('\n')
  const visibleCommentedLines = showCommentBadges ? commentedLines : undefined
  const activeMatchRef = useCallback((el: HTMLElement | null) => {
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [])

  return (
    <div className={cn('font-mono text-sm', className)}>
      {fileName && (
        <div className="px-4 py-2 border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
          {fileName}
        </div>
      )}
      <pre className="p-4 bg-terminal-bg text-terminal-fg overflow-auto whitespace-pre-wrap break-words">
        {/* When there are no comments AND no search query, fast-path to a single text node */}
        {(!visibleCommentedLines || visibleCommentedLines.size === 0) && !searchQuery
          ? content
          : lines.map((line, index) => {
              const lineNumber = index + 1
              const authors = visibleCommentedLines?.get(lineNumber)
              const lineBreak = index < lines.length - 1 ? '\n' : ''
              const isCurrentLine = searchCurrentMatch?.line === lineNumber
              const rendered = renderLineContent(
                line,
                searchQuery,
                isCurrentLine,
                isCurrentLine ? searchCurrentMatch?.occurrence : undefined,
                activeMatchRef,
              )
              if (authors) {
                const prevHasComment = index > 0 && visibleCommentedLines?.has(lineNumber - 1)
                return (
                  <CommentedLine
                    key={lineNumber}
                    commentAuthors={authors}
                    onClick={onLineClick ? () => onLineClick(lineNumber) : undefined}
                    sourceLineNumber={lineNumber}
                    variant={searchQuery ? 'block' : undefined}
                    showBadge={!prevHasComment}
                  >
                    {rendered}
                    {lineBreak}
                  </CommentedLine>
                )
              }
              return (
                <span key={lineNumber}>
                  {rendered}
                  {lineBreak}
                </span>
              )
            })}
      </pre>
    </div>
  )
}
