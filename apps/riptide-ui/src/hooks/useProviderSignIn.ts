import { useEffect, useRef } from 'react'

import type {
	ProviderSignInHost,
	ProviderSignInProvider,
	ProviderSignInRequest,
} from '@/components/provider-sign-in/ProviderSignInCard'
import { type ProviderLoginRow, useProviderLogin } from '@/hooks/useProviderLogin'

function toProviderSignInRequest(
	row: ProviderLoginRow | undefined,
	host: ProviderSignInHost,
): ProviderSignInRequest | null {
	const requestIsStranded = row?.status === 'requested' && host.state !== 'ready'
	if (!row || requestIsStranded) return null
	return {
		id: row.id,
		status: row.status,
		url: row.url,
		userCode: row.user_code,
		submittedCode: row.submitted_code,
		error: row.error,
		accountLabel: row.account_label,
	}
}

function useOnSignedIn(request: ProviderSignInRequest | null, onSignedIn: (() => void) | undefined) {
	const status = request?.status ?? null
	const previousStatus = useRef(status)
	useEffect(() => {
		const wasActive = previousStatus.current === 'requested' || previousStatus.current === 'awaiting_approval'
		previousStatus.current = status
		if (wasActive && status === 'succeeded') onSignedIn?.()
	}, [status, onSignedIn])
}

export function isSignInActive(request: ProviderSignInRequest | null): boolean {
	return request?.status === 'requested' || request?.status === 'awaiting_approval'
}

/** The latest sign-in for one provider on one host; `onSignedIn` fires when one started while mounted succeeds. */
export function useProviderSignIn(hostId: string | null, provider: ProviderSignInProvider, onSignedIn?: () => void) {
	const { host, latest, start, cancel, submitCode, isStarting } = useProviderLogin(hostId)
	const request = toProviderSignInRequest(latest.get(provider), host)
	useOnSignedIn(request, onSignedIn)
	return { host, request, start: () => start(provider), cancel, submitCode, isStarting }
}
