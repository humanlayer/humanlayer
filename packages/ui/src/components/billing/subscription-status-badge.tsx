import { Badge } from '@humanlayer/ui/components/badge'
import type { SubscriptionStatus } from './types'

type SubscriptionStatusBadgeProps = {
  status: SubscriptionStatus
}

const STATUS_VARIANTS: Record<SubscriptionStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  trialing: 'secondary',
  active: 'default',
  past_due: 'destructive',
  paused: 'outline',
  canceled: 'outline',
  unpaid: 'destructive',
  none: 'outline',
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past Due',
  paused: 'Paused',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  none: 'None',
}

export function SubscriptionStatusBadge({ status }: SubscriptionStatusBadgeProps) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
}
