import type { ReactNode } from 'react'
import { SubscriptionProblemBanner } from './subscription-problem-banner'

type PastDueBannerProps = {
  className?: string
  isOrgAdmin: boolean
  action?: ReactNode
  onDismiss?: () => void
}

export function PastDueBanner({ className, isOrgAdmin, action, onDismiss }: PastDueBannerProps) {
  return (
    <SubscriptionProblemBanner
      className={className}
      title="Payment overdue"
      description="Recent payment attempts failed. Update billing details to avoid blocked writes."
      isOrgAdmin={isOrgAdmin}
      action={action}
      tone="destructive"
      onDismiss={onDismiss}
    />
  )
}
