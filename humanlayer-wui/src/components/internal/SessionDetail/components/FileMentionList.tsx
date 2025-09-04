import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { FileIcon, FolderIcon, AlertCircleIcon, LoaderIcon } from 'lucide-react'
import { useFileBrowser } from '@/hooks/useFileBrowser'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'
import { highlightMatches } from '@/lib/fuzzy-search'

interface FileMentionItem {
  id: string
  label: string
}

interface FileMentionListProps {
  query: string
  command: (item: FileMentionItem) => void
  editor: any // TipTap editor instance - required for navigation
}

export interface FileMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const FileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
  ({ query, command, editor }, ref) => {
    // Get the active session's working directory from the store
    const activeSessionDetail = useStore(state => state.activeSessionDetail)
    const sessionWorkingDir = activeSessionDetail?.session?.workingDir

    const [selectedIndex, setSelectedIndex] = useState(0)
    const [currentPath, setCurrentPath] = useState<string>(sessionWorkingDir || '~')
    const [searchQuery, setSearchQuery] = useState<string>('')
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    // Parse the query to separate path navigation from search
    useEffect(() => {
      // Handle special navigation characters
      if (query === '/') {
        // User typed '/' to navigate to root
        setCurrentPath('/')
        setSearchQuery('')
        return
      } else if (query === '~') {
        // User typed '~' to navigate to home
        setCurrentPath('~')
        setSearchQuery('')
        return
      }

      // Handle normal path navigation
      if (query.startsWith('/')) {
        // Absolute path from root
        const pathWithoutLeadingSlash = query.substring(1) // Remove leading '/'

        // Check if this is navigating into a directory (ends with /)
        if (pathWithoutLeadingSlash.endsWith('/')) {
          // Extract the directory path (e.g., "/other/path/" -> "/other/path")
          const dirPath = pathWithoutLeadingSlash.slice(0, -1) // Remove trailing slash
          setCurrentPath(dirPath ? `/${dirPath}` : '/')
          setSearchQuery('')
        } else if (pathWithoutLeadingSlash.includes('/')) {
          // Has subdirectories with possible search (e.g., "/dir/subdir/search")
          const lastSlashIndex = pathWithoutLeadingSlash.lastIndexOf('/')
          const dirPath = pathWithoutLeadingSlash.substring(0, lastSlashIndex)
          const searchPart = pathWithoutLeadingSlash.substring(lastSlashIndex + 1)
          setCurrentPath(`/${dirPath}`)
          setSearchQuery(searchPart)
        } else {
          // Just searching in root (e.g., "/searchterm")
          setCurrentPath('/')
          setSearchQuery(pathWithoutLeadingSlash)
        }
      } else if (query.startsWith('~/')) {
        // Absolute path from home
        const pathWithoutHome = query.substring(2) // Remove leading '~/'

        // Check if this is navigating into a directory (ends with /)
        if (pathWithoutHome.endsWith('/')) {
          // Extract the directory path (e.g., "~/Documents/project/" -> "~/Documents/project")
          const dirPath = pathWithoutHome.slice(0, -1) // Remove trailing slash
          setCurrentPath(dirPath ? `~/${dirPath}` : '~')
          setSearchQuery('')
        } else if (pathWithoutHome.includes('/')) {
          // Has subdirectories with possible search
          const lastSlashIndex = pathWithoutHome.lastIndexOf('/')
          const dirPath = pathWithoutHome.substring(0, lastSlashIndex)
          const searchPart = pathWithoutHome.substring(lastSlashIndex + 1)
          setCurrentPath(`~/${dirPath}`)
          setSearchQuery(searchPart)
        } else {
          // Just searching in home (e.g., "~/searchterm")
          setCurrentPath('~')
          setSearchQuery(pathWithoutHome)
        }
      } else if (query.includes('/')) {
        // User is navigating through folders from initial directory
        const lastSlashIndex = query.lastIndexOf('/')
        const pathPart = query.substring(0, lastSlashIndex)
        const searchPart = query.substring(lastSlashIndex + 1)
        // Build path from session working directory or home
        const basePath = sessionWorkingDir || '~'
        const cleanPath = pathPart ? `${basePath}/${pathPart}` : basePath
        setCurrentPath(cleanPath)
        setSearchQuery(searchPart)
      } else {
        // Just searching in session working directory or home
        setCurrentPath(sessionWorkingDir || '~')
        setSearchQuery(query)
      }
    }, [query, sessionWorkingDir])

    // Log when component mounts/unmounts
    useEffect(() => {
      return () => {}
    }, [])

    // Build the search path from current directory and search query
    // When we're in a directory (query ends with /), we want to list that directory's contents
    const searchPath =
      query.endsWith('/') && !searchQuery
        ? currentPath === '/'
          ? '/'
          : `${currentPath}/` // Don't double up slashes for root
        : searchQuery
          ? currentPath === '/'
            ? `/${searchQuery}`
            : `${currentPath}/${searchQuery}`
          : `${currentPath}/` // Add trailing slash when listing current directory

    // Memoize the options to prevent re-runs
    const fileBrowserOptions = useMemo(
      () => ({
        includeFiles: true,
        includeDirectories: true,
        maxResults: 100, // Show more results, make scrollable
      }),
      [],
    )

    // Use the file browser hook to get files
    const { results, isLoading, error } = useFileBrowser(searchPath, fileBrowserOptions)

    // Log state changes only when results change
    useEffect(() => {}, [results.length, isLoading, error])

    // Reset selection when results change
    useEffect(() => {
      setSelectedIndex(0)
      itemRefs.current = []
    }, [results])

    // Scroll selected item into view
    useEffect(() => {
      const selectedItem = itemRefs.current[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }
    }, [selectedIndex])

    // Handle keyboard navigation
    const handleKeyDown = (event: KeyboardEvent) => {
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

      // Tab key cycles forward through mentions
      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        setSelectedIndex(prev => (prev + 1) % results.length)
        return true
      }

      // Shift+Tab cycles backward through mentions
      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault()
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length || 0)
        return true
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = results[selectedIndex]
        if (selected) {
          handleItemSelection(selected)
        }
        return true
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        return false
      }

      // Handle backspace to go up a directory when at the end of a path
      if (event.key === 'Backspace' && query.endsWith('/') && query.length > 0) {
        event.preventDefault()
        // Remove the trailing slash first
        const withoutTrailingSlash = query.slice(0, -1)
        // Find the previous slash to go up one directory
        const lastSlashIndex = withoutTrailingSlash.lastIndexOf('/')
        const newPath = lastSlashIndex >= 0 ? withoutTrailingSlash.substring(0, lastSlashIndex + 1) : ''

        if (editor) {
          const { state, dispatch } = editor.view
          const { $from } = state.selection
          const mentionStart = $from.pos - query.length - 1
          const mentionEnd = $from.pos

          const tr = state.tr.replaceRangeWith(
            mentionStart,
            mentionEnd,
            state.schema.text(`@${newPath}`),
          )
          dispatch(tr)
        }
        return true
      }

      return false
    }

    // Expose keyboard handler via ref
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => handleKeyDown(event),
    }))

    // Handle navigation into a directory or selection of a file
    const handleItemSelection = (item: (typeof results)[0]) => {
      if (item.isDirectory) {
        // Navigate into the directory using the full path to preserve context
        let newPath: string
        
        // Use the fullPath from the item to maintain proper context
        // Convert absolute paths to relative paths for the editor
        const fullPath = item.fullPath
        const workingDir = sessionWorkingDir || '~'
        
        // If the path is within the working directory, make it relative
        if (workingDir !== '~' && fullPath.startsWith(workingDir + '/')) {
          // Remove the working directory prefix and trailing slash
          const relativePath = fullPath.substring(workingDir.length + 1)
          newPath = `${relativePath}/`
        } else if (fullPath.startsWith('/')) {
          // Absolute path from root
          newPath = `${fullPath}/`
        } else if (fullPath.startsWith('~/')) {
          // Home directory path
          newPath = `${fullPath}/`
        } else {
          // Fallback to simple folder name (shouldn't happen with proper fullPath)
          newPath = `${item.name}/`
        }

        if (editor) {
          const { state, dispatch } = editor.view
          const { $from } = state.selection
          const mentionStart = $from.pos - query.length - 1
          const mentionEnd = $from.pos

          const tr = state.tr.replaceRangeWith(
            mentionStart,
            mentionEnd,
            state.schema.text(`@${newPath}`),
          )
          dispatch(tr)
        }
      } else {
        // It's a file, select it
        command({
          id: item.fullPath,
          label: item.name || '',
        })
      }
    }

    // Handle item click
    const handleItemClick = (item: (typeof results)[0]) => {
      handleItemSelection(item)
    }

    // Handle mouse enter for hover selection
    const handleMouseEnter = (index: number) => {
      setSelectedIndex(index)
    }

    if (isLoading) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <LoaderIcon className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4" />
          {error}
        </div>
      )
    }

    if (results.length === 0) {
      return <div className="px-3 py-2 text-sm text-muted-foreground">No files found</div>
    }

    return (
      <div className="py-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-b">
          Files & Folders
          {currentPath !== '~' && currentPath !== (sessionWorkingDir || '~') && (
            <span className="ml-2 font-mono">in {currentPath}/</span>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {results.map((item, index) => (
            <button
              key={item.fullPath}
              ref={el => (itemRefs.current[index] = el)}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => handleMouseEnter(index)}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1.5 text-sm text-left transition-colors duration-200 border-l-2',
                selectedIndex === index
                  ? 'border-l-[var(--terminal-accent)]'
                  : 'border-l-transparent hover:border-l-[var(--terminal-accent-dim)]',
                'focus:outline-none',
              )}
              role="menuitem"
              aria-selected={selectedIndex === index}
            >
              {item.isDirectory ? (
                <FolderIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              ) : (
                <FileIcon className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">
                {searchQuery && item.matches?.length ? (() => {
                  const match = item.matches.find(m => m.key === 'name')
                  if (match && match.indices) {
                    const segments = highlightMatches(item.name || '', match.indices)
                    return (
                      <>
                        {segments.map((segment, i) => (
                          <span key={i} className={cn(segment.highlighted && 'bg-accent/40 font-medium')}>
                            {segment.text}
                          </span>
                        ))}
                        {item.isDirectory && <span className="ml-1 text-muted-foreground">/</span>}
                      </>
                    )
                  }
                  return (
                    <>
                      {item.name}
                      {item.isDirectory && <span className="ml-1 text-muted-foreground">/</span>}
                    </>
                  )
                })() : (
                  <>
                    {item.name}
                    {item.isDirectory && <span className="ml-1 text-muted-foreground">/</span>}
                  </>
                )}
              </span>
              {/* {item.isDirectory ? (
                <span className="text-xs text-muted-foreground">Press Enter to open</span>
              ) : (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {item.fullPath}
                </span>
              )} */}
            </button>
          ))}
        </div>
      </div>
    )
  },
)

FileMentionList.displayName = 'FileMentionList'
