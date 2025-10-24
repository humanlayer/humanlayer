import { homeDir } from '@tauri-apps/api/path'
import { DirEntry, readDir } from '@tauri-apps/plugin-fs'
import React, { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { Input } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command'
import { ArrowDownUp, FileWarning, Clock } from 'lucide-react'
import { useHotkeys } from '@/hooks/useHotkeys'
import type { RecentPath } from '@/lib/daemon'

interface SearchInputProps {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (value?: string) => void
  placeholder?: string
  recentDirectories?: RecentPath[]
  className?: string
  autoFocus?: boolean
  dropdownClassName?: string
  ref?: React.RefObject<HTMLDivElement>
}

export function SearchInput({
  value: externalValue,
  onChange: externalOnChange,
  onSubmit,
  placeholder = 'Type a directory path...',
  recentDirectories = [],
  className,
  autoFocus,
  dropdownClassName,
  ref,
}: SearchInputProps = {}) {
  // Use internal state if not controlled
  const [internalValue, setInternalValue] = useState('')
  const searchValue = externalValue !== undefined ? externalValue : internalValue
  const setSearchValue = (val: string) => {
    if (externalValue !== undefined && externalOnChange) {
      externalOnChange(val)
    } else {
      setInternalValue(val)
    }
  }

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isInvalidPath, setIsInvalidPath] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [directoryPreview, setDirectoryPreview] = useState<
    { path: DirEntry; matches?: FuzzyMatch['matches'] }[]
  >([])
  const [recentPreview, setRecentPreview] = useState<
    { path: string; matches?: FuzzyMatch['matches'] }[]
  >([])
  const [lastValidPath, setLastValidPath] = useState('')
  const [allDirectories, setAllDirectories] = useState<DirEntry[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const keyboardNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const Hotkeys = {
    ARROW_UP: 'arrowup',
    ARROW_DOWN: 'arrowdown',
    ENTER: 'enter',
    TAB: 'tab',
    ESCAPE: 'escape',
  }

  useHotkeys(
    Object.values(Hotkeys).join(','),
    (ev, handler) => {
      switch (handler.keys?.join('')) {
        case Hotkeys.ARROW_UP:
        case Hotkeys.ARROW_DOWN: {
          const totalItems = recentPreview.length + directoryPreview.length
          if (totalItems > 0) {
            // Clear any existing timeout
            if (keyboardNavTimeoutRef.current) {
              clearTimeout(keyboardNavTimeoutRef.current)
            }

            const direction = handler.keys?.join('') === Hotkeys.ARROW_UP ? -1 : 1
            const newIndex = (selectedIndex + direction + totalItems) % totalItems
            setSelectedIndex(newIndex)
          }
          break
        }
        case Hotkeys.TAB: {
          if (dropdownOpen) {
            ev.preventDefault()

            // Determine which item is selected based on selectedIndex
            if (selectedIndex < recentPreview.length) {
              const selectedRecent = recentPreview[selectedIndex]
              if (selectedRecent) {
                setSearchValue(selectedRecent.path)
              }
            } else {
              const dirIndex = selectedIndex - recentPreview.length
              const selectedDir = directoryPreview[dirIndex]
              if (selectedDir) {
                // Parse current path to get base directory
                const lastSlashIdx = searchValue.lastIndexOf('/')
                const basePath = lastSlashIdx === -1 ? '' : searchValue.substring(0, lastSlashIdx + 1)
                const newPath = basePath + selectedDir.path.name
                setSearchValue(newPath)
              }
            }
            setDropdownOpen(false)
          }
          break
        }
        case Hotkeys.ENTER: {
          ev.preventDefault()

          let finalValue = searchValue

          // If dropdown is open, use the selected item
          if (dropdownOpen && recentPreview.length + directoryPreview.length > 0) {
            if (selectedIndex < recentPreview.length) {
              const selectedRecent = recentPreview[selectedIndex]
              if (selectedRecent) {
                finalValue = selectedRecent.path
              }
            } else {
              const dirIndex = selectedIndex - recentPreview.length
              const selectedDir = directoryPreview[dirIndex]
              if (selectedDir) {
                // Parse current path to get base directory
                const lastSlashIdx = searchValue.lastIndexOf('/')
                const basePath = lastSlashIdx === -1 ? '' : searchValue.substring(0, lastSlashIdx + 1)
                finalValue = basePath + selectedDir.path.name
              }
            }
          }

          // Update the input value to match what we're submitting
          setSearchValue(finalValue)
          setDropdownOpen(false)

          // Submit the final value
          if (onSubmit) {
            onSubmit(finalValue)
          }
          break
        }
        case Hotkeys.ESCAPE: {
          ev.stopPropagation()
          const el = document.getElementById('search-input-hack-use-a-ref')
          setDropdownOpen(false)
          el?.blur()
          break
        }
      }
    },
    { enabled: isFocused, enableOnFormTags: true },
  )

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setDropdownOpen(e.target.value.length > 0)
    setSearchValue(e.target.value)
    // Reset selection to 0 when user types
    setSelectedIndex(0)

    let searchPath = e.target.value

    if (searchPath.startsWith('~')) {
      const home = await homeDir()
      searchPath = searchPath.replace(/^~(?=$|\/|\\)/, home)
    }

    // Parse the path to separate directory and search term
    const lastSlashIdx = searchPath.lastIndexOf('/')
    const basePath = lastSlashIdx === -1 ? '' : searchPath.substring(0, lastSlashIdx + 1)
    const searchTerm = lastSlashIdx === -1 ? searchPath : searchPath.substring(lastSlashIdx + 1)

    // Try to read the base directory
    let entries: DirEntry[] = []
    let shouldReadDir = false

    // Only read directory if the base path has changed
    if (basePath !== lastValidPath) {
      shouldReadDir = true
    }

    if (shouldReadDir) {
      try {
        const pathToRead = basePath || '.'
        entries = await readDir(pathToRead)
        const dirs = entries.filter(entry => entry.isDirectory)
        setAllDirectories(dirs)
        entries = dirs // Use filtered directories for fuzzy search
        setLastValidPath(basePath)
        setIsInvalidPath(false)
      } catch {
        // Keep showing last valid directories
        entries = allDirectories
        setIsInvalidPath(true)
      }
    } else {
      // Use cached directories
      entries = allDirectories
    }

    // Filter directories based on search term
    let dirObjs: Array<{ path: DirEntry; matches?: FuzzyMatch['matches'] }> = []

    if (searchTerm) {
      // Use fuzzy search to filter and rank directories
      const searchResults = fuzzySearch(entries, searchTerm, {
        keys: ['name'],
        threshold: 0.01,
        minMatchCharLength: 1,
        includeMatches: true,
      })

      dirObjs = searchResults.map(result => ({
        path: result.item,
        matches: result.matches,
      }))
    } else {
      // Show all directories if no search term
      dirObjs = entries.map(dir => ({
        path: dir,
      }))
    }

    setDirectoryPreview(dirObjs)

    // Filter recent directories based on search value
    let recentObjs: Array<{ path: string; matches?: FuzzyMatch['matches'] }> = []

    if (recentDirectories.length > 0) {
      if (searchPath) {
        // Use fuzzy search on the full path
        const recentSearchResults = fuzzySearch(
          recentDirectories.map(r => ({ path: r.path })),
          searchPath,
          {
            keys: ['path'],
            threshold: 0.3,
            includeMatches: true,
          },
        )

        recentObjs = recentSearchResults.map(result => ({
          path: result.item.path,
          matches: result.matches,
        }))
      } else {
        // Show all recent directories when no search term
        recentObjs = recentDirectories.slice(0, 10).map(recent => ({
          path: recent.path,
        }))
      }
    }

    setRecentPreview(recentObjs)
    setDirectoryPreview(dirObjs)
  }

  return (
    <div ref={ref} className="">
      <Popover open={dropdownOpen && isFocused} defaultOpen={false} modal={true}>
        <PopoverAnchor>
          <Input
            id="search-input-hack-use-a-ref"
            className={cn('mt-2', className)}
            ref={inputRef}
            spellCheck={false}
            autoFocus={autoFocus}
            onChange={onChange}
            value={searchValue}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
          />
        </PopoverAnchor>

        <PopoverContent
          onOpenAutoFocus={e => e.preventDefault()}
          side="bottom"
          align="start"
          avoidCollisions={false}
          className={cn(
            // 'w-[var(--radix-popover-trigger-width)]',
            className?.includes('text-xs') && '[&_[cmdk-item]]:text-xs [&_[cmdk-item]]:py-1',
          )}
        >
          <Command>
            <CommandList>
              {recentPreview.length === 0 && directoryPreview.length === 0 && (
                <CommandEmpty className="py-2">
                  {isInvalidPath && (
                    <span className="flex items-center">
                      <FileWarning className="w-4 h-4 mr-2" />
                      <span>...</span>
                    </span>
                  )}
                  {!isInvalidPath && (
                    <span className="flex items-center">
                      <FileWarning className="w-4 h-4 mr-2" />
                      No results found
                    </span>
                  )}
                </CommandEmpty>
              )}
              {recentPreview.length > 0 && (
                <CommandGroup heading="Recent Directories">
                  {recentPreview.map((item, idx) => {
                    const pathMatch = item.matches?.find(m => m.key === 'path')
                    const highlighted = pathMatch
                      ? highlightMatches(item.path, pathMatch.indices)
                      : null

                    return (
                      <CommandItem
                        key={`recent-${idx}`}
                        className={cn(
                          selectedIndex === idx && '!bg-accent/20',
                          'data-[selected=true]:!bg-accent/20', // Apply same styling for mouse hover
                          '[&[data-selected=true]]:text-foreground', // Override default accent-foreground
                          dropdownClassName,
                        )}
                        onSelect={() => {
                          setSearchValue(item.path)
                          setDropdownOpen(false)
                          inputRef.current?.focus()
                        }}
                      >
                        <div className="flex items-center space-x-2 w-full">
                          <Clock className="w-4 h-4 flex-shrink-0" />
                          <span className="flex-1 truncate">
                            {highlighted
                              ? highlighted.map((segment, i) => (
                                  <span
                                    key={i}
                                    className={cn(segment.highlighted && 'bg-accent/40 font-medium')}
                                  >
                                    {segment.text}
                                  </span>
                                ))
                              : item.path}
                          </span>
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
              {directoryPreview.length > 0 && (
                <CommandGroup heading="Paths">
                  {directoryPreview.map((item, dirIdx) => {
                    const nameMatch = item.matches?.find(m => m.key === 'name')
                    const highlighted =
                      nameMatch && item.path.name
                        ? highlightMatches(item.path.name, nameMatch.indices)
                        : null

                    const itemIndex = recentPreview.length + dirIdx

                    return (
                      <CommandItem
                        key={item.path.name}
                        className={cn(
                          selectedIndex === itemIndex && '!bg-accent/20',
                          'data-[selected=true]:!bg-accent/20', // Apply same styling for mouse hover
                          '[&[data-selected=true]]:text-foreground', // Override default accent-foreground
                          dropdownClassName,
                        )}
                        onSelect={() => {
                          // Parse current path to get base directory
                          const lastSlashIdx = searchValue.lastIndexOf('/')
                          const basePath =
                            lastSlashIdx === -1 ? '' : searchValue.substring(0, lastSlashIdx + 1)

                          // Replace the partial text with the selected directory
                          const newPath = basePath + item.path.name
                          setSearchValue(newPath)
                          setDropdownOpen(false)

                          // Keep focus on the input using ref
                          inputRef.current?.focus()
                        }}
                      >
                        <div>
                          {highlighted
                            ? highlighted.map((segment, i) => (
                                <span
                                  key={i}
                                  className={cn(segment.highlighted && 'bg-accent/40 font-medium')}
                                >
                                  {segment.text}
                                </span>
                              ))
                            : item.path.name}
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </CommandList>
            {directoryPreview.length > 0 && (
              <div className="px-4 pt-2 text-xs text-muted-foreground bg-muted/30 border-t border-border/50 flex justify-end gap-4">
                <span className="flex items-center gap-1">
                  <ArrowDownUp className="w-3 h-3" /> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd>↵</kbd> Select
                </span>
                <span className="flex items-center gap-1">
                  <kbd>ESC</kbd> Close
                </span>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
