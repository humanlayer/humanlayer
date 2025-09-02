import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { FileIcon, FolderIcon, AlertCircleIcon, LoaderIcon } from 'lucide-react'
import { useFileBrowser } from '@/hooks/useFileBrowser'
import { cn } from '@/lib/utils'

interface FileMentionItem {
  id: string
  label: string
}

interface FileMentionListProps {
  query: string
  command: (item: FileMentionItem) => void
  editor?: any // TipTap editor instance
}

export interface FileMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const FileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
  ({ query, command, editor }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    
    // Get the working directory from editor storage or use home directory
    const workingDir = editor?.storage?.workingDir || '~'
    // For file search, we want to search in the working directory with the query as a filter
    const searchPath = `${workingDir}/${query || ''}`
    
    // Use the file browser hook to get files
    const { results, isLoading, error } = useFileBrowser(searchPath, {
      includeFiles: true,
      includeDirectories: true,
      maxResults: 10,
    })

    // Reset selection when results change
    useEffect(() => {
      setSelectedIndex(0)
    }, [results])

    // Handle keyboard navigation
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length || 0)
        return true
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % results.length)
        return true
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selected = results[selectedIndex]
        if (selected) {
          command({
            id: selected.fullPath,
            label: selected.name || '',
          })
        }
        return true
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        return false
      }

      return false
    }

    // Expose keyboard handler via ref
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => handleKeyDown(event),
    }))

    // Handle item click
    const handleItemClick = (item: typeof results[0]) => {
      command({
        id: item.fullPath,
        label: item.name || '',
      })
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
      return (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No files found
        </div>
      )
    }

    return (
      <div className="py-1">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Files & Folders
        </div>
        {results.map((item, index) => (
          <button
            key={item.fullPath}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => handleMouseEnter(index)}
            className={cn(
              'flex w-full items-center gap-2 px-2 py-1.5 text-sm text-left rounded-sm transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'focus:bg-accent focus:text-accent-foreground focus:outline-none',
              selectedIndex === index && 'bg-accent text-accent-foreground'
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
              {item.matches && item.matches.length > 0 ? (
                <HighlightedText text={item.name || ''} matches={item.matches} />
              ) : (
                item.name
              )}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {item.fullPath}
            </span>
          </button>
        ))}
        <div className="px-2 py-1 mt-1 text-xs text-muted-foreground border-t">
          Use arrow keys to navigate, Enter to select
        </div>
      </div>
    )
  }
)

FileMentionList.displayName = 'FileMentionList'

// Helper component to highlight matched text
function HighlightedText({ 
  text, 
  matches 
}: { 
  text: string
  matches: Array<{ indices: Array<[number, number]> }>
}) {
  if (!matches || matches.length === 0) {
    return <>{text}</>
  }

  const highlights = matches[0]?.indices || []
  if (highlights.length === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  highlights.forEach(([start, end]) => {
    // Add non-highlighted text before this match
    if (start > lastIndex) {
      parts.push(
        <span key={`normal-${lastIndex}`}>
          {text.slice(lastIndex, start)}
        </span>
      )
    }
    // Add highlighted text
    parts.push(
      <span key={`highlight-${start}`} className="font-semibold text-accent-foreground">
        {text.slice(start, end + 1)}
      </span>
    )
    lastIndex = end + 1
  })

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push(
      <span key={`normal-${lastIndex}`}>
        {text.slice(lastIndex)}
      </span>
    )
  }

  return <>{parts}</>
}