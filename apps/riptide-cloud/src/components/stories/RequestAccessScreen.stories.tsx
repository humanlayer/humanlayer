import type { Meta, StoryObj } from '@storybook/react'
import { RequestAccessAnonymous } from '../RequestAccessAnonymous'
import { ArtifactSummary, RequestAccessLoggedIn } from '../RequestAccessLoggedIn'
import type { ArtifactInfoInaccessible } from '../RequestAccessScreen'

const lookup: ArtifactInfoInaccessible = {
	exists: true,
	accessible: false,
	organizationName: 'Acme Corp',
	domain: null,
	myRequestStatus: 'none',
	lastRequestedAt: null,
}

const lookupWithDomain: ArtifactInfoInaccessible = {
	...lookup,
	domain: 'stripe.com',
}

const meta = {
	title: 'Components/RequestAccessScreen',
	component: RequestAccessLoggedIn,
} satisfies Meta<typeof RequestAccessLoggedIn>

export default meta
type Story = StoryObj<typeof meta>

export const LoggedInOneClick: Story = {
	args: {
		lookup,
		email: 'alice@example.com',
		onRequestAccess: () => undefined,
	},
}

export const LoggedInSubmitting: Story = {
	args: {
		lookup,
		email: 'alice@example.com',
		isSubmitting: true,
		onRequestAccess: () => undefined,
	},
}

// Sign-in-first layout: a prominent Sign in button (carrying returnTo back to the
// artifact) for logged-out members, an "Or" divider, then the request form for
// genuine outsiders.
export const LoggedOutSignInFirst: Story = {
	render: () => (
		<RequestAccessAnonymous
			artifactId="019ea96e-1749-7000-86b1-49efe031f0b7"
			lookup={lookup}
			onRequestAccess={() => undefined}
		/>
	),
}

export const LoggedOutSignInFirstWithLogo: Story = {
	render: () => (
		<RequestAccessAnonymous
			artifactId="019ea96e-1749-7000-86b1-49efe031f0b7"
			lookup={lookupWithDomain}
			onRequestAccess={() => undefined}
		/>
	),
}

export const LoggedOutServerError: Story = {
	render: () => (
		<RequestAccessAnonymous
			artifactId="019ea96e-1749-7000-86b1-49efe031f0b7"
			lookup={lookup}
			errorMessage="Access requests are not available for this artifact."
			onRequestAccess={() => undefined}
		/>
	),
}

// The shared org box renders the org's logo (logo.dev) when a verified domain is
// surfaced by `artifacts.info`, and falls back to a Building2 icon otherwise.
export const OrgSummaryWithLogo: Story = {
	render: () => <ArtifactSummary lookup={lookupWithDomain} />,
}

export const OrgSummaryNoLogo: Story = {
	render: () => <ArtifactSummary lookup={lookup} />,
}
