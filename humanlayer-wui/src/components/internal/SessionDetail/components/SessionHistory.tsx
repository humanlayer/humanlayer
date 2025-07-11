import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ConversationEvent } from '@/lib/daemon/types'
import { cn } from '@/lib/utils'

interface SessionHistoryProps {
  events: ConversationEvent[]
  selectedEventIndex: number | null
  onSelectEvent: (index: number) => void
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function SessionHistory({ 
  events, 
  selectedEventIndex, 
  onSelectEvent,
  isOpen,
  onOpenChange 
}: SessionHistoryProps) {
  // Filter to only user messages
  const userMessageIndices = events
    .map((e, i) => ({ event: e, index: i }))
    .filter(({ event }) => event.event_type === 'message' && event.role === 'user')
  
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0)
  
  // Sync with external selection
  useEffect(() => {
    if (selectedEventIndex !== null) {
      const userMessagePosition = userMessageIndices.findIndex(
        ({ index }) => index === selectedEventIndex
      )
      if (userMessagePosition !== -1) {
        setLocalSelectedIndex(userMessagePosition)
      }
    }
  }, [selectedEventIndex, userMessageIndices])
  
  // Navigation hotkeys (only when open)
  useHotkeys('j, down', () => {
    const newIndex = (localSelectedIndex + 1) % userMessageIndices.length
    setLocalSelectedIndex(newIndex)
    onSelectEvent(userMessageIndices[newIndex].index)
  }, { enabled: isOpen })
  
  useHotkeys('k, up', () => {
    const newIndex = (localSelectedIndex - 1 + userMessageIndices.length) % userMessageIndices.length
    setLocalSelectedIndex(newIndex)
    onSelectEvent(userMessageIndices[newIndex].index)
  }, { enabled: isOpen })
  
  // Number key navigation
  useHotkeys('1,2,3,4,5,6,7,8,9', (_, handler) => {
    const num = parseInt(handler.keys?.[0] || '0') - 1
    if (num < userMessageIndices.length) {
      setLocalSelectedIndex(num)
      onSelectEvent(userMessageIndices[num].index)
    }
  }, { enabled: isOpen })
  
  // Handle empty conversations
  if (userMessageIndices.length === 0) {
    return (
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="w-full group">
          <div className="flex items-center justify-center py-2 px-4 hover:bg-accent/10 transition-colors rounded-md">
            <ChevronDown 
              className={cn(
                "w-4 h-4 transition-transform",
                isOpen && "rotate-180"
              )} 
            />
            <span className="text-sm font-medium ml-2">Session History</span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 text-sm text-muted-foreground text-center">
            No messages to navigate to yet
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="w-full group">
        <div className="flex items-center justify-center py-2 px-4 hover:bg-accent/10 transition-colors rounded-md">
          <ChevronDown 
            className={cn(
              "w-4 h-4 transition-transform",
              isOpen && "rotate-180"
            )} 
          />
          <span className="text-sm font-medium ml-2">
            {selectedEventIndex !== null 
              ? `Viewing history at message ${localSelectedIndex + 1} of ${userMessageIndices.length}`
              : 'Session History'
            }
          </span>
          {selectedEventIndex !== null && (
            <span className="text-xs text-muted-foreground ml-2">
              (Press Enter to fork from here)
            </span>
          )}
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="px-4 pb-4">
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 max-h-64 overflow-y-auto">
            {userMessageIndices.map(({ event, index }, position) => {
              const isSelected = position === localSelectedIndex
              const isCurrent = index === events.length - 1
              const preview = event.content?.split('\n')[0]?.substring(0, 80) + 
                             (event.content && event.content.length > 80 ? '...' : '')
              
              return (
                <div
                  key={event.id}
                  className={cn(
                    "px-3 py-2 rounded-md cursor-pointer transition-all text-sm",
                    isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                    isCurrent && "opacity-60"
                  )}
                  onClick={() => {
                    setLocalSelectedIndex(position)
                    onSelectEvent(index)
                  }}
                  onMouseEnter={() => setLocalSelectedIndex(position)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-mono text-muted-foreground mt-0.5">
                      {position + 1}
                    </span>
                    <span className="flex-1">
                      {isCurrent ? '(current message)' : preview || '(empty message)'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-3">
            <div className="flex items-center gap-4">
              <span>↑↓ j/k Navigate</span>
              <span>1-9 Quick jump</span>
              <span>Enter to fork</span>
            </div>
            <span>Click to preview</span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}