import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
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

function RequestAgainDemo() {
	const [retryAfter, setRetryAfter] = useState<string | null>(null)
	return (
		<RequestPendingScreenView
			lookup={lookup}
			variant="logged-in"
			email="alice@example.com"
			retryAfter={retryAfter}
			onRequestAgain={() => setRetryAfter(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
		/>
	)
}

const meta = {
	title: 'Shell Demos/RequestPendingScreen',
	component: RequestAgainDemo,
} satisfies Meta<typeof RequestAgainDemo>

export default meta
type Story = StoryObj<typeof meta>

export const RequestAgainRateLimit: Story = {}
