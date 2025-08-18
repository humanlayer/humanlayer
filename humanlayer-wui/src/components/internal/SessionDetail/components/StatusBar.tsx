import { useState } from 'react'
import { Edit2 } from 'lucide-react'
import { Session } from '@/lib/daemon/types'
import { Button } from '@/components/ui/button'
import { TokenUsageBadge } from './TokenUsageBadge'
import { ModelSelector } from './ModelSelector'
import { renderSessionStatus } from '@/utils/sessionStatus'
import { getStatusTextClass } from '@/utils/component-utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface StatusBarProps {
  session: Session
  parentSessionData?: Partial<Session>
  onModelChange?: () => void
}

export function StatusBar({ session, parentSessionData, onModelChange }: StatusBarProps) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  
  const statusText = renderSessionStatus(session).toUpperCase()
  const modelText = session.model || 'DEFAULT'
  const isRunning = session.status === 'running' || session.status === 'starting'
  
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* Status Badge */}
      <span className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}>
        {statusText}
      </span>
      
      {/* Model Selector Badge - Linear Style */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30 transition-all duration-200"
              onClick={() => setIsModelSelectorOpen(true)}
            >
              {modelText}
              <Edit2 className="h-3 w-3 ml-1.5 opacity-50 hover:opacity-70" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Click to change model</p>
            {!isRunning && (
              <p className="text-xs text-muted-foreground mt-1">
                Changes take effect on next message
              </p>
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
        model={session.model ?? parentSessionData?.model}
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