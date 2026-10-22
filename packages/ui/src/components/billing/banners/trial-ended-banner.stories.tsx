import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { TrialEndedBanner } from './trial-ended-banner'

const meta = {
  title: 'Billing/Banners/TrialEndedBanner',
  component: TrialEndedBanner,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onDismiss: () => console.log('dismiss'),
  },
} satisfies Meta<typeof TrialEndedBanner>

export default meta

type Story = StoryObj<typeof meta>

const checkoutAction = (
  <Button size="xs" variant="secondary">
    Start Checkout
  </Button>
)

export const AdminCta: Story = {
  args: {
    isOrgAdmin: true,
    action: checkoutAction,
  },
}

export const NonAdminReadOnly: Story = {
  args: {
    isOrgAdmin: false,
    action: checkoutAction,
  },
}
