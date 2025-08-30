import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, Plus, X, Lock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/FuzzySearchInput'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { SessionStatus } from '@/lib/daemon/types'
import { toast } from 'sonner'
import { useHotkeys } from 'react-hotkeys-hook'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { cn } from '@/lib/utils'

interface AdditionalDirectoriesDropdownProps {
  workingDir: string
  directories: string[]
  sessionStatus: SessionStatus
  onDirectoriesChange?: (directories: string[]) => void | Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AdditionalDirectoriesDropdown({
  workingDir,
  directories,
  sessionStatus,
  onDirectoriesChange,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: AdditionalDirectoriesDropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen
  const setIsOpen = (open: boolean) => {
    if (externalOnOpenChange) {
      externalOnOpenChange(open)
    } else {
      setInternalOpen(open)
    }
  }
  const [localDirectories, setLocalDirectories] = useState<string[]>(directories)
  const [newDirectory, setNewDirectory] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // Add refs for focus management
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLDivElement>(null)
  const directoryRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)

  // Track what triggered the popover opening
  const triggerRef = useRef<HTMLElement | null>(null)

  // Steal hotkey scope when popover is open
  const AdditionalDirectoriesHotkeyScope = 'additional-directories-dropdown'
  useStealHotkeyScope(AdditionalDirectoriesHotkeyScope, isOpen)

  // Fetch recent paths for autocomplete
  const { paths: recentPaths } = useRecentPaths(20)

  // Update local state when prop changes
  useEffect(() => {
    setLocalDirectories(directories)
  }, [directories])

  // Focus the add button when popover opens
  useEffect(() => {
    if (isOpen && !isAdding) {
      // Small delay to ensure popover is rendered
      setTimeout(() => {
        addButtonRef.current?.focus()
      }, 0)
    }
  }, [isOpen, isAdding])

  // Cleanup refs when directories change
  useEffect(() => {
    directoryRefs.current = directoryRefs.current.slice(0, localDirectories.length)
  }, [localDirectories.length])

  // Reset focused index if it's out of bounds
  useEffect(() => {
    if (focusedIndex >= localDirectories.length) {
      setFocusedIndex(-1)
    }
  }, [localDirectories.length, focusedIndex])

  // Check if editing is allowed based on session status
  const canEdit = sessionStatus === 'completed' || sessionStatus === 'waiting_input'

  // Handle j/k navigation
  useHotkeys(
    'j',
    e => {
      e.preventDefault()
      e.stopPropagation()

      if (isAdding) return // Don't navigate when adding

      const maxIndex = localDirectories.length - 1
      if (focusedIndex < maxIndex) {
        const newIndex = focusedIndex + 1
        setFocusedIndex(newIndex)
        directoryRefs.current[newIndex]?.focus()
      } else if (focusedIndex === maxIndex) {
        // Wrap to top
        setFocusedIndex(-1)
        addButtonRef.current?.focus()
      } else {
        // Start from first item
        if (localDirectories.length > 0) {
          setFocusedIndex(0)
          directoryRefs.current[0]?.focus()
        }
      }
    },
    {
      enabled: isOpen && !isAdding,
      scopes: AdditionalDirectoriesHotkeyScope,
      preventDefault: true,
    },
  )

  useHotkeys(
    'k',
    e => {
      e.preventDefault()
      e.stopPropagation()

      if (isAdding) return // Don't navigate when adding

      if (focusedIndex > 0) {
        const newIndex = focusedIndex - 1
        setFocusedIndex(newIndex)
        directoryRefs.current[newIndex]?.focus()
      } else if (focusedIndex === 0) {
        // Move to add button
        setFocusedIndex(-1)
        addButtonRef.current?.focus()
      } else if (focusedIndex === -1 && localDirectories.length > 0) {
        // Wrap to bottom
        const lastIndex = localDirectories.length - 1
        setFocusedIndex(lastIndex)
        directoryRefs.current[lastIndex]?.focus()
      }
    },
    {
      enabled: isOpen && !isAdding,
      scopes: AdditionalDirectoriesHotkeyScope,
      preventDefault: true,
    },
  )

  // Handle Enter key on focused directory (not when typing in input)
  useHotkeys(
    'enter',
    e => {
      // Don't handle Enter if input is focused
      if (document.activeElement?.tagName === 'INPUT') {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      if (focusedIndex >= 0 && focusedIndex < localDirectories.length) {
        handleRemoveDirectory(localDirectories[focusedIndex])
      } else if (focusedIndex === -1 && !isAdding) {
        setIsAdding(true)
      }
    },
    {
      enabled: isOpen && focusedIndex !== null,
      scopes: AdditionalDirectoriesHotkeyScope,
      preventDefault: true,
      enableOnFormTags: false, // Disable in form elements
    },
  )

  // Handle escape key with two-stage behavior
  useHotkeys(
    'escape',
    e => {
      // Prevent default and stop propagation
      e.preventDefault()
      e.stopPropagation()

      // If input is focused, blur it first (first escape)
      if (isAdding && document.activeElement?.tagName === 'INPUT') {
        const input = document.activeElement as HTMLElement
        input.blur()
        // Don't close popover on first escape when input is focused
        return
      }

      // If adding but input not focused, cancel adding mode
      if (isAdding) {
        setIsAdding(false)
        setNewDirectory('')
        setFocusedIndex(-1)
        // Focus back on add button
        setTimeout(() => {
          addButtonRef.current?.focus()
        }, 0)
        // Don't close popover when canceling add mode
        return
      }

      // Otherwise close the popover (second escape or when not adding)
      setIsOpen(false)
      setFocusedIndex(-1)
    },
    {
      enabled: isOpen,
      scopes: AdditionalDirectoriesHotkeyScope,
      preventDefault: true,
      enableOnFormTags: true, // Enable in input fields
    },
  )

  const handleAddDirectory = async (directoryPath?: string) => {
    const pathToAdd = directoryPath || newDirectory
    const trimmed = pathToAdd.trim()
    if (trimmed && !localDirectories.includes(trimmed)) {
      const updated = [...localDirectories, trimmed]
      setLocalDirectories(updated)
      setIsUpdating(true)
      try {
        // Await the update to ensure it completes before allowing further actions
        await onDirectoriesChange?.(updated)
        setNewDirectory('')
        setIsAdding(false)

        // Show appropriate message based on session status
        if (sessionStatus === 'running' || sessionStatus === 'starting') {
          toast.success('Directory added - will apply at next message')
        } else {
          toast.success('Directory added')
        }
      } catch {
        toast.error('Failed to add directory')
        // Revert the local change on error
        setLocalDirectories(directories)
      } finally {
        setIsUpdating(false)
      }
    }
  }

  const handleRemoveDirectory = async (dirToRemove: string) => {
    const updated = localDirectories.filter(dir => dir !== dirToRemove)
    setLocalDirectories(updated)
    setIsUpdating(true)
    try {
      // Await the update to ensure it completes before allowing further actions
      await onDirectoriesChange?.(updated)

      // Show appropriate message based on session status
      if (sessionStatus === 'running' || sessionStatus === 'starting') {
        toast.success('Directory removed - will apply at next message')
      } else {
        toast.success('Directory removed')
      }
    } catch {
      toast.error('Failed to remove directory')
      // Revert the local change on error
      setLocalDirectories(directories)
    } finally {
      setIsUpdating(false)
    }
  }

  const directoryCount = directories?.length || 0

  const buttonContent = (
    <button
      className={`inline-flex items-center text-xs font-mono transition-colors focus:outline-none ${
        canEdit
          ? 'text-muted-foreground hover:text-foreground cursor-pointer'
          : 'text-muted-foreground/50 cursor-not-allowed'
      }`}
      disabled={!canEdit || isUpdating}
    >
      <span>{workingDir}</span>
      {directoryCount > 0 && <span className="ml-1.5">+{directoryCount} more</span>}
      {!canEdit && <Lock className="h-3 w-3 ml-1" />}
      {isOpen ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
    </button>
  )

  if (!canEdit) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
          <TooltipContent align="start" sideOffset={5} className="text-xs">
            Directory changes available when ready for input
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={open => {
        setIsOpen(open)
        if (!open) {
          // Reset states when closing
          setIsAdding(false)
          setNewDirectory('')
          setFocusedIndex(-1)

          // Restore focus to trigger
          setTimeout(() => {
            triggerRef.current?.focus()
          }, 0)
        }
      }}
    >
      <PopoverTrigger
        asChild
        onClick={e => {
          triggerRef.current = e.currentTarget as HTMLElement
        }}
      >
        {buttonContent}
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-3"
        align="start"
        sideOffset={5}
        onOpenAutoFocus={e => {
          e.preventDefault()
          // Let our custom focus management handle it
        }}
        onCloseAutoFocus={e => {
          e.preventDefault()
          // We handle focus restoration ourselves
        }}
        onEscapeKeyDown={e => {
          // Always prevent Radix UI from closing popover on escape
          // Our custom escape handler will manage the closing
          e.preventDefault()
        }}
        onInteractOutside={e => {
          // Prevent closing when interacting with the input or other elements
          const target = e.target as HTMLElement
          if (target.closest('[data-slot="popover-content"]')) {
            e.preventDefault()
          }
        }}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground pb-1 border-b">
            <FolderOpen className="h-3 w-3" />
            <span>Working Directory</span>
          </div>
          <div className="font-mono text-xs text-foreground py-1">{workingDir}</div>

          <div className="flex items-center justify-between text-xs font-semibold text-foreground pt-2 pb-1 border-b">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3" />
              <span>Additional Directories</span>
            </div>
            {onDirectoriesChange && (
              <Button
                ref={addButtonRef}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAdding(true)
                  setFocusedIndex(-1)
                }}
                className="h-5 px-1 text-xs focus:ring-2 focus:ring-offset-0 focus:ring-accent/50"
              >
                <Plus className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {localDirectories.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No additional directories</p>
            ) : (
              localDirectories.map((dir, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex items-center justify-between group hover:bg-muted/50 rounded px-1 py-0.5',
                    focusedIndex === index && 'bg-accent/20',
                  )}
                >
                  <span className="font-mono text-xs text-muted-foreground">{dir}</span>
                  {onDirectoriesChange && (
                    <Button
                      ref={el => (directoryRefs.current[index] = el)}
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveDirectory(dir)}
                      disabled={isUpdating}
                      className={cn(
                        'h-5 w-5 p-0 transition-opacity focus:outline-none focus:ring-0',
                        focusedIndex === index ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))
            )}

            {isAdding && (
              <div className="flex gap-1 pt-1">
                <div className="flex-1" ref={searchInputRef}>
                  <SearchInput
                    value={newDirectory}
                    onChange={setNewDirectory}
                    onSubmit={async value => {
                      // Use the value passed from SearchInput (which is the selected item)
                      await handleAddDirectory(value)
                      // After adding, focus returns to add button
                      setTimeout(() => {
                        addButtonRef.current?.focus()
                      }, 0)
                    }}
                    placeholder="Enter directory path..."
                    recentDirectories={recentPaths || []}
                    className="!h-7 !text-xs md:!text-xs !mt-0"
                    dropdownClassName="text-xs"
                    autoFocus
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => handleAddDirectory()}
                  disabled={isUpdating || !newDirectory.trim()}
                  className="h-7 px-2"
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsAdding(false)
                    setNewDirectory('')
                  }}
                  className="h-7 px-2"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
