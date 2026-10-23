import { BillingSection } from '@humanlayer/ui/components/billing/billing-section'
import { ManageSubscriptionSection } from '@humanlayer/ui/components/billing/manage-subscription-section'
import { PromoCodeSection } from '@humanlayer/ui/components/billing/promo-code-section'
import type {
	BillingDiscount,
	BillingNextInvoice,
	BillingPaymentMethod,
	BillingRolloutDisplayState,
	BillingTier,
	SubscriptionStatus,
} from '@humanlayer/ui/components/billing/types'
import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { getBillingCheckoutClient } from '@/domains/billing/checkout-client'
import { getDowngradeCapacityMessage, getStarterDowngradeEligibility } from '@/domains/billing/downgrade'
import { DowngradeToStarterAction } from '@/domains/billing/DowngradeToStarterAction'
import { useBillingInfo } from '@/hooks/useBillingInfo'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useBillingVisible } from '@/lib/billing-visibility'
import { openExternal } from '@/lib/url-opener'

export type BillingTabContentPureProps =
	| { state: 'loading' }
	| { state: 'error'; error: string }
	| {
			state: 'loaded'
			children: ReactNode
			organizationId: string | null
			rolloutDisplayState: BillingRolloutDisplayState
			tier: BillingTier | null
			subscriptionStatus: SubscriptionStatus
			stripeCustomerId: string | null
			subscriptionId: string | null
			priceId: string | null
			currentPeriodEnd: number | null
			syncedAt: number | null
			activeSeatCount: number | null
			pendingInvitationCount: number | null
			freeCapacity: number | null
			discount: BillingDiscount | null
			paymentMethod: BillingPaymentMethod | null
			nextInvoice: BillingNextInvoice | null
			promoCode: string
			isApplyingPromoCode: boolean
			promoCodeErrorMessage: string | null
			onPromoCodeChange: (code: string) => void
			onApplyPromoCode: () => void
	  }

export function BillingTabContentPure(props: BillingTabContentPureProps) {
	if (props.state === 'loading') {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
				<SyncGridAnimation variant="snake" size="sm" speed={120} />
				<span>Loading billing info…</span>
			</div>
		)
	}

	if (props.state === 'error') {
		return (
			<div className="py-4">
				<p className="text-sm text-destructive">{props.error}</p>
			</div>
		)
	}

	const {
		children,
		organizationId,
		rolloutDisplayState,
		tier,
		subscriptionStatus,
		stripeCustomerId,
		subscriptionId,
		priceId,
		currentPeriodEnd,
		syncedAt,
		activeSeatCount,
		pendingInvitationCount,
		freeCapacity,
		discount,
		paymentMethod,
		nextInvoice,
		promoCode,
		isApplyingPromoCode,
		promoCodeErrorMessage,
		onPromoCodeChange,
		onApplyPromoCode,
	} = props

	return (
		<div className="space-y-6">
			<BillingSection
				organizationId={organizationId}
				rolloutDisplayState={rolloutDisplayState}
				tier={tier}
				subscriptionStatus={subscriptionStatus}
				stripeCustomerId={stripeCustomerId}
				subscriptionId={subscriptionId}
				priceId={priceId}
				currentPeriodEnd={currentPeriodEnd}
				syncedAt={syncedAt}
				activeSeatCount={activeSeatCount}
				pendingInvitationCount={pendingInvitationCount}
				freeCapacity={freeCapacity}
				discount={discount}
				paymentMethod={paymentMethod}
				nextInvoice={nextInvoice}
				promoCodeAction={
					<PromoCodeSection
						code={promoCode}
						isApplying={isApplyingPromoCode}
						discount={discount}
						errorMessage={promoCodeErrorMessage}
						onCodeChange={onPromoCodeChange}
						onApply={onApplyPromoCode}
					/>
				}
			>
				<ManageSubscriptionSection tier={tier} subscriptionStatus={subscriptionStatus}>
					{children}
					{tier === 'starter' ? (
						<Button variant="outline" asChild>
							<a href="mailto:support@humanlayer.com">Contact support</a>
						</Button>
					) : null}
				</ManageSubscriptionSection>
			</BillingSection>
		</div>
	)
}

export function BillingTabContent() {
	const billingVisible = useBillingVisible()
	const { dbOrganizationId } = useUserInfo()
	const {
		data,
		isLoading,
		error,
		isOrgAdmin,
		isUserInfoLoading,
		createCheckoutSession,
		createPortalSession,
		startUpgrade,
		downgradeToStarter,
		resyncSeats,
		applyPromotionCode,
	} = useBillingInfo({
		enabled: billingVisible,
	})
	const [promoCode, setPromoCode] = useState('')
	const origin = typeof window !== 'undefined' ? window.location.origin : ''
	const returnUrl = `${origin}/sessions`
	const checkoutClient = getBillingCheckoutClient()

	const shouldStartCheckout = useMemo(() => {
		const status = (data?.subscriptionStatus as SubscriptionStatus | null | undefined) ?? 'none'
		return status === 'none' || status === 'canceled' || data?.rolloutDisplayState === 'billing_linked'
	}, [data?.subscriptionStatus, data?.rolloutDisplayState])

	const starterDowngradeEligibility = useMemo(
		() =>
			getStarterDowngradeEligibility(
				data?.activeSeatCount ?? null,
				data?.pendingInvitationCount ?? null,
				data?.freeCapacity ?? null,
			),
		[data?.activeSeatCount, data?.pendingInvitationCount, data?.freeCapacity],
	)

	const handleStartCheckout = async () => {
		try {
			const result = await createCheckoutSession.mutateAsync({
				checkoutAttemptId: crypto.randomUUID(),
				client: checkoutClient,
			})
			await openExternal(result.url)
		} catch {
			toast.error('Unable to start checkout. Please try again.')
		}
	}

	const handleStartUpgrade = async () => {
		try {
			const result = await startUpgrade.mutateAsync({
				checkoutAttemptId: crypto.randomUUID(),
				client: checkoutClient,
			})
			await openExternal(result.url)
		} catch {
			toast.error('Unable to start upgrade. Please try again.')
		}
	}

	const handleOpenPortal = async () => {
		try {
			const result = await createPortalSession.mutateAsync({ returnUrl })
			await openExternal(result.url)
		} catch {
			toast.error('Unable to open billing portal. Please try again.')
		}
	}

	const handleResyncSeats = async () => {
		try {
			const result = await resyncSeats.mutateAsync({})
			const changeText = result.stripeQuantityChanged
				? 'Stripe quantity was updated.'
				: 'Stripe quantity was already current.'
			toast.success(
				`Seat count re-synced: ${result.seatCount} active seat${result.seatCount === 1 ? '' : 's'}. ${changeText}`,
			)
		} catch {
			toast.error('Unable to re-sync seat count. Please try again.')
		}
	}

	const handleDowngradeToStarter = async () => {
		try {
			const result = await downgradeToStarter.mutateAsync({})
			toast.success(
				`Downgraded to Starter for ${result.activeMemberCount} active member${result.activeMemberCount === 1 ? '' : 's'}.`,
			)
		} catch (error) {
			const capacityMessage = getDowngradeCapacityMessage(error)
			if (capacityMessage) {
				toast.error(capacityMessage)
				return
			}

			toast.error('Unable to downgrade to Starter. Refresh billing and try again.')
		}
	}

	const handlePromoCodeChange = (code: string) => {
		setPromoCode(code)
		if (applyPromotionCode.isError) {
			applyPromotionCode.reset()
		}
	}

	const handleApplyPromoCode = async () => {
		const code = promoCode.trim()
		if (!code) return

		try {
			await applyPromotionCode.mutateAsync({ code })
			setPromoCode('')
			toast.success('Promotion code applied.')
		} catch {}
	}

	const primaryBillingAction =
		data?.tier === 'starter' ? (
			<Button variant="outline" onClick={handleStartUpgrade} disabled={startUpgrade.isPending}>
				{startUpgrade.isPending ? 'Starting upgrade...' : 'Upgrade to Pro'}
			</Button>
		) : shouldStartCheckout ? (
			<Button variant="outline" onClick={handleStartCheckout} disabled={createCheckoutSession.isPending}>
				{createCheckoutSession.isPending ? 'Starting Checkout...' : 'Start Checkout'}
			</Button>
		) : null

	const portalAction = data?.stripeCustomerId ? (
		<Button variant="outline" onClick={handleOpenPortal} disabled={createPortalSession.isPending}>
			{createPortalSession.isPending ? 'Opening Portal...' : 'Open Billing Portal'}
		</Button>
	) : null

	const resyncSeatsAction =
		isOrgAdmin && data?.subscriptionId ? (
			<Button variant="outline" onClick={handleResyncSeats} disabled={resyncSeats.isPending}>
				{resyncSeats.isPending ? 'Re-syncing seats...' : 'Re-sync seat count'}
			</Button>
		) : null

	const downgradeToStarterAction =
		data?.tier === 'pro' ? (
			<DowngradeToStarterAction
				eligibility={starterDowngradeEligibility}
				isPending={downgradeToStarter.isPending}
				onDowngrade={handleDowngradeToStarter}
			/>
		) : null

	if (!billingVisible) {
		return null
	}

	if (!isUserInfoLoading && !isOrgAdmin) {
		return (
			<BillingTabContentPure
				state="error"
				error="Only organization admins can view and manage billing. Contact an organization admin to update subscription details."
			/>
		)
	}

	if (isLoading || isUserInfoLoading) {
		return <BillingTabContentPure state="loading" />
	}

	if (error || !data) {
		return <BillingTabContentPure state="error" error="Failed to load billing information." />
	}

	return (
		<BillingTabContentPure
			state="loaded"
			organizationId={dbOrganizationId ?? null}
			rolloutDisplayState={data.rolloutDisplayState}
			tier={data.tier ?? null}
			subscriptionStatus={(data.subscriptionStatus as SubscriptionStatus | null | undefined) ?? 'none'}
			stripeCustomerId={data.stripeCustomerId ?? null}
			subscriptionId={data.subscriptionId ?? null}
			priceId={data.priceId ?? null}
			currentPeriodEnd={data.currentPeriodEnd ?? null}
			syncedAt={data.syncedAt ?? null}
			activeSeatCount={data.activeSeatCount ?? null}
			pendingInvitationCount={data.pendingInvitationCount ?? null}
			freeCapacity={data.freeCapacity ?? null}
			discount={data.discount ?? null}
			paymentMethod={data.paymentMethod ?? null}
			nextInvoice={data.nextInvoice ?? null}
			promoCode={promoCode}
			isApplyingPromoCode={applyPromotionCode.isPending}
			promoCodeErrorMessage={null}
			onPromoCodeChange={handlePromoCodeChange}
			onApplyPromoCode={handleApplyPromoCode}
		>
			{portalAction}
			{primaryBillingAction}
			{downgradeToStarterAction}
			{resyncSeatsAction}
		</BillingTabContentPure>
	)
}
