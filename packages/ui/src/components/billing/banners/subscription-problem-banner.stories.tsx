import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { SubscriptionProblemBanner } from './subscription-problem-banner'

const meta = {
  title: 'Billing/Banners/SubscriptionProblemBanner',
  component: SubscriptionProblemBanner,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onDismiss: () => console.log('dismiss'),
  },
} satisfies Meta<typeof SubscriptionProblemBanner>

export default meta

type Story = StoryObj<typeof meta>

const action = (
  <Button size="xs" variant="secondary">
    Update Billing
  </Button>
)

export const WarningAdmin: Story = {
  args: {
    title: 'Billing attention needed',
    description: 'Please review billing details before access is impacted.',
    isOrgAdmin: true,
    action,
    tone: 'warning',
  },
}

export const DestructiveAdmin: Story = {
  args: {
    title: 'Payment overdue',
    description: 'Recent charges failed and write access may be blocked soon.',
    isOrgAdmin: true,
    action,
    tone: 'destructive',
  },
}

export const NonAdminReadOnly: Story = {
  args: {
    title: 'Billing issue detected',
    description: 'An admin must update billing to restore full access.',
    isOrgAdmin: false,
    action,
    tone: 'warning',
  },
}
