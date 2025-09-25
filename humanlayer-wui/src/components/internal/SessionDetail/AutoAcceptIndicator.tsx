import { FC, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ShieldOff, Info } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from '@/components/HotkeyPanel'

interface SessionModeIndicatorProps {
  sessionId: string
  autoAcceptEdits: boolean
  dangerouslySkipPermissions: boolean
  dangerouslySkipPermissionsExpiresAt?: string
  isForkMode?: boolean
  forkTurnNumber?: number
  forkTokenCount?: number | null // Keep for compatibility, but not used
  className?: string
  onToggleAutoAccept?: () => void
  onToggleBypass?: () => void
}

export const SessionModeIndicator: FC<SessionModeIndicatorProps> = ({
  sessionId,
  autoAcceptEdits,
  dangerouslySkipPermissions,
  dangerouslySkipPermissionsExpiresAt,
  isForkMode = false,
  forkTurnNumber,
  className,
  onToggleAutoAccept,
  onToggleBypass,
}) => {
  const [timeRemaining, setTimeRemaining] = useState<string>('')
  const { updateSessionOptimistic } = useStore()

  useEffect(() => {
    if (!dangerouslySkipPermissions || !dangerouslySkipPermissionsExpiresAt) return

    const updateTimer = async () => {
      const now = new Date().getTime()
      const expiry = new Date(dangerouslySkipPermissionsExpiresAt).getTime()
      const remaining = Math.max(0, expiry - now)

      if (remaining === 0) {
        // Timer expired - disable dangerous skip permissions
        try {
          await updateSessionOptimistic(sessionId, {
            dangerouslySkipPermissions: false,
            dangerouslySkipPermissionsExpiresAt: undefined,
          })

          // Show notification
          toast.info('Bypass permissions expired', {
            description: 'Manual approval required for all tools',
            duration: 5000,
          })
        } catch (error) {
          logger.error('Failed to disable expired dangerous skip permissions:', error)
        }
        return
      }

      const minutes = Math.floor(remaining / 60000)
      const seconds = Math.floor((remaining % 60000) / 1000)
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [
    dangerouslySkipPermissions,
    dangerouslySkipPermissionsExpiresAt,
    sessionId,
    updateSessionOptimistic,
  ])

  // Priority logic: fork > bypass > auto-accept
  if (!isForkMode && !dangerouslySkipPermissions && !autoAcceptEdits) {
    return null
  }

  // Fork mode takes highest priority (now displayed in ResponseInput StatusBar)
  if (isForkMode && forkTurnNumber !== undefined) {
    return null
  }

  // Bypass permissions takes second priority
  if (dangerouslySkipPermissions) {
    return (
      <button
        onClick={onToggleBypass}
        className={cn(
          'flex items-center justify-between gap-3 px-3 py-1.5 w-full',
          'text-sm font-medium',
          'bg-[var(--terminal-error)]/15',
          'text-[var(--terminal-error)]',
          'border border-[var(--terminal-error)]/40',
          'rounded-md',
          'animate-pulse-error',
          'hover:bg-[var(--terminal-error)]/25 transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-[var(--terminal-error)]/50 focus-visible:outline-none',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <ShieldOff className="h-4 w-4" strokeWidth={3} />
          <span className="uppercase tracking-wider">BYPASSING PERMISSIONS</span>
          {dangerouslySkipPermissionsExpiresAt && timeRemaining && (
            <span className="font-mono text-sm">({timeRemaining})</span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-[var(--terminal-error)]/60" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="flex items-center gap-1">
              Click or press <KeyboardShortcut keyString="⌥Y" /> to disable
            </p>
          </TooltipContent>
        </Tooltip>
      </button>
    )
  }

  // Auto-accept mode display
  return (
    <button
      onClick={onToggleAutoAccept}
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-1.5 w-full',
        'text-sm font-medium',
        'bg-[var(--terminal-warning)]/15',
        'text-[var(--terminal-warning)]',
        'border border-[var(--terminal-warning)]/30',
        'rounded-md',
        'animate-pulse-warning',
        'hover:bg-[var(--terminal-warning)]/25 transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-[var(--terminal-warning)]/50 focus-visible:outline-none',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">⏵⏵</span>
        <span>auto-accept edits on</span>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 text-[var(--terminal-warning)]/60" />
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            Click or press <KeyboardShortcut keyString="⇧+TAB" /> to disable
          </p>
        </TooltipContent>
      </Tooltip>
    </button>
  )
}

// Export with backward compatibility
export const AutoAcceptIndicator = SessionModeIndicator
