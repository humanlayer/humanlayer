import { homeDir } from '@tauri-apps/api/path'
import { DirEntry, readDir } from '@tauri-apps/plugin-fs'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command'
import { FileWarning } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

interface FuzzySearchInputProps<T> {
  items: T[]
  value: string
  onChange: (value: string) => void
  onSelect?: (item: T) => void
  placeholder?: string
  searchKeys?: string[]
  renderItem?: (item: T, matches: FuzzyMatch['matches']) => React.ReactNode
  className?: string
  maxResults?: number
  emptyMessage?: string
  disabled?: boolean
}

/* Running list of bugs with this thing

 - [ ] - When hitting "ESC" while in input, entire dialog is closed as opposed to exiting focus of input first
 - [ ] - Selected state in dropdown, when nothing selected, select something
 - [ ] - Dropdown should be width of input
 - [ ] - Have tab do what enter does too

*/

export function SearchInput() {
  const [searchValue, setSearchValue] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [isInvalidPath, setIsInvalidPath] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [directoryPreview, setDirectoryPreview] = useState<{ selected: boolean; path: DirEntry; matches?: FuzzyMatch['matches'] }[]>([])
  const [lastValidPath, setLastValidPath] = useState('')
  const [allDirectories, setAllDirectories] = useState<DirEntry[]>([])

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
              prev.map((item, idx) => ({ ...item, selected: idx === newIndex }))
            )
          }
          break
        case Hotkeys.ARROW_DOWN:
          if (directoryPreview.length > 0) {
            const currentIndex = directoryPreview.findIndex(item => item.selected)
            const newIndex = (currentIndex + 1) % directoryPreview.length
            setDirectoryPreview(prev => 
              prev.map((item, idx) => ({ ...item, selected: idx === newIndex }))
            )
          }
          break
        case Hotkeys.ENTER:
        case Hotkeys.TAB:
          const selectedDir = directoryPreview.find(item => item.selected)
          if (selectedDir) {
            const newPath = searchValue.endsWith('/') 
              ? searchValue + selectedDir.path.name 
              : searchValue + '/' + selectedDir.path.name
            setSearchValue(newPath)
            setDropdownOpen(false)
          }
          break
        case Hotkeys.ESCAPE:
          console.log('escape')
          ev.stopPropagation()
          setDropdownOpen(false)
          break
      }
    },
    { enabled: isFocused, enableOnFormTags: true },
  )

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('onChange', e.target.value)
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
      } catch (err) {
        console.log('Error reading directory:', err)
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
    <div className="flex flex-col items-start">
      <Input
        spellCheck={false}
        onChange={onChange}
        value={searchValue}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />
      <Popover open={dropdownOpen && isFocused} defaultOpen={false}>
        <PopoverTrigger></PopoverTrigger>
        <PopoverContent onOpenAutoFocus={e => e.preventDefault()}>
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
                    const highlighted = nameMatch && item.path.name
                      ? highlightMatches(item.path.name, nameMatch.indices)
                      : null

                    return (
                      <CommandItem 
                        key={item.path.name}
                        className={cn(item.selected && "!bg-accent/20")}
                      >
                        {highlighted ? (
                          highlighted.map((segment, i) => (
                            <span
                              key={i}
                              className={segment.highlighted ? 'bg-yellow-200 dark:bg-yellow-900/50 font-medium' : ''}
                            >
                              {segment.text}
                            </span>
                          ))
                        ) : (
                          item.path.name
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function FuzzySearchInput<T extends { value: string; label: string }[]>({
  items,
  value,
  onChange,
  onSelect,
  placeholder = 'Search...',
  searchKeys = [],
  renderItem,
  className,
  maxResults = 10,
  emptyMessage = 'No results found',
  disabled = false,
}: FuzzySearchInputProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Perform fuzzy search
  const searchResults = useMemo(() => {
    if (!value.trim()) return []

    const results = fuzzySearch(items, value, {
      keys: searchKeys,
      threshold: 0.1,
      includeMatches: true,
    })

    return results.slice(0, maxResults)
  }, [items, value, searchKeys, maxResults])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  // Open dropdown when typing
  useEffect(() => {
    setIsOpen(value.length > 0 && searchResults.length > 0)
  }, [value, searchResults.length])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('handleKeyDown', e.key)
      if (!isOpen || !searchResults.length) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % searchResults.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length)
          break
        case 'Enter':
          e.preventDefault()
          if (searchResults[selectedIndex] && onSelect) {
            onSelect(searchResults[selectedIndex].item)
            setIsOpen(false)
          }
          break
        case 'Escape':
          console.log('ignoring for the moment');
          break;
          // e.preventDefault()
          // setIsOpen(false)
          // inputRef.current?.blur()
          // break
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, searchResults, selectedIndex, onSelect])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && isOpen) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isOpen])

  const handleItemClick = (item: T, index: number) => {
    setSelectedIndex(index)
    if (onSelect) {
      onSelect(item)
      setIsOpen(false)
    }
  }

  const defaultRenderItem = (item: T, matches: FuzzyMatch['matches']) => {
    const text = String(item)
    const match = matches[0]

    if (match && match.indices) {
      const segments = highlightMatches(text, match.indices)
      return defaultRenderHighlight(segments)
    }

    return <span>{text}</span>
  }

  const defaultRenderHighlight = (segments: Array<{ text: string; highlighted: boolean }>) => (
    <>
      {segments.map((segment, i) => (
        <span
          key={i}
          className={segment.highlighted ? 'bg-yellow-200 dark:bg-yellow-900/50 font-medium' : ''}
        >
          {segment.text}
        </span>
      ))}
    </>
  )

  console.log('searchResults', searchResults)

  return (
    <div className="relative">
      <input
        spellCheck={false}
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => value && searchResults.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'w-full h-10 px-3 py-2 text-sm',
          'font-mono',
          'bg-background border rounded-md',
          'transition-all duration-200',
          'placeholder:text-muted-foreground/60',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'border-border hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20',
          className,
        )}
        autoComplete="off"
      />

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Results dropdown */}
          <div
            ref={listRef}
            className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-20 max-h-60 overflow-y-auto"
          >
            {/* {searchResults.length > 0 ? (
              searchResults.map((result, index) => (
                <div
                  key={index}
                  className={cn(
                    'px-3 py-2 cursor-pointer transition-colors text-sm',
                    'border-b border-border/50 last:border-b-0',
                    index === selectedIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted/50',
                  )}
                  onClick={() => handleItemClick(result.item, index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {renderItem
                    ? renderItem(result.item, result.matches)
                    : defaultRenderItem(result.item, result.matches)}
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground text-center">{emptyMessage}</div>
            )} */}

            {/* Footer with navigation hints */}
            {/* {searchResults.length > 0 && (
              <div className="px-3 py-1 text-xs text-muted-foreground bg-muted/30 border-t border-border/50 flex items-center justify-between">
                <span>↑↓ Navigate</span>
                <span>↵ Select • ESC Close</span>
              </div>
            )} */}
          </div>
        </>
      )}

      {/* Start ShadCN Version */}

      <div className="relative mt-100">
        {/* <AutoComplete
          // selectedValue={}
          // onSelectedValueChange={}
          searchValue={value}
          // onSearchValueChange={}
          items={searchResults.map(i => ({ value: i.item, label: i.item }))}
          // isLoading={isLoading}
          emptyMessage={emptyMessage}
          placeholder={placeholder}
          selectedValue={value}
          onSelectedValueChange={onChange}
          onSearchValueChange={onChange}
          isLoading={false}
        /> */}

        {/* <SearchInput /> */}
      </div>

      {/* End ShadCN Version */}
    </div>
  )
}
