import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate, parseMcpToolName } from '@/utils/formatting'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CustomDiffViewer } from './CustomDiffViewer'
import { AnsiText, hasAnsiCodes } from '@/utils/ansiParser'
import {
  Wrench,
  Globe,
  FilePenLine,
  FileText,
  Terminal,
  Search,
  ListTodo,
  ListChecks,
} from 'lucide-react'

// Helper function to get the appropriate icon for a tool
function getToolIcon(toolName: string | undefined): React.ReactNode {
  const className = 'w-3.5 h-3.5'

  if (!toolName) return <Wrench className={className} />

  // Handle MCP tools
  if (toolName.startsWith('mcp__')) {
    return <Globe className={className} />
  }

  // Handle regular tools
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
      return <FilePenLine className={className} />
    case 'Read':
      return <FileText className={className} />
    case 'Write':
      return <FilePenLine className={className} />
    case 'Bash':
      return <Terminal className={className} />
    case 'Grep':
    case 'Glob':
      return <Search className={className} />
    case 'LS':
    case 'List':
      return <FileText className={className} />
    case 'TodoWrite':
      return <ListTodo className={className} />
    case 'WebSearch':
    case 'WebFetch':
      return <Globe className={className} />
    case 'ExitPlanMode':
      return <ListChecks className={className} />
    case 'NotebookRead':
    case 'NotebookEdit':
      return <FileText className={className} />
    default:
      return <Wrench className={className} />
  }
}

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
  // Store the focused element when modal opens
  const previousFocusRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (toolResult || toolCall) {
      previousFocusRef.current = document.activeElement as HTMLElement
    }
  }, [toolResult, toolCall])

  // Create a unified close handler that preserves focus
  const handleClose = React.useCallback(() => {
    onClose()
    // Restore focus after a microtask to avoid race conditions
    setTimeout(() => {
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus()
      }
    }, 0)
  }, [onClose])
  // Handle j/k and arrow key navigation - using priority to override background hotkeys
  useHotkeys(
    'j,down',
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
      enabled: !!(toolResult || toolCall),
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  useHotkeys(
    'k,up',
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
      enabled: !!(toolResult || toolCall),
      enableOnFormTags: true,
      preventDefault: true,
      scopes: ToolResultModalHotkeysScope,
    },
  )

  // Consolidated escape and 'i' key handler
  useHotkeys(
    'escape, i', // Handle both keys with single declaration
    ev => {
      ev.preventDefault()
      ev.stopPropagation()
      ev.stopImmediatePropagation() // Complete isolation
      if (toolResult || toolCall) {
        handleClose() // Use the unified close handler
      }
    },
    {
      enabled: !!(toolResult || toolCall),
      scopes: ToolResultModalHotkeysScope,
      preventDefault: true,
    },
  )

  const isOpen = !!(toolResult || toolCall)
  useStealHotkeyScope(ToolResultModalHotkeysScope, isOpen)

  // Show modal if we have either a tool result or just a tool call (unfinished)
  if (!isOpen) return null

  return (
    <Dialog
      open={!!(toolResult || toolCall)}
      onOpenChange={open => {
        // This handles ALL dialog close triggers including click-outside
        if (!open) {
          handleClose() // Use unified close handler
        }
      }}
    >
      <DialogContent
        className="w-[90vw] max-w-[90vw] h-[85vh] p-0 sm:max-w-[90vw] flex flex-col overflow-hidden"
        onEscapeKeyDown={e => {
          // Prevent the default Dialog escape handling (we handle it ourselves)
          e.preventDefault()
        }}
      >
        <DialogHeader className="px-4 py-3 border-b bg-background flex-none">
          <DialogTitle className="text-sm font-mono">
            <div className="flex items-center gap-2">
              {/* Add tool icon */}
              <span className="text-accent">{getToolIcon(toolCall?.toolName)}</span>
              <span>
                {toolCall?.toolName || 'Tool Result'}
                {!toolResult && toolCall && !toolCall.isCompleted && (
                  <span className="text-xs text-muted-foreground ml-2">(in progress)</span>
                )}
              </span>
              {/* Show primary parameter */}
              {toolCall?.toolInputJson && (
                <span className="text-xs text-muted-foreground">{getToolPrimaryParam(toolCall)}</span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-4 py-4 space-y-4">
              {/* Tool Input Section */}
              {toolCall?.toolInputJson && renderToolInput(toolCall)}

              {/* Tool Result Section - only show if we have a result */}
              {toolResult && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Result</h3>
                  <pre className="font-mono text-sm whitespace-pre-wrap break-words">
                    {/* Only apply ANSI parsing to Bash tool output */}
                    {toolCall?.toolName === 'Bash' &&
                    typeof toolResult.toolResultContent === 'string' &&
                    hasAnsiCodes(toolResult.toolResultContent) ? (
                      <AnsiText content={toolResult.toolResultContent} />
                    ) : (
                      toolResult.toolResultContent || 'No content'
                    )}
                  </pre>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="px-4 py-2 border-t bg-muted/30 flex justify-between items-center flex-none">
          <span className="text-xs text-muted-foreground">
            <kbd>j/k</kbd> or <kbd>↓/↑</kbd> to scroll
          </span>
          <span className="text-xs text-muted-foreground">
            <kbd>i</kbd> or <kbd>ESC</kbd> to close
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
  if (!toolCall.toolInputJson) return ''

  try {
    const args = JSON.parse(toolCall.toolInputJson)

    // Show the most relevant argument based on tool name
    if (toolCall.toolName === 'Read' && args.file_path) {
      return args.file_path
    } else if (toolCall.toolName === 'Bash' && args.command) {
      return truncate(args.command, 60)
    } else if (toolCall.toolName === 'Edit' && args.file_path) {
      return args.file_path
    } else if (toolCall.toolName === 'Write' && args.file_path) {
      return args.file_path
    } else if (toolCall.toolName === 'Grep' && args.pattern) {
      return args.pattern
    } else if (toolCall.toolName === 'ExitPlanMode' && args.plan) {
      const firstLine = args.plan.split('\n')[0].trim()
      return truncate(firstLine, 60)
    } else if (toolCall.toolName === 'WebFetch' && args.url) {
      return truncate(args.url, 60)
    }

    // For other tools, show the first string value
    const firstValue = Object.values(args).find(v => typeof v === 'string')
    return firstValue ? truncate(String(firstValue), 60) : ''
  } catch {
    return ''
  }
}

function renderToolInput(toolCall: ConversationEvent): React.ReactNode {
  if (!toolCall.toolInputJson) return null

  try {
    const args = JSON.parse(toolCall.toolInputJson)

    // Special rendering for MCP tools
    if (toolCall.toolName?.startsWith('mcp__')) {
      const { service, method } = parseMcpToolName(toolCall.toolName)

      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">Service:</span>{' '}
            <span className="font-bold">{service}</span>
          </div>
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">Method:</span>{' '}
            <span className="font-bold">{method}</span>
          </div>
          {Object.keys(args).length > 0 && (
            <div className="font-mono text-sm">
              <span className="text-muted-foreground">Parameters:</span>
              <pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )
    }

    // Special rendering for Write tool
    if (toolCall.toolName === 'Write') {
      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">File:</span>{' '}
            <span className="font-bold">{args.file_path}</span>
          </div>
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">Content:</span>
            <pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
              {args.content}
            </pre>
          </div>
        </div>
      )
    }

    // Special rendering for Edit tool
    if (toolCall.toolName === 'Edit') {
      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">File:</span>{' '}
            <span className="font-bold">{args.file_path}</span>
          </div>
          <div className="mt-2">
            <CustomDiffViewer
              edits={[{ oldValue: args.old_string, newValue: args.new_string }]}
              splitView={false}
            />
          </div>
        </div>
      )
    }

    // Special rendering for MultiEdit tool
    if (toolCall.toolName === 'MultiEdit') {
      const allEdits = args.edits.map((e: any) => ({
        oldValue: e.old_string,
        newValue: e.new_string,
      }))

      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">File:</span>{' '}
            <span className="font-bold">{args.file_path}</span>
          </div>
          <div className="font-mono text-sm mb-2">
            <span className="text-muted-foreground">{args.edits.length} edits</span>
          </div>
          <div className="mt-2">
            <CustomDiffViewer edits={allEdits} splitView={false} />
          </div>
        </div>
      )
    }

    // Special rendering for ExitPlanMode tool
    if (toolCall.toolName === 'ExitPlanMode') {
      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">Plan:</span>
            <pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
              {args.plan}
            </pre>
          </div>
        </div>
      )
    }

    // Special rendering for WebFetch tool
    if (toolCall.toolName === 'WebFetch') {
      return (
        <div className="space-y-2">
          <div className="font-mono text-sm">
            <span className="text-muted-foreground">URL:</span>{' '}
            <span className="font-bold">{args.url}</span>
          </div>
          {args.prompt && (
            <div className="font-mono text-sm">
              <span className="text-muted-foreground">Prompt:</span>{' '}
              <span className="italic">{args.prompt}</span>
            </div>
          )}
        </div>
      )
    }

    // Default JSON rendering for other tools
    return (
      <pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words">
        {formatToolInput(toolCall.toolInputJson)}
      </pre>
    )
  } catch {
    // Fallback to raw display if JSON parsing fails
    return (
      <pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words">
        {toolCall.toolInputJson}
      </pre>
    )
  }
}
