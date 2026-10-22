import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '@humanlayer/ui/components/button'
import { expect, userEvent, within } from '@storybook/test'
import { Menu } from 'lucide-react'

import { MobileBreadcrumb } from './MobileBreadcrumb'

const meta: Meta<typeof MobileBreadcrumb> = {
	title: 'Mobile/MobileBreadcrumb',
	component: MobileBreadcrumb,
	parameters: {
		layout: 'fullscreen',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileBreadcrumb>

export const WithHamburger: Story = {
	args: {
		title: 'Session: Fix auth bug',
		details: [
			{ label: 'Host', value: 'dex-macbook (a1b2c3)' },
			{
				label: 'Directory',
				value: '/Users/dex/.humanlayer/workspaces/improve-mobile-ui/syncopate',
				mono: true,
			},
		],
		showBackButton: true,
		onBack: () => {},
		rightElement: (
			<Button variant="ghost" size="icon" className="size-11" aria-label="Open artifacts">
				<Menu className="h-5 w-5" />
			</Button>
		),
	},
}

export const LongTitle: Story = {
	args: {
		title: 'This is a very long task name that should be truncated because it exceeds the available space in the breadcrumb header',
		details: [
			{ label: 'Host', value: 'dex-macbook (a1b2c3)' },
			{
				label: 'Directory',
				value: '/Users/dex/.humanlayer/workspaces/improve-mobile-ui/syncopate',
				mono: true,
			},
		],
		showBackButton: true,
		onBack: () => {},
	},
}

export const OfflineHost: Story = {
	args: {
		title: 'Resume blocked migration',
		isHostOffline: true,
		details: [
			{ label: 'Host', value: 'build-host (f4e5d6)' },
			{ label: 'Directory', value: '/Users/dex/projects/customer-platform/apps/riptide-ui', mono: true },
		],
		showBackButton: true,
		onBack: () => {},
	},
}

export const ExpandedDetails: Story = {
	args: {
		title: 'Implement compact mobile header',
		details: [
			{ label: 'Host', value: 'dexs-macbook' },
			{
				label: 'Directory',
				value: '/Users/dex/code/customer-platform/apps/riptide-ui/src/mobile/components/pure',
				mono: true,
			},
			{ label: 'Ticket', value: 'ENG-1234' },
		],
		showBackButton: true,
		onBack: () => {},
	},
	// The expanded panel is uncontrolled internal state in live code, so reach it the
	// same way a user does: tap the title to toggle the details open.
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const toggle = canvas.getByRole('button', { expanded: false })
		await userEvent.click(toggle)
		await expect(canvas.getByText('Ticket')).toBeInTheDocument()
	},
}
