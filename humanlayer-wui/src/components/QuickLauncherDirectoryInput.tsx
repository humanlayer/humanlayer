import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { Input } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from './ui/command'
import { Clock } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import type { RecentPath } from '@/lib/daemon'

interface QuickLauncherDirectoryInputProps {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (value?: string) => void
  placeholder?: string
  recentDirectories?: RecentPath[]
  className?: string
  autoFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
}

export function QuickLauncherDirectoryInput({
  value: externalValue,
  onChange: externalOnChange,
  onSubmit,
  placeholder = 'Type a directory path...',
  recentDirectories = [],
  className,
  autoFocus,
  onFocus: externalOnFocus,
  onBlur: externalOnBlur,
}: QuickLauncherDirectoryInputProps) {
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
  const [isFocused, setIsFocused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const [filteredItems, setFilteredItems] = useState<
    { path: string; matches?: FuzzyMatch['matches'] }[]
  >([])
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const Hotkeys = {
    ARROW_UP: 'arrowup',
    ARROW_DOWN: 'arrowdown',
    ENTER: 'enter',
    TAB: 'tab',
    ESCAPE: 'escape',
  }

  // Handle arrow keys, tab, enter, escape only when focused
  useHotkeys(
    [Hotkeys.ARROW_UP, Hotkeys.ARROW_DOWN, Hotkeys.TAB, Hotkeys.ENTER, Hotkeys.ESCAPE].join(','),
    (ev, handler) => {
      switch (handler.keys?.join('')) {
        case Hotkeys.ARROW_UP:
        case Hotkeys.ARROW_DOWN: {
          if (filteredItems.length > 0) {
            const direction = handler.keys?.join('') === Hotkeys.ARROW_UP ? -1 : 1
            const newIndex = (selectedIndex + direction + filteredItems.length) % filteredItems.length
            setSelectedIndex(newIndex)
          }
          break
        }
        case Hotkeys.TAB: {
          if (dropdownOpen && filteredItems.length > 0) {
            ev.preventDefault()
            const selected = filteredItems[selectedIndex]
            if (selected) {
              setSearchValue(selected.path)
            }
            setDropdownOpen(false)
          }
          break
        }
        case Hotkeys.ENTER: {
          ev.preventDefault()
          let finalValue = searchValue

          // If dropdown is open and an item is selected, use it
          if (dropdownOpen && filteredItems.length > 0 && selectedIndex >= 0) {
            const selected = filteredItems[selectedIndex]
            if (selected) {
              finalValue = selected.path
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
          setDropdownOpen(false)
          inputRef.current?.blur()
          break
        }
      }
    },
    { enabled: isFocused, enableOnFormTags: true },
  )


  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchValue(newValue)

    // Filter recent directories based on fuzzy search
    let filtered: Array<{ path: string; matches?: FuzzyMatch['matches'] }> = []

    if (newValue && recentDirectories.length > 0) {
      // Use fuzzy search on recent directories
      const searchResults = fuzzySearch(
        recentDirectories.map(r => ({ path: r.path })),
        newValue,
        {
          keys: ['path'],
          threshold: 0.3,
          includeMatches: true,
        },
      )

      filtered = searchResults.map(result => ({
        path: result.item.path,
        matches: result.matches,
      }))
    } else if (!newValue && recentDirectories.length > 0) {
      // Show all recent directories when no search term
      filtered = recentDirectories.map(recent => ({
        path: recent.path,
      }))
    }

    // Limit to 4 items total
    filtered = filtered.slice(0, 4)

    setFilteredItems(filtered)
    setDropdownOpen(filtered.length > 0)

    // Start with bottom item selected (index 3 for 4 items)
    if (filtered.length > 0) {
      setSelectedIndex(filtered.length - 1)
    }
  }

  // Initialize selection when focusing
  useEffect(() => {
    if (isFocused && filteredItems.length > 0 && selectedIndex === -1) {
      // Start at the bottom
      setSelectedIndex(filteredItems.length - 1)
    }
  }, [isFocused, filteredItems.length, selectedIndex])

  // Initialize with recent directories on focus
  useEffect(() => {
    if (isFocused && !searchValue && recentDirectories.length > 0) {
      const items = recentDirectories.slice(0, 4).map(recent => ({
        path: recent.path,
      }))
      setFilteredItems(items)
      setDropdownOpen(items.length > 0)
      setSelectedIndex(items.length - 1) // Start at bottom
    }
  }, [isFocused, searchValue, recentDirectories])

  // Scroll to selected item when it changes
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      setTimeout(() => {
        const selectedItem = listRef.current?.querySelector('[data-selected="true"]')
        if (selectedItem) {
          selectedItem.scrollIntoView({ block: 'nearest' })
        }
      }, 0)
    }
  }, [selectedIndex])

  return (
    <div className="">
      <Popover open={dropdownOpen && isFocused} defaultOpen={false} modal={true}>
        <PopoverAnchor>
          <Input
            className={cn('mt-2', className)}
            ref={inputRef}
            spellCheck={false}
            onChange={onChange}
            value={searchValue}
            onFocus={() => {
              setIsFocused(true)
              externalOnFocus?.()
            }}
            onBlur={() => {
              setIsFocused(false)
              externalOnBlur?.()
            }}
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
        </PopoverAnchor>

        <PopoverContent
          onOpenAutoFocus={e => e.preventDefault()}
          side="top"
          align="start"
          avoidCollisions={false}
          className={cn(
            'w-[var(--radix-popover-trigger-width)] p-0',
            className?.includes('text-xs') && '[&_[cmdk-item]]:text-xs [&_[cmdk-item]]:py-1',
          )}
        >
          <Command shouldFilter={false}>
            <CommandList ref={listRef} className="max-h-[176px]">
              {filteredItems.length === 0 ? (
                <CommandEmpty className="py-2 text-xs text-muted-foreground text-center">
                  No recent directories
                </CommandEmpty>
              ) : (
                filteredItems.map((item, idx) => {
                  const pathMatch = item.matches?.find(m => m.key === 'path')
                  const highlighted = pathMatch
                    ? highlightMatches(item.path, pathMatch.indices)
                    : null

                  return (
                    <CommandItem
                      key={`${item.path}-${idx}`}
                      className={cn(
                        selectedIndex === idx && '!bg-accent/20',
                        'data-[selected=true]:!bg-accent/20',
                        '[&[data-selected=true]]:text-foreground',
                      )}
                      onMouseEnter={() => {
                        setSelectedIndex(idx)
                      }}
                      onSelect={() => {
                        setSearchValue(item.path)
                        setDropdownOpen(false)
                        inputRef.current?.focus()
                      }}
                    >
                      <div className="flex items-center space-x-2 w-full">
                        <Clock className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-xs">
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
                })
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
