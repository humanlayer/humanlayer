import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate } from '@/utils/formatting'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getToolIcon } from '../eventToDisplayObject'

// TODO(3): Add keyboard navigation hints in the UI
// TODO(2): Consider adding copy-to-clipboard functionality for tool results

const ToolResultModalHotkeysScope = 'tool-result-modal'

// Minimalist modal for showing full tool results
export function ToolResultModal({
  toolCall,
  toolResult,
  onClose,
}: {
  toolCall: ConversationEvent | null
  toolResult: ConversationEvent | null
  onClose: () => void
}) {

  // Handle j/k navigation - using priority to override background hotkeys
  useHotkeys(
    'j',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult) {
        // Find the ScrollArea viewport
        const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
        if (viewport) {
          viewport.scrollTop += 100
        }
      }
    },
    {
      enabled: !!toolResult,
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  useHotkeys(
    'k',
    e => {
      e.preventDefault()
      e.stopPropagation()
      if (toolResult) {
        // Find the ScrollArea viewport
        const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
        if (viewport) {
          viewport.scrollTop -= 100
        }
      }
    },
    {
      enabled: !!toolResult,
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  // Handle escape to close
  useHotkeys(
    'escape',
    ev => {
      ev.stopPropagation()
      if (toolResult) {
        onClose()
      }
    },
    { enabled: !!toolResult, scopes: ToolResultModalHotkeysScope },
  )

  useStealHotkeyScope(ToolResultModalHotkeysScope)

  if (!toolResult) return null

  return (
    <Dialog
      open={!!toolResult}
      onOpenChange={open => {
        !open && onClose()
      }}
    >
      <DialogContent className="w-[90vw] max-w-[1200px] h-[85vh] p-0">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle className="text-base font-medium">
            <div className="flex items-center gap-2">
              {/* Add tool icon */}
              <span className="text-accent">
                {getToolIcon(toolCall?.tool_name)}
              </span>
              <span>{toolCall?.tool_name || 'Tool Result'}</span>
              {/* Show primary parameter */}
              {toolCall?.tool_input_json && (
                <span className="text-sm text-muted-foreground">
                  {getToolPrimaryParam(toolCall)}
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Tool Input Section */}
            {toolCall?.tool_input_json && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Input</h3>
                <pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 overflow-x-auto">
                  {formatToolInput(toolCall.tool_input_json)}
                </pre>
              </div>
            )}

            {/* Tool Result Section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Result</h3>
              <pre className="font-mono text-sm whitespace-pre-wrap">
                {toolResult.tool_result_content || 'No content'}
              </pre>
            </div>
          </div>
        </ScrollArea>

        <div className="px-6 py-3 border-t bg-muted/30 flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            <kbd>j/k</kbd> to scroll
          </span>
          <span className="text-xs text-muted-foreground">
            <kbd>ESC</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Helper functions
function formatToolInput(inputJson: string | undefined): string {
  if (!inputJson) return 'No input'
  try {
    const parsed = JSON.parse(inputJson)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return inputJson
  }
}

function getToolPrimaryParam(toolCall: ConversationEvent): string {
  if (!toolCall.tool_input_json) return ''
  
  try {
    const args = JSON.parse(toolCall.tool_input_json)
    
    // Show the most relevant argument based on tool name
    if (toolCall.tool_name === 'Read' && args.file_path) {
      return args.file_path
    } else if (toolCall.tool_name === 'Bash' && args.command) {
      return truncate(args.command, 60)
    } else if (toolCall.tool_name === 'Edit' && args.file_path) {
      return args.file_path
    } else if (toolCall.tool_name === 'Write' && args.file_path) {
      return args.file_path
    } else if (toolCall.tool_name === 'Grep' && args.pattern) {
      return args.pattern
    }
    
    // For other tools, show the first string value
    const firstValue = Object.values(args).find(v => typeof v === 'string')
    return firstValue ? truncate(String(firstValue), 60) : ''
  } catch {
    return ''
  }
}
