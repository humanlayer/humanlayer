import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { uuidv7 } from 'uuidv7'

export interface GuestArtifactIdentity {
	anonymousAuthorId: string
	guestName: string
	guestEmail?: string
}

function fingerprint(value: string): string {
	let hash = 5381
	for (const character of value) hash = (hash * 33) ^ character.charCodeAt(0)
	return (hash >>> 0).toString(36)
}

function storageKey(artifactId: string, shareKey: string) {
	return `humanlayer:shared-artifact-commenter:${artifactId}:${fingerprint(shareKey)}`
}

function readStoredIdentity(key: string): GuestArtifactIdentity | null {
	try {
		const raw = localStorage.getItem(key)
		return raw ? (JSON.parse(raw) as GuestArtifactIdentity) : null
	} catch {
		return null
	}
}

type AccountUser = { id: string; email: string; firstName?: string | null; lastName?: string | null }

/**
 * Public comments are always stored as guest comments. A signed-in viewer comments as a guest
 * named after their account, so they never see the identity dialog. The account details are part
 * of the storage key, so a renamed account starts a fresh guest identity instead of a conflict.
 */
function useAccountIdentity(artifactId: string, shareKey: string, user: AccountUser | null) {
	const guestName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : ''
	const key = user
		? `${storageKey(artifactId, shareKey)}:account:${fingerprint(`${user.id}:${guestName}:${user.email}`)}`
		: null
	const email = user?.email
	const [anonymousAuthorId] = useState(() => (key && readStoredIdentity(key)?.anonymousAuthorId) || uuidv7())
	return useMemo(
		() => (key && email ? { key, identity: { anonymousAuthorId, guestName, guestEmail: email } } : null),
		[anonymousAuthorId, email, guestName, key],
	)
}

export function useGuestArtifactIdentity(artifactId: string, shareKey: string) {
	const { user } = useAuth()
	const account = useAccountIdentity(artifactId, shareKey, user)
	const guestKey = storageKey(artifactId, shareKey)
	const key = account?.key ?? guestKey
	const [guestIdentity, setIdentity] = useState<GuestArtifactIdentity | null>(() => readStoredIdentity(guestKey))
	const identity = account?.identity ?? guestIdentity
	const [dialogOpen, setDialogOpen] = useState(false)
	const pendingRef = useRef<((identity: GuestArtifactIdentity) => void) | null>(null)
	const rejectPendingRef = useRef<((reason: DOMException) => void) | null>(null)

	const requireIdentity = useCallback((): Promise<GuestArtifactIdentity> => {
		if (identity) return Promise.resolve(identity)
		setDialogOpen(true)
		return new Promise((resolve, reject) => {
			pendingRef.current = resolve
			rejectPendingRef.current = reject
		})
	}, [identity])

	const provideIdentity = useCallback((input: { guestName: string; guestEmail?: string }) => {
		const next: GuestArtifactIdentity = {
			anonymousAuthorId: uuidv7(),
			guestName: input.guestName.trim(),
			guestEmail: input.guestEmail?.trim() || undefined,
		}
		setDialogOpen(false)
		pendingRef.current?.(next)
		pendingRef.current = null
		rejectPendingRef.current = null
		return next
	}, [])
	const cancelIdentity = useCallback(() => {
		setDialogOpen(false)
		rejectPendingRef.current?.(new DOMException('Guest identity collection cancelled', 'AbortError'))
		pendingRef.current = null
		rejectPendingRef.current = null
	}, [])
	const rememberIdentity = useCallback(
		(next: GuestArtifactIdentity) => {
			localStorage.setItem(key, JSON.stringify(next))
			setIdentity(next)
		},
		[key],
	)

	return { identity, dialogOpen, requireIdentity, provideIdentity, cancelIdentity, rememberIdentity }
}
