import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, useMemo } from 'react'
import { Editor } from '@tiptap/react'
import { AlertCircle, Loader2, FileIcon, FolderIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { daemonClient } from '@/lib/daemon/client'
import { highlightMatches } from '@/lib/fuzzy-search'
import { cn } from '@/lib/utils'

interface FileMentionListProps {
  query: string
  command: (item: { id: string; label: string; isDirectory?: boolean }) => void
  editor: Editor
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

export const FuzzyFileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
  ({ query, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [results, setResults] = useState<FileMatch[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [showLoader, setShowLoader] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const activeSessionDetail = useStore(state => state.activeSessionDetail)
    const sessionWorkingDir = activeSessionDetail?.session?.workingDir

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

    // Fetch files from daemon
    useEffect(() => {
      if (!sessionWorkingDir) {
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

      const fetchFiles = async () => {
        setIsLoading(true)
        setError(null)

        try {
          // Include working directory and any additional directories
          const searchPaths = [sessionWorkingDir, ...additionalDirectories]

          const response = await daemonClient.fuzzySearchFiles({
            query: query,
            paths: searchPaths,
            limit: 50,
            respectGitignore: true,
          })

          setResults(response.results || [])
          setError(null)
        } catch (err) {
          logger.error('Failed to fetch files:', err)
          setError('Failed to search files')
          setResults([])
        } finally {
          setIsLoading(false)
        }
      }

      fetchFiles()
    }, [query, sessionWorkingDir, additionalDirectories])

    // Reset selection when results change
    useEffect(() => {
      setSelectedIndex(0)
    }, [results])

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
            command({ id: selected.path, label: selected.displayPath, isDirectory: selected.isDirectory })
          }
          return true
        }

        if (event.key === 'Escape') {
          return false
        }

        return false
      },
      [results, selectedIndex, command],
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
      return <div className="px-3 py-2 text-sm text-muted-foreground">No files found</div>
    }

    // Render file list
    return (
      <div className="p-1">
        <div className="max-h-[360px] overflow-y-auto">
          {results.map((result, index) => {
            // Use displayPath from backend (already computed relative to working dir)
            const displayPath = result.displayPath || result.path

            // For highlighting, use the basename only since that's what we primarily match
            const lastSep = result.path.lastIndexOf('/')
            const basename = lastSep >= 0 ? result.path.substring(lastSep + 1) : result.path

            // Find which matched indexes are in the basename portion
            const basenameStartIdx = lastSep + 1
            const basenameIndexes = result.matchedIndexes
              ?.filter(idx => idx >= basenameStartIdx)
              .map(idx => idx - basenameStartIdx)

            // Highlight the basename
            const basenameHighlighted = basenameIndexes?.length
              ? highlightMatches(basename, basenameIndexes)
              : null

            return (
              <Button
                key={result.path}
                variant="ghost"
                size="sm"
                className={`w-full justify-start px-2 py-1 ${
                  index === selectedIndex ? 'bg-accent !text-[var(--terminal-bg)]' : ''
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  command({ id: result.path, label: result.displayPath, isDirectory: result.isDirectory })
                }}
              >
                <div className="flex items-center gap-2 w-full min-w-0">
                  {result.isDirectory ? (
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
                        {result.isDirectory && <span className="text-muted-foreground">/</span>}
                      </>
                    ) : (
                      <>
                        {displayPath}
                        {result.isDirectory && <span className="text-muted-foreground">/</span>}
                      </>
                    )}
                  </span>
                </div>
              </Button>
            )
          })}
        </div>
      </div>
    )
  },
)

FuzzyFileMentionList.displayName = 'FuzzyFileMentionList'
