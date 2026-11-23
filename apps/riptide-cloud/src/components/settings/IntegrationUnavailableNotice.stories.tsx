import type { Meta, StoryObj } from '@storybook/react-vite'

import { IntegrationUnavailableNotice } from './IntegrationUnavailableNotice'

const meta = {
	title: 'Components/Settings/IntegrationUnavailableNotice',
	component: IntegrationUnavailableNotice,
	args: { integration: 'Slack' },
} satisfies Meta<typeof IntegrationUnavailableNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Slack: Story = {}

export const GitHub: Story = { args: { integration: 'GitHub' } }

export const Jira: Story = { args: { integration: 'Jira' } }

export const Linear: Story = { args: { integration: 'Linear' } }
