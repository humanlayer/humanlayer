import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Session } from '@/lib/daemon/types'
import { Button } from '@/components/ui/button'
import { TokenUsageBadge } from './TokenUsageBadge'
import { ModelSelector } from './ModelSelector'
import { renderSessionStatus } from '@/utils/sessionStatus'
import { getStatusTextClass } from '@/utils/component-utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AdditionalDirectoriesDropdown } from './AdditionalDirectoriesDropdown'

interface StatusBarProps {
  session: Session
  parentSessionData?: Partial<Session>
  onModelChange?: () => void
  onDirectoriesChange?: (directories: string[]) => void
}

export function StatusBar({ session, parentSessionData, onModelChange, onDirectoriesChange }: StatusBarProps) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)

  const statusText = renderSessionStatus(session).toUpperCase()
  // Show proxy model if using OpenRouter, otherwise show regular model
  const rawModelText =
    session.proxyEnabled && session.proxyModelOverride
      ? session.proxyModelOverride
      : session.model || 'DEFAULT'
  // Strip provider prefix (e.g., "openai/" from "openai/gpt-oss-120b")
  const modelText = rawModelText.includes('/')
    ? rawModelText.split('/').slice(1).join('/')
    : rawModelText
  const isRunning = session.status === 'running' || session.status === 'starting'
  const isReadyForInput = session.status === 'completed' && !session.archived

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Status Badge */}
      <span
        className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
      >
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
                isReadyForInput
                  ? 'hover:border-muted-foreground/40 hover:!text-primary hover:!bg-primary/10'
                  : 'cursor-not-allowed hover:bg-transparent'
              } ${isReadyForInput ? '' : getStatusTextClass(session.status)}`}
              onClick={() => isReadyForInput && setIsModelSelectorOpen(true)}
            >
              {modelText}
              {isReadyForInput && <Pencil className="h-3 w-3 ml-1.5 opacity-50 hover:opacity-70" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isReadyForInput ? (
              <p className="font-medium">Click to change model</p>
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
        effectiveContextTokens={
          session.effectiveContextTokens ?? parentSessionData?.effectiveContextTokens
        }
        contextLimit={session.contextLimit ?? parentSessionData?.contextLimit}
        model={
          session.proxyEnabled && session.proxyModelOverride
            ? session.proxyModelOverride
            : (session.model ?? parentSessionData?.model)
        }
      />

      {/* Directory Display */}
      {session.workingDir && (
        <AdditionalDirectoriesDropdown 
          workingDir={session.workingDir}
          directories={session.additionalDirectories || []}
          sessionStatus={session.status}
          onDirectoriesChange={onDirectoriesChange}
        />
      )}

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
