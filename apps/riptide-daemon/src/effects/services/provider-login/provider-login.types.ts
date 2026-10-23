import type { ProviderLoginProvider, ProviderLoginStatus } from '@humanlayer/db/tables/provider-login-requests'

export interface ProviderLoginPatch {
	readonly status?: ProviderLoginStatus
	readonly url?: string
	readonly userCode?: string
	readonly error?: string | null
	readonly accountLabel?: string
	readonly clearSubmittedCode?: boolean
}

export interface ProviderLoginDriverContext {
	readonly requestId: string
	readonly provider: ProviderLoginProvider
	readonly signal: AbortSignal
	readonly update: (patch: ProviderLoginPatch) => Promise<void>
}

export interface ProviderLoginDriverResult {
	readonly accountLabel: string
}

export interface ProviderLoginDriver {
	/** Runs the whole flow. Resolves once the host holds a usable credential, rejects otherwise. */
	readonly start: (context: ProviderLoginDriverContext) => Promise<ProviderLoginDriverResult>
	/** Delivers a code the user pasted in the app. Only paste-code flows implement this. */
	readonly submitCode?: (code: string) => void
}

export class ProviderLoginAborted extends Error {
	constructor(readonly reason: 'cancelled' | 'timed_out') {
		super(`Provider login ${reason}`)
		this.name = 'ProviderLoginAborted'
	}
}
