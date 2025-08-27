import { FC, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'

interface SessionModeIndicatorProps {
  sessionId: string
  autoAcceptEdits: boolean
  dangerouslySkipPermissions: boolean
  dangerouslySkipPermissionsExpiresAt?: string
  className?: string
}

export const SessionModeIndicator: FC<SessionModeIndicatorProps> = ({
  sessionId,
  autoAcceptEdits,
  dangerouslySkipPermissions,
  dangerouslySkipPermissionsExpiresAt,
  className,
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

  // Show nothing if neither mode is active
  if (!autoAcceptEdits && !dangerouslySkipPermissions) return null

  // Dangerous skip permissions takes precedence in display
  if (dangerouslySkipPermissions) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-3 py-1.5',
          'text-sm font-medium',
          'bg-[var(--terminal-error)]/15',
          'text-[var(--terminal-error)]',
          'border border-[var(--terminal-error)]/40',
          'rounded-md',
          'animate-pulse-error',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <ShieldOff className="h-4 w-4" strokeWidth={3} />
          <span>BYPASSING PERMISSIONS</span>
          {dangerouslySkipPermissionsExpiresAt && timeRemaining && (
            <span className="font-mono text-sm">{timeRemaining}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 text-xs font-mono font-medium border border-[var(--terminal-error)]/30 rounded">
            ⌥Y
          </kbd>
          <span className="text-xs opacity-75">to disable</span>
        </div>
      </div>
    )
  }

  // Auto-accept mode display
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-1.5',
        'text-sm font-medium',
        'bg-[var(--terminal-warning)]/15',
        'text-[var(--terminal-warning)]',
        'border border-[var(--terminal-warning)]/30',
        'rounded-md',
        'animate-pulse-warning',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">⏵⏵</span>
        <span>auto-accept edits on</span>
      </div>
      <div className="flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 text-xs font-mono font-medium border border-[var(--terminal-warning)]/30 rounded">
          Shift+Tab
        </kbd>
        <span className="text-xs opacity-75">to disable</span>
      </div>
    </div>
  )
}

// Export with backward compatibility
export const AutoAcceptIndicator = SessionModeIndicator
