import type { ReactNode } from 'react'
import type { BillingTier, SubscriptionStatus } from './types'

type ManageSubscriptionSectionProps = {
	subscriptionStatus: SubscriptionStatus
	tier: BillingTier | null
	children: ReactNode
}

function statusGuidance(status: SubscriptionStatus): string {
  switch (status) {
    case 'trialing':
      return 'Your trial is active. Open the billing portal to manage payment methods before trial end.'
    case 'active':
      return 'Your subscription is active and can be managed from the customer portal.'
    case 'past_due':
      return 'Payment is overdue. Open the billing portal to restore healthy status.'
    case 'unpaid':
      return 'Subscription is unpaid. Open the billing portal to recover access.'
    case 'canceled':
      return 'Subscription is canceled. Start checkout to create a new subscription.'
    case 'paused':
      return 'Subscription is paused. Open the billing portal to resume service.'
    case 'none':
      return 'No subscription is active yet. Start checkout to enroll billing.'
  }
}

export function ManageSubscriptionSection({
	subscriptionStatus,
	tier,
	children,
}: ManageSubscriptionSectionProps) {
	const guidance =
		tier === 'starter'
			? 'Your team is on Starter. Upgrade to Pro when you are ready to add a fourth active member; Stripe will show the exact charge before payment.'
			: statusGuidance(subscriptionStatus)

	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-sm font-medium">Manage Subscription</h3>
				<p className="text-sm text-muted-foreground">{guidance}</p>
			</div>

			<div className="flex flex-wrap gap-2">{children}</div>
		</section>
  )
}
