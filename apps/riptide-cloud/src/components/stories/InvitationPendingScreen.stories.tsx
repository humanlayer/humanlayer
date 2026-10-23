import type { Meta, StoryObj } from '@storybook/react'
import { InvitationPendingScreen } from '../InvitationPendingScreen'
import type { ArtifactInfoInaccessible } from '../RequestAccessScreen'

const lookup: ArtifactInfoInaccessible = {
	exists: true,
	accessible: false,
	organizationName: 'Vector Works',
	domain: null,
	myRequestStatus: 'invited',
	lastRequestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
}

const meta = {
	title: 'Components/InvitationPendingScreen',
	component: InvitationPendingScreen,
} satisfies Meta<typeof InvitationPendingScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: { lookup },
}
