import type { Meta, StoryObj } from '@storybook/react'
import type { ArtifactInfoInaccessible } from '../RequestAccessScreen'
import { RequestPendingScreenView } from '../RequestPendingScreen'

const lookup: ArtifactInfoInaccessible = {
	exists: true,
	accessible: false,
	organizationName: 'Acme Corp',
	domain: null,
	myRequestStatus: 'pending',
	lastRequestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
}

const meta = {
	title: 'Components/RequestPendingScreen',
	component: RequestPendingScreenView,
} satisfies Meta<typeof RequestPendingScreenView>

export default meta
type Story = StoryObj<typeof meta>

export const LoggedIn: Story = {
	args: {
		lookup,
		variant: 'logged-in',
		email: 'alice@example.com',
		onRequestAgain: () => undefined,
	},
}

export const Anonymous: Story = {
	args: {
		lookup,
		variant: 'anonymous',
		email: 'alice@example.com',
	},
}
