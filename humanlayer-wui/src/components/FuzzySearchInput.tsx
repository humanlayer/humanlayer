import { homeDir } from '@tauri-apps/api/path'
import { DirEntry, readDir } from '@tauri-apps/plugin-fs'
import React, { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { Input } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command'
import { ArrowDownUp, FileWarning } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

interface SearchInputProps {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
}

export function SearchInput({ 
  value: externalValue, 
  onChange: externalOnChange, 
  onSubmit,
  placeholder = "Type a directory path..."
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
    { selected: boolean; path: DirEntry; matches?: FuzzyMatch['matches'] }[]
  >([])
  const [lastValidPath, setLastValidPath] = useState('')
  const [allDirectories, setAllDirectories] = useState<DirEntry[]>([])
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
          if (directoryPreview.length > 0) {
            const currentIndex = directoryPreview.findIndex(item => item.selected)
            const newIndex = (currentIndex - 1 + directoryPreview.length) % directoryPreview.length
            setDirectoryPreview(prev =>
              prev.map((item, idx) => ({ ...item, selected: idx === newIndex })),
            )
          }
          break
        case Hotkeys.ARROW_DOWN:
          if (directoryPreview.length > 0) {
            const currentIndex = directoryPreview.findIndex(item => item.selected)
            const newIndex = (currentIndex + 1) % directoryPreview.length
            setDirectoryPreview(prev =>
              prev.map((item, idx) => ({ ...item, selected: idx === newIndex })),
            )
          }
          break
        case Hotkeys.ENTER:
        case Hotkeys.TAB: {
          ev.preventDefault()
          const selectedDir = directoryPreview.find(item => item.selected)
          if (selectedDir && dropdownOpen) {
            // Parse current path to get base directory
            const lastSlashIdx = searchValue.lastIndexOf('/')
            const basePath = lastSlashIdx === -1 ? '' : searchValue.substring(0, lastSlashIdx + 1)

            // Replace the partial text with the selected directory
            const newPath = basePath + selectedDir.path.name
            setSearchValue(newPath)
            setDropdownOpen(false)
          } else if (handler.keys?.join('') === Hotkeys.ENTER && !dropdownOpen && onSubmit) {
            // Submit form if dropdown is closed and Enter is pressed
            onSubmit()
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
    let dirObjs: Array<{ selected: boolean; path: DirEntry; matches?: FuzzyMatch['matches'] }> = []

    if (searchTerm) {
      // Use fuzzy search to filter and rank directories
      const searchResults = fuzzySearch(entries, searchTerm, {
        keys: ['name'],
        threshold: 0.01,
        minMatchCharLength: 1,
        includeMatches: true,
      })

      dirObjs = searchResults.map((result, idx) => ({
        selected: idx === 0,
        path: result.item,
        matches: result.matches,
      }))
    } else {
      // Show all directories if no search term
      dirObjs = entries.map((dir, idx) => ({
        selected: idx === 0,
        path: dir,
      }))
    }

    setDirectoryPreview(dirObjs)
  }

  return (
    <div className="">
      <Popover open={dropdownOpen && isFocused} defaultOpen={false} modal={true}>
        <PopoverAnchor>
          <Input
            id="search-input-hack-use-a-ref"
            className="mt-2"
            ref={inputRef}
            spellCheck={false}
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
          className="w-[var(--radix-popover-trigger-width)]"
        >
          <Command>
            <CommandList>
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
              {directoryPreview.length > 0 && (
                <CommandGroup>
                  {directoryPreview.map(item => {
                    const nameMatch = item.matches?.find(m => m.key === 'name')
                    const highlighted =
                      nameMatch && item.path.name
                        ? highlightMatches(item.path.name, nameMatch.indices)
                        : null

                    return (
                      <CommandItem
                        key={item.path.name}
                        className={cn(item.selected && '!bg-accent/20')}
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
                                  className={
                                    segment.highlighted
                                      ? 'bg-yellow-200 dark:bg-yellow-900/50 font-medium'
                                      : ''
                                  }
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


