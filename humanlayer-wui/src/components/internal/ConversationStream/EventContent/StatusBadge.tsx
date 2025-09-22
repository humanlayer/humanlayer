import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  approvalStatus?: string
  isCompleted?: boolean
  className?: string
}

export function StatusBadge({ approvalStatus, isCompleted, className }: StatusBadgeProps) {
  if (approvalStatus === 'pending') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-warning)] text-xs uppercase tracking-wider', className)}
      >
        Pending
      </Badge>
    )
  }

  if (approvalStatus === 'denied') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-error)] text-xs uppercase tracking-wider', className)}
      >
        Denied
      </Badge>
    )
  }

  if (isCompleted) {
    return (
      <Badge variant="secondary" className={cn('text-xs uppercase tracking-wider', className)}>
        Completed
      </Badge>
    )
  }

  if (approvalStatus === 'approved' && !isCompleted) {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-success)] text-xs uppercase tracking-wider', className)}
      >
        Running
      </Badge>
    )
  }

  return null
}
