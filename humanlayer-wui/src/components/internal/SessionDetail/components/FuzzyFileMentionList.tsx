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
  command: (item: { id: string; label: string }) => void
  editor: Editor
}

interface FileMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FileMatch {
  path: string
  score: number
  matchedIndexes: number[]
  isDirectory: boolean
}

export const FuzzyFileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
  ({ query, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [results, setResults] = useState<FileMatch[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const activeSessionDetail = useStore(state => state.activeSessionDetail)
    const sessionWorkingDir = activeSessionDetail?.session?.workingDir

    // Memoize additionalDirectories to prevent infinite loop from creating new array on every render
    const additionalDirectories = useMemo(
      () => activeSessionDetail?.session?.additionalDirectories || [],
      [activeSessionDetail?.session?.additionalDirectories],
    )

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
            command({ id: selected.path, label: selected.path })
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
    if (isLoading) {
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

    // Helper to extract filename from path
    const getFileName = (path: string): string => {
      const parts = path.split('/')
      return parts[parts.length - 1] || path
    }

    // Helper to get relative path from working directory
    const getRelativePath = (path: string): string | null => {
      if (!sessionWorkingDir) return null
      if (path.startsWith(sessionWorkingDir + '/')) {
        return path.substring(sessionWorkingDir.length + 1)
      }
      return null
    }

    // Render file list
    return (
      <div className="p-1">
        <div className="max-h-[360px] overflow-y-auto">
          {results.map((result, index) => {
            const fileName = getFileName(result.path)
            const relativePath = getRelativePath(result.path)
            const displayPath = relativePath || result.path
            const displayName = getFileName(displayPath)

            // Get parent directory for context
            const pathParts = displayPath.split('/')
            const parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : null

            // Highlight matches in the filename
            const highlighted = result.matchedIndexes?.length
              ? highlightMatches(fileName, result.matchedIndexes)
              : null

            return (
              <Button
                key={result.path}
                variant="ghost"
                size="sm"
                className={cn(
                  'w-full justify-start px-2 py-1.5 h-auto',
                  index === selectedIndex ? 'bg-accent text-accent-foreground' : '',
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  command({ id: result.path, label: result.path })
                }}
              >
                <div className="flex items-start gap-2 w-full min-w-0">
                  {result.isDirectory ? (
                    <FolderIcon className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="text-sm truncate w-full">
                      {highlighted ? (
                        <>
                          {highlighted.map((segment, i) => (
                            <span
                              key={i}
                              className={cn(segment.highlighted && 'bg-accent/40 font-medium')}
                            >
                              {segment.text}
                            </span>
                          ))}
                          {result.isDirectory && <span className="text-muted-foreground">/</span>}
                        </>
                      ) : (
                        <>
                          {displayName}
                          {result.isDirectory && <span className="text-muted-foreground">/</span>}
                        </>
                      )}
                    </span>
                    {parentPath && (
                      <span className="text-xs text-muted-foreground truncate w-full">
                        in {parentPath}
                      </span>
                    )}
                  </div>
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
