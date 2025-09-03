import { useState, useEffect, forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { FileIcon, FolderIcon, AlertCircleIcon, LoaderIcon } from 'lucide-react'
import { useFileBrowser } from '@/hooks/useFileBrowser'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'

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
      console.log('📍 FileMentionList: Query changed:', { query, sessionWorkingDir })

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
        console.log('📍 FileMentionList: Parsed path:', { pathPart, searchPart, cleanPath })
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
      console.log('📦 FileMentionList: Mounted', { query, currentPath })
      return () => {
        console.log('📦 FileMentionList: Unmounted')
      }
    }, [])

    // Build the search path from current directory and search query
    // When we're in a directory (query ends with /), we want to list that directory's contents
    const searchPath =
      query.endsWith('/') && !searchQuery
        ? currentPath === '/' ? '/' : `${currentPath}/` // Don't double up slashes for root
        : searchQuery
          ? currentPath === '/' ? `/${searchQuery}` : `${currentPath}/${searchQuery}`
          : currentPath

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
    useEffect(() => {
      console.log('📊 FileMentionList results changed:', {
        resultsCount: results.length,
        isLoading,
        error,
      })
    }, [results.length, isLoading, error])

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

      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = results[selectedIndex]
        if (selected) {
          if (selected.isDirectory) {
            // Navigate into the directory instead of selecting it
            // Build the new path correctly based on current context
            let newPath: string

            // Handle special cases for root and home navigation
            if (query === '/' || query === '~') {
              // User is at root or home, add folder name
              newPath = `${query === '/' ? '/' : '~/'}${selected.name}/`
            } else if (query.startsWith('/')) {
              // In root navigation mode
              const pathAfterRoot = query.substring(1)
              if (pathAfterRoot.endsWith('/')) {
                newPath = `/${pathAfterRoot}${selected.name}/`
              } else if (pathAfterRoot.includes('/')) {
                const pathBeforeSearch = pathAfterRoot.substring(0, pathAfterRoot.lastIndexOf('/') + 1)
                newPath = `/${pathBeforeSearch}${selected.name}/`
              } else {
                newPath = `/${selected.name}/`
              }
            } else if (query.startsWith('~/')) {
              // In home navigation mode
              const pathAfterHome = query.substring(2)
              if (pathAfterHome.endsWith('/')) {
                newPath = `~/${pathAfterHome}${selected.name}/`
              } else if (pathAfterHome.includes('/')) {
                const pathBeforeSearch = pathAfterHome.substring(0, pathAfterHome.lastIndexOf('/') + 1)
                newPath = `~/${pathBeforeSearch}${selected.name}/`
              } else {
                newPath = `~/${selected.name}/`
              }
            } else if (query === '') {
              // At initial directory, just add the folder name
              newPath = `${selected.name}/`
            } else if (query.endsWith('/')) {
              // Already in a folder, append the new folder
              newPath = `${query}${selected.name}/`
            } else if (query.includes('/')) {
              // Searching within a folder, replace search with folder name
              const pathBeforeSearch = query.substring(0, query.lastIndexOf('/') + 1)
              newPath = `${pathBeforeSearch}${selected.name}/`
            } else {
              // Searching at initial directory, replace search with folder name
              newPath = `${selected.name}/`
            }

            // We need to update the editor's mention query
            // This is a bit tricky - we need to replace the current query with the new path
            if (editor) {
              const { state, dispatch } = editor.view
              const { $from } = state.selection
              const mentionStart = $from.pos - query.length - 1 // -1 for the @ character
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
              id: selected.fullPath,
              label: selected.name || '',
            })
          }
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

    // Handle item click
    const handleItemClick = (item: (typeof results)[0]) => {
      if (item.isDirectory) {
        // Navigate into the directory - use same logic as Enter key
        let newPath: string

        // Handle special cases for root and home navigation
        if (query === '/' || query === '~') {
          newPath = `${query === '/' ? '/' : '~/'}${item.name}/`
        } else if (query.startsWith('/')) {
          const pathAfterRoot = query.substring(1)
          if (pathAfterRoot.endsWith('/')) {
            newPath = `/${pathAfterRoot}${item.name}/`
          } else if (pathAfterRoot.includes('/')) {
            const pathBeforeSearch = pathAfterRoot.substring(0, pathAfterRoot.lastIndexOf('/') + 1)
            newPath = `/${pathBeforeSearch}${item.name}/`
          } else {
            newPath = `/${item.name}/`
          }
        } else if (query.startsWith('~/')) {
          const pathAfterHome = query.substring(2)
          if (pathAfterHome.endsWith('/')) {
            newPath = `~/${pathAfterHome}${item.name}/`
          } else if (pathAfterHome.includes('/')) {
            const pathBeforeSearch = pathAfterHome.substring(0, pathAfterHome.lastIndexOf('/') + 1)
            newPath = `~/${pathBeforeSearch}${item.name}/`
          } else {
            newPath = `~/${item.name}/`
          }
        } else if (query === '') {
          newPath = `${item.name}/`
        } else if (query.endsWith('/')) {
          newPath = `${query}${item.name}/`
        } else if (query.includes('/')) {
          const pathBeforeSearch = query.substring(0, query.lastIndexOf('/') + 1)
          newPath = `${pathBeforeSearch}${item.name}/`
        } else {
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
                'flex w-full items-center gap-2 px-2 py-1.5 text-sm text-left rounded-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                selectedIndex === index && 'bg-accent text-accent-foreground',
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
                {item.name}
                {item.isDirectory && <span className="ml-1 text-muted-foreground">/</span>}
              </span>
              {item.isDirectory ? (
                <span className="text-xs text-muted-foreground">Press Enter to open</span>
              ) : (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {item.fullPath}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    )
  },
)

FileMentionList.displayName = 'FileMentionList'
