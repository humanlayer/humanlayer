import type { ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@humanlayer/ui/lib/utils'

type SubscriptionProblemBannerProps = {
  className?: string
  title: string
  description: string
  isOrgAdmin: boolean
  action?: ReactNode
  tone?: 'warning' | 'destructive'
  onDismiss?: () => void
}

export function SubscriptionProblemBanner({
  className,
  title,
  description,
  isOrgAdmin,
  action,
  tone = 'warning',
  onDismiss,
}: SubscriptionProblemBannerProps) {
  const isDestructive = tone === 'destructive'

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 border-b text-sm',
        isDestructive
          ? 'bg-destructive/10 border-destructive/20 text-destructive'
          : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-500',
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium shrink-0">{title}</span>
        <span className="text-muted-foreground shrink-0">·</span>
        <span className="truncate">{isOrgAdmin ? description : 'Contact your organization admin for billing recovery.'}</span>
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
