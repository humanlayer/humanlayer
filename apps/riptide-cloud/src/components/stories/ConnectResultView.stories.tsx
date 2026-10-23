import type { Meta, StoryObj } from '@storybook/react'
import { ConnectResultView } from '../ConnectResultView'

const meta = {
	title: 'Components/ConnectResultView',
	component: ConnectResultView,
} satisfies Meta<typeof ConnectResultView>

export default meta
type Story = StoryObj<typeof meta>

const base = {
	provider: 'linear',
	client: 'cloud',
	onBackToApp: () => undefined,
} as const

/** Cloud-initiated success: "Back to settings" leads. */
export const ConnectedFromCloud: Story = {
	args: { ...base, status: 'connected' },
}

/** Desktop-initiated success: "Back to HumanLayer" leads. This is the `client` flip. */
export const ConnectedFromDesktop: Story = {
	args: { ...base, client: 'native', status: 'connected' },
}

export const AccessDenied: Story = {
	args: { ...base, status: 'access_denied' },
}

export const AuthFailed: Story = {
	args: { ...base, status: 'auth_failed' },
}

/** A reused or expired state token. */
export const InvalidLink: Story = {
	args: { ...base, status: 'invalid_link' },
}

export const Unavailable: Story = {
	args: { ...base, status: 'unavailable' },
}

/** Jira runs on the same screen; only the name changes. */
export const JiraConnected: Story = {
	args: { ...base, provider: 'jira', status: 'connected' },
}
