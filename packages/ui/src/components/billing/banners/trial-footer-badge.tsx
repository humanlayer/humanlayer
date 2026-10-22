import { Badge } from '@humanlayer/ui/components/badge'

type TrialFooterBadgeProps = {
  daysLeft: number
}

export function TrialFooterBadge({ daysLeft }: TrialFooterBadgeProps) {
  const clampedDays = Math.max(0, Math.floor(daysLeft))
  const label = clampedDays === 1 ? 'day' : 'days'
  const isUrgent = clampedDays === 0

  return (
    <Badge variant={isUrgent ? 'destructive' : 'secondary'}>
      Trial · {clampedDays} {label} left
    </Badge>
  )
}
