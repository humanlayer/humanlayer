import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  approvalStatus?: string
  isCompleted?: boolean
  className?: string
}

export function StatusBadge({ approvalStatus, className }: StatusBadgeProps) {
  if (approvalStatus === 'pending') {
    return (
      <Badge
        variant="secondary"
        className={cn('text-[var(--terminal-warning)] text-xs uppercase tracking-wider', className)}
      >
        needs_approval
      </Badge>
    )
  }

  return null
}
