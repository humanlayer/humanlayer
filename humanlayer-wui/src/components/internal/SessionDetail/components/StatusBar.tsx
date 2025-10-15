import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Session, SessionStatus } from '@/lib/daemon/types'
import { getStatusTextClass } from '@/utils/component-utils'
import { renderSessionStatus } from '@/utils/sessionStatus'
import { Pencil } from 'lucide-react'
import React, { useImperativeHandle, useState } from 'react'
import { ModelSelector } from './ModelSelector'
import { TokenUsageBadge } from './TokenUsageBadge'

export interface StatusBarRef {
  openModelSelector: () => void
}

interface StatusBarProps {
  session: Session
  effectiveContextTokens?: number
  contextLimit?: number
  model?: string
  onModelChange?: (config: {
    model?: string
    proxyEnabled: boolean
    proxyBaseUrl?: string
    proxyModelOverride?: string
    provider: 'anthropic' | 'openrouter' | 'baseten'
  }) => void
  statusOverride?: {
    text: string | React.ReactNode
    className?: string
    icon?: React.ReactNode
  }
  ref?: React.Ref<StatusBarRef>
}

export function StatusBar({
  session,
  effectiveContextTokens,
  contextLimit,
  model,
  onModelChange,
  statusOverride,
  ref,
}: StatusBarProps) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)

  const defaultStatusText = renderSessionStatus(session).toUpperCase()
  const statusText = statusOverride?.text || defaultStatusText
  const statusClassName = statusOverride?.className || getStatusTextClass(session.status)

  // Show proxy model if using OpenRouter, otherwise show provided model
  const rawModelText =
    session.proxyEnabled && session.proxyModelOverride
      ? session.proxyModelOverride
      : model || session.model || 'DEFAULT'
  // Strip provider prefix (e.g., "openai/" from "openai/gpt-oss-120b")
  const modelText = rawModelText.includes('/')
    ? rawModelText.split('/').slice(1).join('/')
    : rawModelText
  const isRunning =
    session.status === SessionStatus.Running || session.status === SessionStatus.Starting
  const isReadyForInput =
    (session.status === SessionStatus.Completed ||
      session.status === SessionStatus.Failed ||
      session.status === SessionStatus.Interrupted) &&
    !session.archived
  const isDraft = session.status === SessionStatus.Draft

  const isReadyForInputOrDraft = isReadyForInput || isDraft

  // Expose methods to parent via ref (React 19 style)
  useImperativeHandle(ref, () => ({
    openModelSelector: () => {
      if (isReadyForInputOrDraft) {
        setIsModelSelectorOpen(true)
      }
    },
  }))

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Status Badge */}
      <span
        className={`font-mono text-xs uppercase tracking-wider flex items-center gap-1.5 ${statusClassName}`}
      >
        {statusOverride?.icon}
        {statusText}
      </span>

      {/* Model Selector Badge - Linear Style */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider border-muted-foreground/20 transition-all duration-200 hover:text-current ${
                isReadyForInputOrDraft
                  ? 'hover:border-muted-foreground/40 hover:!text-primary hover:!bg-primary/10'
                  : 'cursor-not-allowed hover:bg-transparent'
              } ${isReadyForInputOrDraft ? '' : getStatusTextClass(session.status)}`}
              onClick={() => isReadyForInputOrDraft && setIsModelSelectorOpen(true)}
              onKeyDown={e => {
                if (isReadyForInputOrDraft && e.key === 'Enter') {
                  e.preventDefault()
                  setIsModelSelectorOpen(true)
                }
              }}
            >
              {modelText}
              {isReadyForInputOrDraft && (
                <Pencil className="h-3 w-3 ml-1.5 opacity-50 hover:opacity-70" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isReadyForInputOrDraft ? (
              <div className="flex items-center gap-1">
                <span className="font-medium">Click to change model</span>
                <KeyboardShortcut keyString="⇧+M" />
              </div>
            ) : isRunning ? (
              <p className="font-medium">Model changes unavailable while running</p>
            ) : (
              <p className="font-medium">Model changes available when ready for input</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Context Usage */}
      <TokenUsageBadge
        effectiveContextTokens={effectiveContextTokens}
        contextLimit={contextLimit}
        model={
          session.proxyEnabled && session.proxyModelOverride
            ? session.proxyModelOverride
            : model || session.model || 'DEFAULT'
        }
      />

      {/* Model Selector Modal */}
      <ModelSelector
        session={session}
        onModelChange={onModelChange}
        open={isModelSelectorOpen}
        onOpenChange={setIsModelSelectorOpen}
      />
    </div>
  )
}
