import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmailIntegrationCard } from './EmailIntegrationCard'

const meta = {
	title: 'Components/Settings/EmailIntegrationCard',
	component: EmailIntegrationCard,
	args: { email: { configured: true, fromAddress: 'notifications@acme.com' } },
} satisfies Meta<typeof EmailIntegrationCard>

export default meta
type Story = StoryObj<typeof meta>

export const Configured: Story = {}

export const NotSetUp: Story = { args: { email: { configured: false } } }
