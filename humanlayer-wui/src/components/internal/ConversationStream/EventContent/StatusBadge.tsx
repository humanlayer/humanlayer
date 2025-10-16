import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status?: string
  className?: string
}

const statusConfig = {
  pending: {
    label: 'needs_approval',
    colorClass: 'text-[var(--terminal-warning)]',
  },
  groupRunning: {
    label: 'running',
    colorClass: 'text-[var(--terminal-success)]',
  },
  interrupted: {
    label: 'interrupted',
    colorClass: 'text-[var(--terminal-error)]',
  },
} as const

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (!status || !(status in statusConfig)) {
    return null
  }

  const config = statusConfig[status as keyof typeof statusConfig]

  return (
    <Badge
      variant="secondary"
      className={cn('text-xs uppercase tracking-wider', config.colorClass, className)}
    >
      {config.label}
    </Badge>
  )
}
