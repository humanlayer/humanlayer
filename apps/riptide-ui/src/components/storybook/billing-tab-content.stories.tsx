import { Button } from '@humanlayer/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'

import {
	BillingTabContentPure,
	type BillingTabContentPureProps,
} from '@/components/settings/BillingTabContent'

const nowSeconds = Math.floor(Date.now() / 1000)
const noop = () => {}

const loadedArgs = {
	state: 'loaded',
	children: <Button variant="outline">Manage subscription</Button>,
	organizationId: 'org_example',
	rolloutDisplayState: 'billing_enrolled',
	tier: 'pro',
	subscriptionStatus: 'active',
	stripeCustomerId: 'cus_example',
	subscriptionId: 'sub_example',
	priceId: 'price_pro_monthly',
	currentPeriodEnd: nowSeconds + 30 * 24 * 60 * 60,
	syncedAt: Date.now(),
	activeSeatCount: 3,
	pendingInvitationCount: 1,
	freeCapacity: 5,
	discount: null,
	paymentMethod: null,
	nextInvoice: null,
	promoCode: '',
	isApplyingPromoCode: false,
	promoCodeErrorMessage: null,
	onPromoCodeChange: noop,
	onApplyPromoCode: noop,
} satisfies Extract<BillingTabContentPureProps, { state: 'loaded' }>

const meta = {
	title: 'Settings/BillingTabContent',
	component: BillingTabContentPure,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof BillingTabContentPure>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { args: { state: 'loading' } }

export const Error: Story = {
	args: { state: 'error', error: 'Failed to load billing information.' },
}

export const NotLinked: Story = {
	args: {
		...loadedArgs,
		rolloutDisplayState: 'not_linked',
		tier: null,
		subscriptionStatus: 'none',
		stripeCustomerId: null,
		subscriptionId: null,
		priceId: null,
		currentPeriodEnd: null,
		syncedAt: null,
	},
}

export const BillingLinkedRecovery: Story = {
	args: {
		...loadedArgs,
		rolloutDisplayState: 'billing_linked',
		tier: null,
		subscriptionStatus: 'none',
		subscriptionId: null,
		priceId: null,
		currentPeriodEnd: null,
	},
}

export const EnrolledProTrialing: Story = {
	args: { ...loadedArgs, subscriptionStatus: 'trialing', currentPeriodEnd: nowSeconds + 14 * 24 * 60 * 60 },
}

export const EnrolledProActive: Story = { args: loadedArgs }

export const EnrolledCanceledRecovery: Story = {
	args: {
		...loadedArgs,
		subscriptionStatus: 'canceled',
		subscriptionId: null,
		priceId: null,
		currentPeriodEnd: null,
	},
}

export const EnrolledPastDue: Story = {
	args: { ...loadedArgs, subscriptionStatus: 'past_due', currentPeriodEnd: nowSeconds - 2 * 24 * 60 * 60 },
}

export const EnrolledUnpaid: Story = {
	args: { ...loadedArgs, subscriptionStatus: 'unpaid', currentPeriodEnd: nowSeconds - 5 * 24 * 60 * 60 },
}
