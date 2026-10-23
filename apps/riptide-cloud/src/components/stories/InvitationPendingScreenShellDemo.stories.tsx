import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { InvitationPendingScreen } from '../InvitationPendingScreen'
import type { ArtifactInfoInaccessible } from '../RequestAccessScreen'
import { RequestPendingScreenView } from '../RequestPendingScreen'

const pendingLookup: ArtifactInfoInaccessible = {
	exists: true,
	accessible: false,
	organizationName: 'Vector Works',
	domain: null,
	myRequestStatus: 'pending',
	lastRequestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
}

const invitedLookup: ArtifactInfoInaccessible = {
	...pendingLookup,
	myRequestStatus: 'invited',
}

function PendingToInvitedDemo() {
	const [invited, setInvited] = useState(false)
	if (invited) return <InvitationPendingScreen lookup={invitedLookup} />
	return <RequestPendingScreenView lookup={pendingLookup} variant="logged-in" onRequestAgain={() => setInvited(true)} />
}

const meta = {
	title: 'Shell Demos/InvitationPendingScreen',
	component: PendingToInvitedDemo,
} satisfies Meta<typeof PendingToInvitedDemo>

export default meta
type Story = StoryObj<typeof meta>

export const PendingToInvited: Story = {}
