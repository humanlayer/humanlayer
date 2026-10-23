import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { TrialBannerTransient } from './trial-banner-transient'

const meta = {
  title: 'Billing/Banners/TrialBannerTransient',
  component: TrialBannerTransient,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onDismiss: () => console.log('dismiss'),
  },
} satisfies Meta<typeof TrialBannerTransient>

export default meta

type Story = StoryObj<typeof meta>

const action = (
  <Button size="xs" variant="secondary">
    Add Payment Method
  </Button>
)

export const AdminView: Story = {
  args: {
    daysLeft: 9,
    isOrgAdmin: true,
    action,
  },
}

export const NonAdminView: Story = {
  args: {
    daysLeft: 9,
    isOrgAdmin: false,
    action,
  },
}
