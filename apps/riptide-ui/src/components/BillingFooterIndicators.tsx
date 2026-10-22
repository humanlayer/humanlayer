import type { SubscriptionStatus } from '@humanlayer/ui/components/billing/types'
import { recoveryRequired } from '@humanlayer/ui/lib/billing-recovery'
import { AlertTriangle, Clock3 } from 'lucide-react'
import type { ReactNode } from 'react'

import { useBillingBannerStore } from '@/hooks/stores/billingBannerStore'
import { useBillingInfo } from '@/hooks/useBillingInfo'
import { useBillingVisible } from '@/lib/billing-visibility'

function getTrialDaysLeft(currentPeriodEnd?: number | null): number {
	if (!currentPeriodEnd) {
		return 0
	}

	const nowSeconds = Date.now() / 1000
	const remainingSeconds = currentPeriodEnd - nowSeconds
	return Math.max(0, Math.ceil(remainingSeconds / 86_400))
}

function FooterFlag({
	icon,
	label,
	tone = 'muted',
}: {
	icon?: ReactNode
	label: string
	tone?: 'muted' | 'warning' | 'danger'
}) {
	const className =
		tone === 'danger'
			? 'flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono border border-destructive/30 bg-destructive/10 text-destructive'
			: tone === 'warning'
				? 'flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono border border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-500'
				: 'flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground'

	return (
		<span className={className}>
			{icon}
			{label}
		</span>
	)
}

export function BillingFooterIndicators() {
	const billingVisible = useBillingVisible()
	const dismissedBanners = useBillingBannerStore((state) => state.dismissedBanners)
	const { data, error } = useBillingInfo({ enabled: billingVisible })

	if (!billingVisible || error || !data?.rolloutDisplayState) {
		return null
	}

	const resolvedStatus = (data.subscriptionStatus as SubscriptionStatus | null | undefined) ?? 'none'
	const trialDaysLeft = getTrialDaysLeft(data.currentPeriodEnd)
	const needsRecovery = recoveryRequired(data.rolloutDisplayState, resolvedStatus)

	return (
		<>
			{resolvedStatus === 'trialing' && dismissedBanners.has('trial') ? (
				<FooterFlag icon={<Clock3 className="w-3 h-3" />} label={`Trial ${trialDaysLeft}d`} tone="muted" />
			) : null}
			{dismissedBanners.has('trial_ended') && needsRecovery ? (
				<FooterFlag icon={<AlertTriangle className="w-3 h-3" />} label="Checkout Required" tone="danger" />
			) : null}
			{resolvedStatus === 'past_due' && dismissedBanners.has('past_due') ? (
				<FooterFlag icon={<AlertTriangle className="w-3 h-3" />} label="Past Due" tone="warning" />
			) : null}
			{resolvedStatus === 'unpaid' && dismissedBanners.has('unpaid') ? (
				<FooterFlag icon={<AlertTriangle className="w-3 h-3" />} label="Unpaid" tone="danger" />
			) : null}
		</>
	)
}
