import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { ManageSubscriptionSection } from './manage-subscription-section'

const meta = {
  title: 'Billing/ManageSubscriptionSection',
  component: ManageSubscriptionSection,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[520px] rounded border border-border p-4 bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ManageSubscriptionSection>

export default meta

type Story = StoryObj<typeof meta>

const portalButton = (
  <Button size="sm" variant="secondary">
    Open Portal
  </Button>
)

const checkoutButton = (
  <Button size="sm" variant="secondary">
    Upgrade to Pro
  </Button>
)

const supportButton = (
  <Button size="sm" variant="outline" asChild>
    <a href="mailto:support@humanlayer.com">Contact support</a>
  </Button>
)

const resyncButton = (
  <Button size="sm" variant="secondary">
    Re-sync seat count
  </Button>
)

export const ActiveAdmin: Story = {
  args: {
    isOrgAdmin: true,
    subscriptionStatus: 'active',
    portalAction: portalButton,
    resyncSeatsAction: resyncButton,
  },
}

export const StarterAdmin: Story = {
  args: {
    isOrgAdmin: true,
    tier: 'starter',
    subscriptionStatus: 'active',
    startCheckoutAction: checkoutButton,
    contactSupportAction: supportButton,
    resyncSeatsAction: resyncButton,
  },
}

export const StarterUpgradeRequired: Story = {
  args: {
    isOrgAdmin: true,
    tier: 'starter',
    subscriptionStatus: 'active',
    startCheckoutAction: checkoutButton,
    contactSupportAction: supportButton,
  },
}

export const CanceledRecoveryAdmin: Story = {
  args: {
    isOrgAdmin: true,
    subscriptionStatus: 'canceled',
    portalAction: portalButton,
    startCheckoutAction: checkoutButton,
    resyncSeatsAction: resyncButton,
  },
}

export const PastDueAdmin: Story = {
  args: {
    isOrgAdmin: true,
    subscriptionStatus: 'past_due',
    portalAction: portalButton,
    resyncSeatsAction: resyncButton,
  },
}

export const NonAdminReadOnly: Story = {
  args: {
    isOrgAdmin: false,
    subscriptionStatus: 'none',
  },
}
