import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { BillingSection } from './billing-section'
import { ManageSubscriptionSection } from './manage-subscription-section'

const nowSeconds = Math.floor(Date.now() / 1000)

const meta = {
  title: 'Billing/BillingSection',
  component: BillingSection,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof BillingSection>

export default meta

type Story = StoryObj<typeof meta>

export const Trialing: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'pro',
    subscriptionStatus: 'trialing',
    stripeCustomerId: 'cus_trialing_123',
    subscriptionId: 'sub_trialing_123',
    priceId: 'price_pro_monthly',
    currentPeriodEnd: nowSeconds + 10 * 24 * 60 * 60,
    syncedAt: Date.now(),
  },
}

export const Active: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'pro',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_active_123',
    subscriptionId: 'sub_active_123',
    priceId: 'price_pro_monthly',
    currentPeriodEnd: nowSeconds + 28 * 24 * 60 * 60,
    syncedAt: Date.now(),
  },
}

export const StarterBelowCapacity: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'starter',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_starter_below_123',
    subscriptionId: 'sub_starter_below_123',
    priceId: 'price_starter_monthly',
    currentPeriodEnd: nowSeconds + 28 * 24 * 60 * 60,
    syncedAt: Date.now(),
    activeSeatCount: 1,
    pendingInvitationCount: 1,
    freeCapacity: 3,
    nextInvoice: { amountDue: 0, currency: 'usd' },
  },
}

export const StarterAtCapacity: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'starter',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_starter_full_123',
    subscriptionId: 'sub_starter_full_123',
    priceId: 'price_starter_monthly',
    currentPeriodEnd: nowSeconds + 28 * 24 * 60 * 60,
    syncedAt: Date.now(),
    activeSeatCount: 2,
    pendingInvitationCount: 1,
    freeCapacity: 3,
    nextInvoice: { amountDue: 0, currency: 'usd' },
  },
}

export const ProActive: Story = {
	args: {
		rolloutDisplayState: 'billing_enrolled',
    tier: 'pro',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_pro_123',
    subscriptionId: 'sub_pro_123',
    priceId: 'price_pro_monthly',
    currentPeriodEnd: nowSeconds + 28 * 24 * 60 * 60,
    syncedAt: Date.now(),
    activeSeatCount: 4,
    nextInvoice: { amountDue: 40000, currency: 'usd' },
	},
}

export const ProDowngradeEligible: Story = {
	args: {
		rolloutDisplayState: 'billing_enrolled',
		tier: 'pro',
		subscriptionStatus: 'active',
		stripeCustomerId: 'cus_pro_downgrade_eligible_123',
		subscriptionId: 'sub_pro_downgrade_eligible_123',
		priceId: 'price_pro_monthly',
		currentPeriodEnd: nowSeconds + 18 * 24 * 60 * 60,
		syncedAt: Date.now(),
		activeSeatCount: 2,
		pendingInvitationCount: 1,
		freeCapacity: 3,
		nextInvoice: { amountDue: 20000, currency: 'usd' },
	},
	render: (args) => (
		<BillingSection {...args}>
			<ManageSubscriptionSection
				isOrgAdmin
				tier="pro"
				subscriptionStatus="active"
				portalAction={
					<Button size="sm" variant="secondary">
						Open Billing Portal
					</Button>
				}
				downgradeToStarterAction={
					<Button size="sm" variant="outline">
						Downgrade to Starter
					</Button>
				}
			/>
		</BillingSection>
	),
}

export const ProDowngradeOverCapacity: Story = {
	args: {
		rolloutDisplayState: 'billing_enrolled',
		tier: 'pro',
		subscriptionStatus: 'active',
		stripeCustomerId: 'cus_pro_downgrade_disabled_123',
		subscriptionId: 'sub_pro_downgrade_disabled_123',
		priceId: 'price_pro_monthly',
		currentPeriodEnd: nowSeconds + 18 * 24 * 60 * 60,
		syncedAt: Date.now(),
		activeSeatCount: 3,
		pendingInvitationCount: 1,
		freeCapacity: 3,
		nextInvoice: { amountDue: 30000, currency: 'usd' },
	},
	render: (args) => (
		<BillingSection {...args}>
			<ManageSubscriptionSection
				isOrgAdmin
				tier="pro"
				subscriptionStatus="active"
				portalAction={
					<Button size="sm" variant="secondary">
						Open Billing Portal
					</Button>
				}
				downgradeToStarterAction={
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="inline-flex cursor-not-allowed" tabIndex={0}>
								<Button size="sm" variant="outline" disabled>
									Downgrade to Starter
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent className="max-w-80" side="top" align="start">
							Starter supports up to 3 active members plus pending invitations. This organization has 3
							active members and 1 pending invitation.
						</TooltipContent>
					</Tooltip>
				}
			/>
		</BillingSection>
	),
}

export const EnterpriseActive: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'enterprise',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_enterprise_123',
    subscriptionId: 'sub_enterprise_123',
    priceId: 'price_enterprise_monthly',
    currentPeriodEnd: nowSeconds + 28 * 24 * 60 * 60,
    syncedAt: Date.now(),
    activeSeatCount: 24,
  },
}

export const PastDue: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'pro',
    subscriptionStatus: 'past_due',
    stripeCustomerId: 'cus_past_due_123',
    subscriptionId: 'sub_past_due_123',
    priceId: 'price_pro_monthly',
    currentPeriodEnd: nowSeconds - 3 * 24 * 60 * 60,
    syncedAt: Date.now(),
  },
}

export const LinkedNoSubscription: Story = {
  args: {
    rolloutDisplayState: 'billing_linked',
    tier: null,
    subscriptionStatus: 'none',
    stripeCustomerId: 'cus_linked_123',
    subscriptionId: null,
    priceId: null,
    currentPeriodEnd: null,
    syncedAt: Date.now(),
  },
}

export const WithContentSlots: Story = {
  args: {
    rolloutDisplayState: 'billing_enrolled',
    tier: 'pro',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_with_slots_123',
    subscriptionId: 'sub_with_slots_123',
    priceId: 'price_pro_monthly',
    currentPeriodEnd: nowSeconds + 20 * 24 * 60 * 60,
    syncedAt: Date.now(),
  },
  render: (args) => (
    <BillingSection {...args}>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Action slots are rendered by app-specific wrappers.</p>
        <Button size="sm" variant="outline" disabled>
          Placeholder Action
        </Button>
      </div>
    </BillingSection>
  ),
}
