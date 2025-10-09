import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status?: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (status === 'pending') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-warning)] text-xs uppercase tracking-wider', className)}
      >
        needs_approval
      </Badge>
    )
  }

  if (status === 'groupRunning') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-success)] text-xs uppercase tracking-wider', className)}
      >
        running
      </Badge>
    )
  }

  if (status === 'interrupted') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-error)] text-xs uppercase tracking-wider', className)}
      >
        interrupted
      </Badge>
    )
  }

  return null
}
