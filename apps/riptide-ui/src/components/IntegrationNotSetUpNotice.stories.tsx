import type { Meta, StoryObj } from '@storybook/react-vite'

import { IntegrationNotSetUpNotice } from './IntegrationNotSetUpNotice'

const meta = {
	title: 'Components/IntegrationNotSetUpNotice',
	component: IntegrationNotSetUpNotice,
	parameters: { layout: 'centered' },
	decorators: [
		(Story) => (
			<div className="w-[420px] max-w-full p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof IntegrationNotSetUpNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Jira: Story = { args: { name: 'Jira' } }

export const Linear: Story = { args: { name: 'Linear' } }

export const GitHub: Story = { args: { name: 'GitHub' } }
