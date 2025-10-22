import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useMemo,
  useRef,
} from 'react'
import { Editor } from '@tiptap/react'
import { AlertCircle, Loader2, FileIcon, FolderIcon, HatGlasses } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { daemonClient } from '@/lib/daemon/client'
import { highlightMatches } from '@/lib/fuzzy-search'
import { cn } from '@/lib/utils'
import fuzzy from 'fuzzy'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'

interface FileMentionListProps {
  query: string
  command: (item: { id: string; label: string; isDirectory?: boolean }) => void
  editor: Editor
  workingDir?: string
}

interface FileMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FileMatch {
  path: string
  displayPath: string
  score: number
  matchedIndexes: number[]
  isDirectory: boolean
}

interface AgentMatch {
  name: string
  mentionText: string
  description?: string
  score: number
  matchedIndexes: number[]
}

type MentionMatch = { type: 'file'; data: FileMatch } | { type: 'agent'; data: AgentMatch }

export const FuzzyFileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
  ({ query, command, workingDir }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [results, setResults] = useState<MentionMatch[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [showLoader, setShowLoader] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
    const activeSessionDetail = useStore(state => state.activeSessionDetail)
    const sessionWorkingDir = activeSessionDetail?.session?.workingDir
    const { trackEvent } = usePostHogTracking()

    // Memoize additionalDirectories to prevent infinite loop from creating new array on every render
    const additionalDirectories = useMemo(
      () => activeSessionDetail?.session?.additionalDirectories || [],
      [activeSessionDetail?.session?.additionalDirectories],
    )

    // Delay showing loader to avoid flashing
    useEffect(() => {
      if (!isLoading) {
        setShowLoader(false)
        return
      }

      const timer = setTimeout(() => {
        setShowLoader(true)
      }, 300)

      return () => clearTimeout(timer)
    }, [isLoading])

    // Fetch files and agents from daemon
    useEffect(() => {
      // Use passed workingDir prop first, then fall back to session from store
      const effectiveWorkingDir = workingDir || sessionWorkingDir

      if (!effectiveWorkingDir) {
        // No working directory - treat as empty state
        setResults([])
        setError(null)
        return
      }

      if (!query) {
        // Empty query - show working directory contents
        setResults([])
        return
      }

      const fetchMentions = async () => {
        setIsLoading(true)
        setError(null)

        try {
          // Fetch both files and agents in parallel
          const searchPaths = [effectiveWorkingDir, ...additionalDirectories]

          const [filesResponse, agents] = await Promise.all([
            // Fetch files
            daemonClient.fuzzySearchFiles({
              query: query,
              paths: searchPaths,
              limit: 50,
              respectGitignore: true,
            }),
            // Fetch agents
            daemonClient.discoverAgents(effectiveWorkingDir),
          ])

          // Process file results
          const fileMatches: MentionMatch[] = (filesResponse.results || []).map(file => ({
            type: 'file' as const,
            data: file,
          }))

          // Fuzzy match agents
          const agentMatches: MentionMatch[] = []
          if (agents && agents.length > 0) {
            // Match against mentionText (without @)
            const agentSearchText = agents.map(a => ({
              agent: a,
              searchText: a.mentionText.substring(1), // Remove @ for matching
            }))

            const fuzzyResults = fuzzy.filter(query, agentSearchText, {
              extract: (item: any) => item.searchText,
            })

            // Convert to MentionMatch format
            fuzzyResults.forEach((result: any) => {
              agentMatches.push({
                type: 'agent' as const,
                data: {
                  name: result.original.agent.name,
                  mentionText: result.original.agent.mentionText,
                  description: result.original.agent.description,
                  score: result.score,
                  matchedIndexes: result.index || [],
                },
              })
            })
          }

          // Combine results: agents first, then files
          const allMatches = [...agentMatches, ...fileMatches]
          setResults(allMatches)
          setError(null)
        } catch (err) {
          logger.error('Failed to fetch mentions:', err)
          setError('Failed to search mentions')
          setResults([])
        } finally {
          setIsLoading(false)
        }
      }

      fetchMentions()
    }, [query, workingDir, sessionWorkingDir, additionalDirectories])

    // Reset selection when results change
    useEffect(() => {
      setSelectedIndex(0)
    }, [results])

    // Scroll selected item into view
    useEffect(() => {
      const selectedButton = buttonRefs.current[selectedIndex]
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [selectedIndex])

    // Keyboard navigation
    const onKeyDown = useCallback(
      ({ event }: { event: KeyboardEvent }) => {
        if (results.length === 0) {
          if (event.key === 'Escape') {
            return false
          }
          return false
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex(prev => (prev - 1 + results.length) % results.length || 0)
          return true
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex(prev => (prev + 1) % results.length)
          return true
        }

        if (event.key === 'Tab') {
          event.preventDefault()
          if (event.shiftKey) {
            setSelectedIndex(prev => (prev - 1 + results.length) % results.length || 0)
          } else {
            setSelectedIndex(prev => (prev + 1) % results.length)
          }
          return true
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          if (results.length > 0) {
            const selected = results[selectedIndex]
            if (selected.type === 'agent') {
              const agent = selected.data as AgentMatch
              // Track subagent invoked event
              trackEvent(POSTHOG_EVENTS.SUBAGENT_INVOKED, {
                agent_name: agent.name,
              })
              command({
                id: agent.mentionText, // Keep the full @agent-<name> for the text insertion
                label: agent.mentionText.substring(1), // Remove @ from label since FileMentionNode adds it for display
                isDirectory: false,
              })
            } else {
              const file = selected.data as FileMatch
              command({
                id: '@' + file.path,
                label: file.displayPath,
                isDirectory: file.isDirectory,
              })
            }
          }
          return true
        }

        if (event.key === 'Escape') {
          return false
        }

        return false
      },
      [results, selectedIndex, command, trackEvent],
    )

    // Expose keyboard handler via ref
    useImperativeHandle(ref, () => ({
      onKeyDown,
    }))

    // Render loading state
    if (showLoader) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Searching files...</span>
        </div>
      )
    }

    // Render error state
    if (error) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )
    }

    // Render empty state
    if (results.length === 0) {
      return <div className="px-3 py-2 text-sm text-muted-foreground">No matches found</div>
    }

    // Render mention list (agents and files)
    return (
      <div className="max-h-[360px] overflow-y-auto flex flex-col">
        {results.map((result, index) => {
          if (result.type === 'agent') {
            const agent = result.data as AgentMatch

            return (
              <Button
                key={`agent-${agent.name}`}
                ref={el => (buttonRefs.current[index] = el)}
                variant="ghost"
                size="sm"
                className={`w-full justify-start px-2 py-1 ${
                  index === selectedIndex
                    ? 'bg-accent text-[var(--terminal-bg)] hover:text-[var(--terminal-accent)]'
                    : ''
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  // Track subagent invoked event
                  trackEvent(POSTHOG_EVENTS.SUBAGENT_INVOKED, {
                    agent_name: agent.name,
                  })
                  command({
                    id: agent.mentionText, // Keep the full @agent-<name> for the text insertion
                    label: agent.mentionText.substring(1), // Remove @ from label since FileMentionNode adds it for display
                    isDirectory: false,
                  })
                }}
              >
                <div className="flex items-center gap-2 w-full min-w-0">
                  <HatGlasses className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate w-full normal-case text-left">
                    {/* Highlight matched characters */}
                    {agent.matchedIndexes?.length > 0
                      ? highlightMatches(agent.mentionText, agent.matchedIndexes).map((segment, i) => (
                          <span
                            key={i}
                            className={cn(
                              segment.highlighted &&
                                (index === selectedIndex
                                  ? 'bg-accent-foreground/20 font-medium'
                                  : 'bg-accent/40 font-medium'),
                            )}
                          >
                            {segment.text}
                          </span>
                        ))
                      : agent.mentionText}
                  </span>
                </div>
              </Button>
            )
          } else {
            // File rendering
            const file = result.data as FileMatch
            // Use displayPath from backend (already computed relative to working dir)
            const displayPath = file.displayPath || file.path

            // For highlighting, use the basename only since that's what we primarily match
            const lastSep = file.path.lastIndexOf('/')
            const basename = lastSep >= 0 ? file.path.substring(lastSep + 1) : file.path

            // Find which matched indexes are in the basename portion
            const basenameStartIdx = lastSep + 1
            const basenameIndexes = file.matchedIndexes
              ?.filter(idx => idx >= basenameStartIdx)
              .map(idx => idx - basenameStartIdx)

            // Highlight the basename
            const basenameHighlighted = basenameIndexes?.length
              ? highlightMatches(basename, basenameIndexes)
              : null

            return (
              <Button
                key={file.path}
                ref={el => (buttonRefs.current[index] = el)}
                variant="ghost"
                size="sm"
                className={`w-full justify-start px-2 py-1 ${
                  index === selectedIndex
                    ? 'bg-accent text-[var(--terminal-bg)] hover:text-[var(--terminal-accent)]'
                    : ''
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  command({
                    id: '@' + file.path,
                    label: file.displayPath,
                    isDirectory: file.isDirectory,
                  })
                }}
              >
                <div className="flex items-center gap-2 w-full min-w-0">
                  {file.isDirectory ? (
                    <FolderIcon className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span className="text-sm truncate w-full normal-case text-left">
                    {basenameHighlighted ? (
                      <>
                        {/* Show directory path without highlighting */}
                        {displayPath.substring(0, displayPath.length - basename.length)}
                        {/* Show basename with highlighting */}
                        {basenameHighlighted.map((segment, i) => (
                          <span
                            key={i}
                            className={cn(
                              segment.highlighted &&
                                (index === selectedIndex
                                  ? 'bg-accent-foreground/20 font-medium'
                                  : 'bg-accent/40 font-medium'),
                            )}
                          >
                            {segment.text}
                          </span>
                        ))}
                        {file.isDirectory && <span className="text-muted-foreground">/</span>}
                      </>
                    ) : (
                      <>
                        {displayPath}
                        {file.isDirectory && <span className="text-muted-foreground">/</span>}
                      </>
                    )}
                  </span>
                </div>
              </Button>
            )
          }
        })}
      </div>
    )
  },
)

FuzzyFileMentionList.displayName = 'FuzzyFileMentionList'
