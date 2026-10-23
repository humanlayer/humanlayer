import { PastDueBanner } from '@humanlayer/ui/components/billing/banners/past-due-banner'
import { SubscriptionProblemBanner } from '@humanlayer/ui/components/billing/banners/subscription-problem-banner'
import { TrialBannerTransient } from '@humanlayer/ui/components/billing/banners/trial-banner-transient'
import { TrialEndedBanner } from '@humanlayer/ui/components/billing/banners/trial-ended-banner'
import type { SubscriptionStatus } from '@humanlayer/ui/components/billing/types'
import { Button } from '@humanlayer/ui/components/button'
import { recoveryRequired } from '@humanlayer/ui/lib/billing-recovery'
import { toast } from 'sonner'

import type { BillingBannerType } from '@/hooks/stores/billingBannerStore'
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

export function BillingBannerRail() {
	const billingVisible = useBillingVisible()
	const dismissedBanners = useBillingBannerStore((state) => state.dismissedBanners)
	const dismissBanner = useBillingBannerStore((state) => state.dismiss)
	const { data, error, isOrgAdmin, isUserInfoLoading, createCheckoutSession, createPortalSession } = useBillingInfo({
		enabled: billingVisible,
	})

	if (!billingVisible || error || isUserInfoLoading || !data?.rolloutDisplayState) {
		return null
	}

	const origin = typeof window !== 'undefined' ? window.location.origin : ''
	const returnUrl = `${origin}/settings`
	const resolvedStatus = (data.subscriptionStatus as SubscriptionStatus | null | undefined) ?? 'none'
	const trialDaysLeft = getTrialDaysLeft(data.currentPeriodEnd)
	const needsRecovery = recoveryRequired(data.rolloutDisplayState, resolvedStatus)

	const handleStartCheckout = async () => {
		try {
			const result = await createCheckoutSession.mutateAsync({
				checkoutAttemptId: crypto.randomUUID(),
				client: 'cloud',
			})
			window.open(result.url, '_blank', 'noopener,noreferrer')
		} catch {
			toast.error('Unable to start checkout. Please try again.')
		}
	}

	const handleOpenPortal = async () => {
		try {
			const result = await createPortalSession.mutateAsync({ returnUrl })
			window.open(result.url, '_blank', 'noopener,noreferrer')
		} catch {
			toast.error('Unable to open billing portal. Please try again.')
		}
	}

	const recoveryCheckoutAction =
		isOrgAdmin && needsRecovery ? (
			<Button
				size="xs"
				variant="secondary"
				onClick={handleStartCheckout}
				disabled={createCheckoutSession.isPending}
			>
				{createCheckoutSession.isPending ? 'Starting Checkout...' : 'Start Checkout'}
			</Button>
		) : null

	const portalAction = isOrgAdmin ? (
		<Button size="xs" variant="secondary" onClick={handleOpenPortal} disabled={createPortalSession.isPending}>
			{createPortalSession.isPending ? 'Opening Portal...' : 'Open Billing Portal'}
		</Button>
	) : null

	const showTrialBanner = resolvedStatus === 'trialing' && !dismissedBanners.has('trial')
	const showPastDueBanner = resolvedStatus === 'past_due' && !dismissedBanners.has('past_due')
	const showUnpaidBanner = resolvedStatus === 'unpaid' && !dismissedBanners.has('unpaid')
	const showRecoveryBanner = needsRecovery && !dismissedBanners.has('trial_ended')

	const handleDismiss = (banner: BillingBannerType) => dismissBanner(banner)

	if (!showTrialBanner && !showPastDueBanner && !showUnpaidBanner && !showRecoveryBanner) {
		return null
	}

	return (
		<>
			{showTrialBanner ? (
				<TrialBannerTransient
					daysLeft={trialDaysLeft}
					isOrgAdmin={isOrgAdmin}
					action={portalAction}
					onDismiss={() => handleDismiss('trial')}
				/>
			) : null}
			{showPastDueBanner ? (
				<PastDueBanner
					isOrgAdmin={isOrgAdmin}
					action={portalAction}
					onDismiss={() => handleDismiss('past_due')}
				/>
			) : null}
			{showUnpaidBanner ? (
				<SubscriptionProblemBanner
					title="Subscription unpaid"
					description="Billing is unresolved. Update billing details to restore full access."
					isOrgAdmin={isOrgAdmin}
					action={portalAction}
					tone="destructive"
					onDismiss={() => handleDismiss('unpaid')}
				/>
			) : null}
			{showRecoveryBanner ? (
				<TrialEndedBanner
					isOrgAdmin={isOrgAdmin}
					action={recoveryCheckoutAction}
					onDismiss={() => handleDismiss('trial_ended')}
				/>
			) : null}
		</>
	)
}
