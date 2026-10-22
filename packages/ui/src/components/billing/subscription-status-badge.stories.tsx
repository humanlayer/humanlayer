import type { Meta, StoryObj } from '@storybook/react-vite'
import { SubscriptionStatusBadge } from './subscription-status-badge'

const meta = {
  title: 'Billing/SubscriptionStatusBadge',
  component: SubscriptionStatusBadge,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof SubscriptionStatusBadge>

export default meta

type Story = StoryObj<typeof meta>

export const Trialing: Story = {
  args: { status: 'trialing' },
}

export const Active: Story = {
  args: { status: 'active' },
}

export const PastDue: Story = {
  args: { status: 'past_due' },
}

export const Canceled: Story = {
  args: { status: 'canceled' },
}

export const Unpaid: Story = {
  args: { status: 'unpaid' },
}

export const None: Story = {
  args: { status: 'none' },
}

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <SubscriptionStatusBadge status="trialing" />
      <SubscriptionStatusBadge status="active" />
      <SubscriptionStatusBadge status="past_due" />
      <SubscriptionStatusBadge status="paused" />
      <SubscriptionStatusBadge status="canceled" />
      <SubscriptionStatusBadge status="unpaid" />
      <SubscriptionStatusBadge status="none" />
    </div>
  ),
}
