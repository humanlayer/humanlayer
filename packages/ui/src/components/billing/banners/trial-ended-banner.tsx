import type { ReactNode } from 'react'
import { SubscriptionProblemBanner } from './subscription-problem-banner'

type TrialEndedBannerProps = {
  className?: string
  isOrgAdmin: boolean
  action?: ReactNode
  onDismiss?: () => void
}

export function TrialEndedBanner({ className, isOrgAdmin, action, onDismiss }: TrialEndedBannerProps) {
  return (
    <SubscriptionProblemBanner
      className={className}
      title="Trial ended"
      description="Your organization needs billing setup to continue full access."
      isOrgAdmin={isOrgAdmin}
      action={action}
      tone="destructive"
      onDismiss={onDismiss}
    />
  )
}
