import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConversationEvent } from '@/lib/daemon/types'
import { truncate, parseMcpToolName } from '@/utils/formatting'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getToolIcon } from '../eventToDisplayObject'
import { CustomDiffViewer } from './CustomDiffViewer'
import { AnsiText, hasAnsiCodes } from '@/utils/ansiParser'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'

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

  // Handle escape to close
  useHotkeys(
    'escape',
    ev => {
      ev.preventDefault()
      ev.stopPropagation()
      if (toolResult || toolCall) {
        onClose()
      }
    },
    {
      enabled: !!(toolResult || toolCall),
      scopes: ToolResultModalHotkeysScope,
      preventDefault: true,
    },
  )

  // Handle 'i' to close (toggle behavior)
  useHotkeys(
    'i',
    ev => {
      ev.preventDefault()
      ev.stopPropagation()
      if (toolResult || toolCall) {
        onClose()
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
        // Only close if Dialog is being closed by something other than escape
        // Our custom escape handler will handle the escape key
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent
        className="w-[90vw] max-w-[90vw] h-[85vh] p-0 sm:max-w-[90vw] flex flex-col overflow-hidden"
        onEscapeKeyDown={e => {
          // Prevent the default Dialog escape handling
          e.preventDefault()
        }}
        onPointerDownOutside={e => {
          // Prevent closing when clicking outside
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
              {toolCall?.toolInputJson && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Input</h3>
                  <DataTransformErrorBoundary
                    dataContext="tool input rendering"
                    expectedDataType="JSON"
                    extractFailureInfo={error => ({
                      operation: 'tool input parsing',
                      dataType: 'tool parameters',
                      rawData:
                        toolCall?.toolInputJson && toolCall.toolInputJson.length > 500
                          ? toolCall.toolInputJson.substring(0, 500) + '...'
                          : toolCall?.toolInputJson || '',
                      failureLocation: error.message.includes('JSON') ? 'JSON parsing' : 'rendering',
                    })}
                    fallback={({ transformFailure }) => (
                      <div className="text-destructive text-sm p-3 bg-destructive/5 border border-destructive/20 rounded">
                        Failed to render tool input
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs">Raw input</summary>
                          <pre className="mt-1 text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-32">
                            {transformFailure.rawData}
                          </pre>
                        </details>
                      </div>
                    )}
                  >
                    {renderToolInput(toolCall)}
                  </DataTransformErrorBoundary>
                </div>
              )}

              {/* Tool Result Section - only show if we have a result */}
              {toolResult && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Result</h3>
                  <DataTransformErrorBoundary
                    dataContext="tool result content display"
                    expectedDataType="string"
                    extractFailureInfo={error => ({
                      operation: 'tool result rendering',
                      dataType: `${toolCall?.toolName || 'unknown'} output`,
                      rawData:
                        typeof toolResult.toolResultContent === 'string'
                          ? toolResult.toolResultContent.length > 1000
                            ? toolResult.toolResultContent.substring(0, 1000) + '...'
                            : toolResult.toolResultContent
                          : String(toolResult.toolResultContent),
                      failureLocation: error.stack?.includes('AnsiText')
                        ? 'ANSI processing'
                        : 'content rendering',
                    })}
                    contextInfo={{
                      toolName: toolCall?.toolName,
                      contentType: typeof toolResult.toolResultContent,
                      hasAnsiCodes:
                        typeof toolResult.toolResultContent === 'string' &&
                        hasAnsiCodes(toolResult.toolResultContent),
                    }}
                    fallback={({ transformFailure, useFallbackData }) => (
                      <div className="text-destructive text-sm p-3 bg-destructive/5 border border-destructive/20 rounded space-y-2">
                        <div>Failed to render {toolCall?.toolName || 'tool'} result</div>
                        <button
                          className="text-xs underline hover:no-underline"
                          onClick={useFallbackData}
                        >
                          Show raw output
                        </button>
                        <details>
                          <summary className="cursor-pointer text-xs">Raw content preview</summary>
                          <pre className="mt-1 text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                            {transformFailure.rawData}
                          </pre>
                        </details>
                      </div>
                    )}
                  >
                    <pre className="font-mono text-sm whitespace-pre-wrap break-words">
                      {/* Only apply ANSI parsing to Bash tool output */}
                      {toolCall?.toolName === 'Bash' &&
                      typeof toolResult.toolResultContent === 'string' &&
                      hasAnsiCodes(toolResult.toolResultContent) ? (
                        <DataTransformErrorBoundary
                          dataContext="ANSI text processing in modal"
                          expectedDataType="string"
                          fallback={() => (
                            <span className="text-muted-foreground">
                              {toolResult.toolResultContent || 'No content'}
                            </span>
                          )}
                        >
                          <AnsiText content={toolResult.toolResultContent} />
                        </DataTransformErrorBoundary>
                      ) : (
                        toolResult.toolResultContent || 'No content'
                      )}
                    </pre>
                  </DataTransformErrorBoundary>
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
