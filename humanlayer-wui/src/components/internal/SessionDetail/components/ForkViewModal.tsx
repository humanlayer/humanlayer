import { useState, useEffect, useRef, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ConversationEvent } from '@/lib/daemon/types'
import { cn } from '@/lib/utils'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { getArchiveOnForkPreference, setArchiveOnForkPreference } from '@/lib/preferences'

const ForkViewModalHotkeysScope = 'fork-view-modal'

interface ForkViewModalProps {
  events: ConversationEvent[]
  selectedEventIndex: number | null
  onSelectEvent: (index: number | null) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  sessionStatus?: string // Add this
  onArchiveOnForkChange?: (value: boolean) => void
}

function ForkViewModalContent({
  events,
  selectedEventIndex,
  onSelectEvent,
  sessionStatus,
  onArchiveOnForkChange,
  onClose,
}: Omit<ForkViewModalProps, 'isOpen' | 'onOpenChange'> & { onClose: () => void }) {
  // Steal hotkey scope when this component mounts
  useStealHotkeyScope(ForkViewModalHotkeysScope)

  // Focus management
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    // Store the previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement

    // Focus the container when modal opens
    if (containerRef.current) {
      containerRef.current.focus()
    }

    // Blur any active element (like the chat input)
    const activeElement = document.activeElement as HTMLElement
    if (activeElement && activeElement.blur) {
      activeElement.blur()
    }
  }, [])

  // Create unified close handler without focus management
  // Focus will be handled by the parent component
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Filter to only user messages (excluding the first one)
  const userMessageIndices = events
    .map((e, i) => ({ event: e, index: i }))
    .filter(({ event }) => event.eventType === 'message' && event.role === 'user')
    .slice(1) // Exclude first message since it can't be forked

  // Add current option as a special index (-1) for all sessions
  const showCurrentOption = true
  const allOptions = showCurrentOption
    ? [...userMessageIndices, { event: null, index: -1 }]
    : userMessageIndices

  const [localSelectedIndex, setLocalSelectedIndex] = useState(0)
  const [localArchiveOnFork, setLocalArchiveOnFork] = useState(() => {
    return getArchiveOnForkPreference()
  })
  // Track which section has focus: 'messages', 'checkbox', or 'buttons'
  const [focusedSection, setFocusedSection] = useState<'messages' | 'checkbox' | 'buttons'>('messages')

  // Add handler for checkbox change
  const handleArchiveCheckboxChange = useCallback(
    (checked: boolean) => {
      setLocalArchiveOnFork(checked)
      setArchiveOnForkPreference(checked)
      onArchiveOnForkChange?.(checked)
    },
    [onArchiveOnForkChange],
  )

  // Handler for executing the fork action
  const handleFork = useCallback(() => {
    // Execute fork with current selection
    const selectedOption = allOptions[localSelectedIndex]
    if (selectedOption) {
      onSelectEvent(selectedOption.index === -1 ? null : selectedOption.index)
      handleClose()
    }
  }, [localSelectedIndex, allOptions, onSelectEvent, handleClose])

  // Pre-select last message for failed sessions
  useEffect(() => {
    if (sessionStatus === 'failed' && selectedEventIndex === null && allOptions.length > 0) {
      // Pre-select the last user message for failed sessions
      setLocalSelectedIndex(allOptions.length - 2) // Last message before "Current"
    }
  }, [sessionStatus, selectedEventIndex, allOptions.length])

  // Sync with external selection
  useEffect(() => {
    if (selectedEventIndex === null) {
      // Current is selected
      setLocalSelectedIndex(allOptions.length - 1)
    } else {
      const userMessagePosition = userMessageIndices.findIndex(
        ({ index }) => index === selectedEventIndex,
      )
      if (userMessagePosition !== -1) {
        setLocalSelectedIndex(userMessagePosition)
      }
    }
  }, [selectedEventIndex, userMessageIndices, allOptions.length])

  // Navigation hotkeys
  useHotkeys(
    'j, down',
    () => {
      // Only navigate if message list is focused
      if (focusedSection === 'messages' && localSelectedIndex < allOptions.length - 1) {
        const newIndex = localSelectedIndex + 1
        setLocalSelectedIndex(newIndex)
        const option = allOptions[newIndex]
        onSelectEvent(option.index === -1 ? null : option.index)
      }
    },
    { scopes: [ForkViewModalHotkeysScope], enableOnFormTags: true },
  )

  useHotkeys(
    'k, up',
    () => {
      // Only navigate if message list is focused
      if (focusedSection === 'messages' && localSelectedIndex > 0) {
        const newIndex = localSelectedIndex - 1
        setLocalSelectedIndex(newIndex)
        const option = allOptions[newIndex]
        onSelectEvent(option.index === -1 ? null : option.index)
      }
    },
    { scopes: [ForkViewModalHotkeysScope], enableOnFormTags: true },
  )

  // Number key navigation
  useHotkeys(
    '1,2,3,4,5,6,7,8,9',
    (_, handler) => {
      // Only navigate if message list is focused
      if (focusedSection === 'messages') {
        const num = parseInt(handler.keys?.[0] || '0') - 1
        if (num < allOptions.length) {
          setLocalSelectedIndex(num)
          const option = allOptions[num]
          onSelectEvent(option.index === -1 ? null : option.index)
        }
      }
    },
    { scopes: [ForkViewModalHotkeysScope], enableOnFormTags: true },
  )

  // Enter to select item (not fork) or toggle checkbox if focused
  useHotkeys(
    'enter',
    e => {
      e.preventDefault()
      e.stopPropagation()

      if (focusedSection === 'checkbox') {
        // Toggle checkbox when Enter is pressed in checkbox section
        handleArchiveCheckboxChange(!localArchiveOnFork)
      } else if (focusedSection === 'messages') {
        // Only select the item, don't close modal or fork
        if (localSelectedIndex === allOptions.length - 1) {
          onSelectEvent(null)
        } else {
          const selectedOption = allOptions[localSelectedIndex]
          if (selectedOption) {
            onSelectEvent(selectedOption.index)
          }
        }
      }
    },
    { scopes: [ForkViewModalHotkeysScope], preventDefault: true },
  )

  // Cmd/Ctrl+Enter to execute fork
  useHotkeys(
    'mod+enter',
    e => {
      e.preventDefault()
      e.stopPropagation()
      handleFork()
    },
    {
      scopes: [ForkViewModalHotkeysScope],
      preventDefault: true,
      enableOnFormTags: true,
    },
  )

  // Tab to move focus between message list, checkbox, and buttons
  useHotkeys(
    'tab',
    e => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation() // Complete isolation

      // Move focus forward: messages -> checkbox -> buttons (stop)
      if (focusedSection === 'messages') {
        setFocusedSection('checkbox')
        // Focus the checkbox element
        setTimeout(() => {
          const checkboxElement = document.getElementById('archive-on-fork')
          checkboxElement?.focus()
        }, 0)
      } else if (focusedSection === 'checkbox') {
        setFocusedSection('buttons')
        // Focus the fork button
        setTimeout(() => {
          const forkButton = document.getElementById('fork-button')
          forkButton?.focus()
        }, 0)
      }
      // Do nothing if on buttons (stop at fork button)
    },
    { scopes: [ForkViewModalHotkeysScope], preventDefault: true, enableOnFormTags: true },
  )

  // Shift+Tab to move focus backward
  useHotkeys(
    'shift+tab',
    e => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation() // Complete isolation

      // Move focus backward: (stop) <- messages <- checkbox <- buttons
      if (focusedSection === 'buttons') {
        setFocusedSection('checkbox')
        // Focus the checkbox element
        setTimeout(() => {
          const checkboxElement = document.getElementById('archive-on-fork')
          checkboxElement?.focus()
        }, 0)
      } else if (focusedSection === 'checkbox') {
        setFocusedSection('messages')
        // Return focus to container
        setTimeout(() => {
          containerRef.current?.focus()
        }, 0)
      }
      // Do nothing if on messages (stop at message list)
    },
    { scopes: [ForkViewModalHotkeysScope], preventDefault: true, enableOnFormTags: true },
  )

  // Space to toggle checkbox when checkbox section is focused
  useHotkeys(
    'space',
    e => {
      if (focusedSection === 'checkbox') {
        e.preventDefault()
        e.stopPropagation()
        handleArchiveCheckboxChange(!localArchiveOnFork)
      }
    },
    { scopes: [ForkViewModalHotkeysScope], enableOnFormTags: true },
  )

  // Escape to close and clear selection
  useHotkeys(
    'escape',
    e => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation() // Complete isolation
      onSelectEvent(null) // Clear selection first
      handleClose() // Use unified handler
    },
    { scopes: [ForkViewModalHotkeysScope], preventDefault: true },
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fork View</DialogTitle>
        <DialogDescription>
          Select a message to fork from that point in the conversation
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4">
        <div
          ref={containerRef}
          className={cn(
            'outline-none border rounded-md transition-colors',
            focusedSection === 'messages' ? 'border-accent bg-accent/5' : 'border-border',
          )}
          tabIndex={-1}
          onFocus={() => setFocusedSection('messages')}
          onKeyDown={e => {
            // Capture Tab and Shift+Tab at the container level
            if (e.key === 'Tab') {
              e.preventDefault()
              e.stopPropagation()
              if (e.shiftKey) {
                // Shift+Tab on message list does nothing (stop here)
              } else {
                // Tab goes to checkbox
                setFocusedSection('checkbox')
                setTimeout(() => {
                  const checkboxElement = document.getElementById('archive-on-fork')
                  checkboxElement?.focus()
                }, 0)
              }
            }
          }}
        >
          {userMessageIndices.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No messages to fork from yet
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto p-2">
              {userMessageIndices.map(({ event, index }, position) => {
                const isSelected = position === localSelectedIndex
                const preview =
                  event.content?.split('\n')[0]?.substring(0, 80) +
                  (event.content && event.content.length > 80 ? '...' : '')

                return (
                  <div
                    key={event.id}
                    className={cn(
                      'px-3 py-2 cursor-pointer transition-all text-sm border-l-2 rounded',
                      isSelected
                        ? 'border-l-[var(--terminal-accent)] bg-accent/10'
                        : 'border-transparent hover:bg-accent/5',
                    )}
                    onClick={() => {
                      setLocalSelectedIndex(position)
                      onSelectEvent(index)
                      // Don't close modal on selection, wait for fork button
                    }}
                    onMouseEnter={() => {
                      setLocalSelectedIndex(position)
                      setFocusedSection('messages') // Ensure we're in messages section on hover
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xs font-mono text-muted-foreground mt-0.5">
                        {position + 1}
                      </span>
                      <span className="flex-1">{preview || '(empty message)'}</span>
                    </div>
                  </div>
                )
              })}

              {/* Current option */}
              {showCurrentOption && (
                <div className="border-t mt-2 pt-2">
                  <div
                    className={cn(
                      'px-3 py-2 cursor-pointer transition-all text-sm border-l-2 rounded',
                      localSelectedIndex === allOptions.length - 1
                        ? 'border-l-[var(--terminal-accent)] bg-accent/10'
                        : 'border-transparent hover:bg-accent/5',
                    )}
                    onClick={() => {
                      setLocalSelectedIndex(allOptions.length - 1)
                      onSelectEvent(null)
                      // Don't close modal on selection, wait for fork button
                    }}
                    onMouseEnter={() => {
                      setLocalSelectedIndex(allOptions.length - 1)
                      setFocusedSection('messages') // Ensure we're in messages section on hover
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xs font-mono text-muted-foreground mt-0.5">•</span>
                      <span className="flex-1 font-medium">Current (latest state)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={cn(
            'flex items-center justify-between mt-4 py-3 border-t transition-colors',
            focusedSection === 'checkbox' ? 'bg-accent/10 px-4' : 'px-4',
          )}
        >
          <div className="flex items-center space-x-2">
            <Checkbox
              id="archive-on-fork"
              checked={localArchiveOnFork}
              onCheckedChange={handleArchiveCheckboxChange}
              onFocus={() => setFocusedSection('checkbox')}
              className={focusedSection === 'checkbox' ? 'focus-visible:ring-0' : ''}
              onKeyDown={e => {
                // Handle both Tab and Shift+Tab on checkbox
                if (e.key === 'Tab') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (e.shiftKey) {
                    // Shift+Tab goes back to message list
                    setFocusedSection('messages')
                    setTimeout(() => {
                      containerRef.current?.focus()
                    }, 0)
                  } else {
                    // Tab goes to fork button
                    setFocusedSection('buttons')
                    setTimeout(() => {
                      const forkButton = document.getElementById('fork-button')
                      forkButton?.focus()
                    }, 0)
                  }
                }
              }}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label htmlFor="archive-on-fork" className="text-sm font-normal cursor-pointer">
                    Archive original session after fork
                  </Label>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Automatically archives the current session after creating a fork</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} onFocus={() => setFocusedSection('buttons')}>
            Cancel
          </Button>
          <Button
            id="fork-button"
            onClick={handleFork}
            disabled={userMessageIndices.length === 0}
            onFocus={() => setFocusedSection('buttons')}
            onKeyDown={e => {
              // Handle both Tab and Shift+Tab on fork button
              if (e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                if (e.shiftKey) {
                  // Shift+Tab goes back to checkbox
                  setFocusedSection('checkbox')
                  setTimeout(() => {
                    const checkboxElement = document.getElementById('archive-on-fork')
                    checkboxElement?.focus()
                  }, 0)
                } else {
                  // Tab on fork button does nothing (stop here)
                }
              }
            }}
          >
            Fork Session
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
              {navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}+⏎
            </kbd>
          </Button>
        </DialogFooter>

        <div className="flex items-center justify-between text-xs text-muted-foreground mt-4 pt-4 border-t">
          <div className="flex items-center gap-4">
            <span>↑↓/j/k Navigate</span>
            <span>1-9 Jump</span>
            <span>Tab Focus</span>
            <span>⌘⏎ Fork</span>
            <span>Esc Cancel</span>
          </div>
        </div>
      </div>
    </>
  )
}

// Main component that handles the dialog
export function ForkViewModal({
  events,
  selectedEventIndex,
  onSelectEvent,
  isOpen,
  onOpenChange,
  sessionStatus,
  onArchiveOnForkChange,
}: ForkViewModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={isOpen => {
        if (!isOpen) {
          onOpenChange(false)
        } else {
          onOpenChange(true)
        }
      }}
    >
      <DialogContent
        className="max-w-2xl"
        showCloseButton={false}
        onOpenAutoFocus={e => {
          // Prevent default focus behavior but let our custom focus management work
          e.preventDefault()
        }}
        onCloseAutoFocus={e => {
          // Prevent the dialog from restoring focus when it closes
          // The parent component will handle focus restoration
          e.preventDefault()
        }}
        onEscapeKeyDown={e => {
          // Prevent the default Dialog escape handling
          // Our custom escape handler in ForkViewModalContent will handle it
          e.preventDefault()
        }}
      >
        {isOpen && (
          <ForkViewModalContent
            events={events}
            selectedEventIndex={selectedEventIndex}
            onSelectEvent={onSelectEvent}
            sessionStatus={sessionStatus}
            onArchiveOnForkChange={onArchiveOnForkChange}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
