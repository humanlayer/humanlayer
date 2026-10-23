import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { PastDueBanner } from './past-due-banner'

const meta = {
  title: 'Billing/Banners/PastDueBanner',
  component: PastDueBanner,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onDismiss: () => console.log('dismiss'),
  },
} satisfies Meta<typeof PastDueBanner>

export default meta

type Story = StoryObj<typeof meta>

const portalAction = (
  <Button size="xs" variant="secondary">
    Update Payment
  </Button>
)

export const AdminCta: Story = {
  args: {
    isOrgAdmin: true,
    action: portalAction,
  },
}

export const NonAdminReadOnly: Story = {
  args: {
    isOrgAdmin: false,
    action: portalAction,
  },
}
