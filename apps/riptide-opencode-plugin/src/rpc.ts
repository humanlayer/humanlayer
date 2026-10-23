// The RPC between the plugin's two halves. The server half (index.ts) runs the mirrors, the login
// and the HumanLayer client; the TUI half (tui.tsx) calls these methods for `/humanlayer`, and
// follows the events for its footer, notices and the login's code and org picker. Both import this
// file, so they agree on the names; the shapes below are what the methods and events carry.

import type { Channel } from '@humanlayer/session-sdk-base'

const object = { type: 'object' } as const

export const HumanLayerRpc = {
	id: 'humanlayer',
	methods: {
		status: { input: object, output: object },
		login: { input: object, output: object },
		chooseOrg: { input: object, output: object },
		logout: { input: object, output: object },
		attach: { input: object, output: object },
		off: { input: object, output: object },
		on: { input: object, output: object },
	},
	events: {
		/** A session's status changed; the TUI asks for it again. */
		changed: { schema: object },
		/** A notice for the user: the server half has no UI of its own. */
		notice: { schema: object },
		/** A login step the TUI shows: the code, the org picker, the end. */
		login: { schema: object },
		/** A web `/compact`: only the TUI's client can compact a session. */
		compact: { schema: object },
	},
} as const

/** What the footer and `/humanlayer status` show for one opencode session. */
export interface SessionInfo {
	state: 'unbound' | 'binding' | 'mirroring' | 'off' | 'stopped'
	task?: string
	url?: string
	/** Updates waiting to send. */
	queued: number
	/** The last task file synced. */
	synced?: string
	/** Why mirroring stopped, when it did. */
	problem?: string
	/** The task the next prompt binds to, after an attach. */
	attach?: string
}

export interface StatusInput {
	sessionID?: string
}

export interface StatusOutput {
	channel: Channel
	signedIn?: { email?: string; org?: string; source: 'device' | 'pat' }
	/** A login waiting for approval in the browser. */
	pending?: { url?: string; code?: string }
	/** The cloud turned down the login; queues wait for a new one. */
	loginRequired?: boolean
	disabled?: boolean
	session?: SessionInfo
}

export interface ChannelInput {
	/** A channel name, checked by the server half. */
	channel?: string
}

export interface SessionInput {
	sessionID: string
}

export interface AttachInput {
	/** No session: the next new session in this opencode joins the task. */
	sessionID?: string
	/** A task id or slug, or `new`. */
	target: string
}

/** What a method reports back for a toast. */
export interface Reply {
	message: string
	variant?: 'info' | 'warning' | 'error'
}

export interface ChangedEvent {
	sessionID?: string
}

export interface NoticeEvent {
	sessionID?: string
	message: string
	variant: 'info' | 'warning' | 'error'
}

export interface OrgOption {
	id: string
	name: string
}

export type LoginEvent =
	| { kind: 'code'; channel: Channel; url: string; code: string }
	| { kind: 'orgs'; channel: Channel; orgs: OrgOption[]; current?: string }
	| { kind: 'done'; channel: Channel; message: string; ok: boolean }

/** What each event carries. */
export interface Events {
	changed: ChangedEvent
	notice: NoticeEvent
	login: LoginEvent
	compact: SessionInput
}

export interface ChooseOrgInput {
	/** undefined: the user closed the picker. */
	id?: string
}
