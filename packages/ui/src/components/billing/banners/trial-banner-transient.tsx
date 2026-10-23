import type { ReactNode } from 'react'
import { Clock, X } from 'lucide-react'
import { cn } from '@humanlayer/ui/lib/utils'

type TrialBannerTransientProps = {
  className?: string
  daysLeft: number
  isOrgAdmin: boolean
  action?: ReactNode
  onDismiss?: () => void
}

export function TrialBannerTransient({ className, daysLeft, isOrgAdmin, action, onDismiss }: TrialBannerTransientProps) {
  const clampedDays = Math.max(0, Math.floor(daysLeft))
  const dayLabel = clampedDays === 1 ? 'day' : 'days'
  const nonAdminMessage = 'Contact your organization admin to manage billing before trial end.'

  return (
    <div
      role="alert"
      className={cn('flex items-center justify-between gap-3 px-4 py-2 bg-muted/50 border-b border-border text-sm', className)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium shrink-0">Trial in progress</span>
        <span className="text-muted-foreground shrink-0">·</span>
        <span className="truncate">
          {isOrgAdmin
            ? `Your organization has ${clampedDays} ${dayLabel} left in trial.`
            : nonAdminMessage}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isOrgAdmin && action}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
