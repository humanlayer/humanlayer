import { useState, useEffect, useRef, useCallback } from 'react'
import { GitBranch } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConversationEvent } from '@/lib/daemon/types'
import { cn } from '@/lib/utils'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'

const ForkViewModalHotkeysScope = 'fork-view-modal'

interface ForkViewModalProps {
  events: ConversationEvent[]
  selectedEventIndex: number | null
  onSelectEvent: (index: number | null) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

function ForkViewModalContent({
  events,
  selectedEventIndex,
  onSelectEvent,
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

  // Create unified close handler with focus preservation
  const handleClose = useCallback(() => {
    onClose()
    // Restore focus after a microtask to avoid race conditions
    setTimeout(() => {
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus()
      }
    }, 0)
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
      if (localSelectedIndex < allOptions.length - 1) {
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
      if (localSelectedIndex > 0) {
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
      const num = parseInt(handler.keys?.[0] || '0') - 1
      if (num < allOptions.length) {
        setLocalSelectedIndex(num)
        const option = allOptions[num]
        onSelectEvent(option.index === -1 ? null : option.index)
      }
    },
    { scopes: [ForkViewModalHotkeysScope], enableOnFormTags: true },
  )

  // Enter to confirm fork
  useHotkeys(
    'enter',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEventIndex !== null || localSelectedIndex === allOptions.length - 1) {
        handleClose() // Use unified handler
      }
    },
    { scopes: [ForkViewModalHotkeysScope], preventDefault: true },
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

      <div ref={containerRef} className="mt-4 outline-none" tabIndex={-1}>
        {userMessageIndices.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No messages to fork from yet
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
            {userMessageIndices.map(({ event, index }, position) => {
              const isSelected = position === localSelectedIndex
              const isActive = index === selectedEventIndex
              const preview =
                event.content?.split('\n')[0]?.substring(0, 80) +
                (event.content && event.content.length > 80 ? '...' : '')

              return (
                <div
                  key={event.id}
                  className={cn(
                    'px-4 py-3 rounded-md cursor-pointer transition-all text-sm',
                    isActive && 'ring-2 ring-primary',
                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  )}
                  onClick={() => {
                    setLocalSelectedIndex(position)
                    onSelectEvent(index)
                  }}
                  onMouseEnter={() => setLocalSelectedIndex(position)}
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
                    'px-4 py-3 rounded-md cursor-pointer transition-all text-sm',
                    selectedEventIndex === null
                      ? 'bg-accent text-accent-foreground ring-2 ring-primary'
                      : 'hover:bg-accent/50',
                  )}
                  onClick={() => {
                    onSelectEvent(null)
                    setLocalSelectedIndex(allOptions.length - 1)
                  }}
                  onMouseEnter={() => setLocalSelectedIndex(allOptions.length - 1)}
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

        <div className="flex items-center justify-between text-xs text-muted-foreground mt-4 pt-4 border-t">
          <div className="flex items-center gap-4">
            <span>↑↓ j/k Navigate</span>
            <span>1-9 Jump</span>
            <span>Enter Select</span>
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
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Fork View (Meta+Y)">
          <GitBranch className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-2xl"
        showCloseButton={false}
        onOpenAutoFocus={e => {
          // Prevent default focus behavior but let our custom focus management work
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
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
