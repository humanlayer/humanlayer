import { Button } from '@humanlayer/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { RequestAccessAnonymous } from '../RequestAccessAnonymous'
import { RequestAccessLoggedIn } from '../RequestAccessLoggedIn'
import type { ArtifactInfoInaccessible } from '../RequestAccessScreen'
import { RequestPendingScreenView } from '../RequestPendingScreen'

const lookup: ArtifactInfoInaccessible = {
	exists: true,
	accessible: false,
	organizationName: 'Acme Corp',
	domain: null,
	myRequestStatus: 'none',
	lastRequestedAt: null,
}

function SuccessTransitionDemo({ variant }: { variant: 'logged-in' | 'anonymous' }) {
	const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
	const [submittedLoggedIn, setSubmittedLoggedIn] = useState(false)

	if (submittedEmail) {
		return <RequestPendingScreenView lookup={lookup} variant="anonymous" email={submittedEmail} />
	}

	if (submittedLoggedIn) {
		return <RequestPendingScreenView lookup={lookup} variant="logged-in" email="alice@example.com" />
	}

	if (variant === 'logged-in') {
		return (
			<RequestAccessLoggedIn
				lookup={lookup}
				email="alice@example.com"
				onRequestAccess={() => setSubmittedLoggedIn(true)}
			/>
		)
	}

	return <RequestAccessAnonymous lookup={lookup} onRequestAccess={setSubmittedEmail} />
}

function ResettableLoggedOutSubmitDemo() {
	const [key, setKey] = useState(0)
	return (
		<div className="space-y-4">
			<Button variant="outline" onClick={() => setKey((value) => value + 1)}>
				Reset demo
			</Button>
			<SuccessTransitionDemo key={key} variant="anonymous" />
		</div>
	)
}

function AlreadyRequestedDemo() {
	const [showRetry, setShowRetry] = useState(false)

	if (showRetry) {
		return (
			<RequestPendingScreenView
				lookup={lookup}
				variant="logged-in"
				retryAfter={new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()}
			/>
		)
	}

	return (
		<RequestAccessLoggedIn
			lookup={lookup}
			email="alice@example.com"
			onRequestAccess={() => setShowRetry(true)}
		/>
	)
}

const meta = {
	title: 'Shell Demos/RequestAccessScreen',
	component: SuccessTransitionDemo,
} satisfies Meta<typeof SuccessTransitionDemo>

export default meta
type Story = StoryObj<typeof meta>

export const LoggedInSubmitSuccess: Story = {
	args: { variant: 'logged-in' },
}

export const LoggedOutSubmitSuccess: Story = {
	args: { variant: 'anonymous' },
}

export const AlreadyRequestedErrorPath: Story = {
	render: () => <AlreadyRequestedDemo />,
}

export const ResettableLoggedOutSubmit: Story = {
	render: () => <ResettableLoggedOutSubmitDemo />,
}
