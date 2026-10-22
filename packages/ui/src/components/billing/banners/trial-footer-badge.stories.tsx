import type { Meta, StoryObj } from '@storybook/react-vite'
import { TrialFooterBadge } from './trial-footer-badge'

const meta = {
  title: 'Billing/Banners/TrialFooterBadge',
  component: TrialFooterBadge,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof TrialFooterBadge>

export default meta

type Story = StoryObj<typeof meta>

export const FourteenDaysLeft: Story = {
  args: {
    daysLeft: 14,
  },
}

export const OneDayLeft: Story = {
  args: {
    daysLeft: 1,
  },
}

export const ZeroDaysLeft: Story = {
  args: {
    daysLeft: 0,
  },
}
