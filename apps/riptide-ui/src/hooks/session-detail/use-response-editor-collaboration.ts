import {
	RESPONSE_EDITOR_DOCUMENT_ID,
	responseEditorCollaborationBasePath,
	type ResponseEditorKey,
} from '@humanlayer/streams/response-editor-collaboration'
import type { RichTextEditorBinding, RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { YjsProvider } from '@humanlayer/y-durable-streams'
import type { Content } from '@tiptap/core'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { useAuth } from '@workos-inc/authkit-react'
import { useState, useSyncExternalStore, type RefObject } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { readRetainedResponse, retainSharedResponse } from '@/hooks/stores/shared-response-retention-store'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isMultiplayerPromptingActive, useMultiplayerPromptingNow } from '@/hooks/useMultiplayerPromptingNow'
import { useUserInfo } from '@/hooks/useUserInfo'
import { captureException } from '@/integrations/sentry/sentry'

import { createResponsePresence } from './response-editor-presence'
import type { SessionDetailSession } from './useSessionDetailData'

export function isSharedResponseEligible(input: {
	existingDesktopSession: boolean
	sharingActive: boolean
	organizationFeatureEnabled: boolean
	sameOrganization: boolean
}): boolean {
	return (
		input.existingDesktopSession &&
		input.sharingActive &&
		input.organizationFeatureEnabled &&
		input.sameOrganization
	)
}

export function useSharedResponseOptions(
	session: Pick<
		SessionDetailSession,
		| 'id'
		| 'organization_id'
		| 'multiplayer_prompting_user_ids'
		| 'multiplayer_prompting_started_at'
		| 'multiplayer_prompting_expires_at'
	>,
	canPrompt: boolean,
): SharedResponseOptions | undefined {
	const { user, getAccessToken } = useAuth()
	const { dbOrganizationId } = useUserInfo()
	const organizationFeatureEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const now = useMultiplayerPromptingNow(session.multiplayer_prompting_expires_at)
	const eligible = isSharedResponseEligible({
		existingDesktopSession: true,
		sharingActive: isMultiplayerPromptingActive(
			session.multiplayer_prompting_user_ids ?? [],
			session.multiplayer_prompting_started_at,
			session.multiplayer_prompting_expires_at,
			now,
		),
		organizationFeatureEnabled,
		sameOrganization: !!dbOrganizationId && dbOrganizationId === session.organization_id,
	})
	if (!eligible || !user || !dbOrganizationId) return undefined
	return {
		organizationId: dbOrganizationId,
		sessionId: session.id,
		memberId: user.id,
		getAccessToken,
		contentAccess: canPrompt ? 'read-write' : 'read-only',
		syncOrigin: import.meta.env.VITE_PUBLIC_SYNC_ORIGIN,
	}
}

export type SharedResponseStatus = 'connecting' | 'connected' | 'reconnecting' | 'view-only' | 'access-lost'
export interface SharedResponseOptions extends ResponseEditorKey {
	memberId: string
	contentAccess: 'read-write' | 'read-only'
	getAccessToken: () => Promise<string>
	syncOrigin: string
}
export interface SharedResponseSnapshot {
	status: SharedResponseStatus
	content: Content
}

/** Called only by a mounted, keyed owner. No network/timer resources during render. */
export function createSharedResponseOwner(options: SharedResponseOptions) {
	const document = new Y.Doc()
	const awareness = new Awareness(document)
	const provider = new YjsProvider({
		doc: document,
		awareness,
		baseUrl: `${options.syncOrigin}${responseEditorCollaborationBasePath(options)}`,
		docId: RESPONSE_EDITOR_DOCUMENT_ID,
		headers: { Authorization: async () => `Bearer ${await options.getAccessToken()}` },
		contentAccess: options.contentAccess,
		retainedState: readRetainedResponse(options),
		connect: false,
	})
	awareness.setLocalState({ user: { memberId: options.memberId }, session: { present: true }, cursor: null })
	const presence = createResponsePresence(awareness)
	provider.on('awarenessReady', () => presence.setConnected(true))
	const binding: Extract<RichTextEditorBinding, { mode: 'collaborative' }> = {
		mode: 'collaborative',
		document,
		awareness,
		fragment: 'response',
		localUser: { memberId: options.memberId },
	}
	let snapshot: SharedResponseSnapshot = {
		status: 'connecting',
		content: yDocToProsemirrorJSON(document, 'response'),
	}
	let everConnected = false
	let contentAccess = options.contentAccess
	let accessLost = false
	let destroyed = false
	const listeners = new Set<() => void>()
	const notify = () => {
		for (const listener of listeners) listener()
	}
	const update = () => {
		if (accessLost) return
		retainSharedResponse(options, document)
		snapshot = { ...snapshot, content: yDocToProsemirrorJSON(document, 'response') }
		notify()
	}
	provider.on('status', (status) => {
		if (destroyed || accessLost) return
		if (status !== 'connected') presence.setConnected(false)
		if (status === 'connected') everConnected = true
		snapshot = {
			...snapshot,
			status:
				status === 'connected'
					? contentAccess === 'read-only'
						? 'view-only'
						: 'connected'
					: everConnected
						? 'reconnecting'
						: 'connecting',
		}
		notify()
	})
	provider.on('access', (access) => {
		if (destroyed) return
		contentAccess = 'read-only'
		accessLost = access === 'access-lost'
		awareness.setLocalStateField('cursor', null)
		if (accessLost) presence.setConnected(false)
		snapshot = {
			...snapshot,
			status: accessLost ? 'access-lost' : 'view-only',
			content: accessLost ? null : snapshot.content,
		}
		notify()
	})
	provider.on('error', (error) => {
		captureException(error)
		if (destroyed || accessLost) return
		everConnected = true
		snapshot = { ...snapshot, status: 'reconnecting' }
		notify()
	})
	document.on('update', update)
	void provider.connect()
	return {
		binding,
		presence,
		provider,
		retry: async () => {
			await provider.disconnect()
			if (!destroyed) await provider.connect()
		},
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		destroy: () => {
			if (destroyed) return
			destroyed = true
			retainSharedResponse(options, document)
			document.off('update', update)
			presence.destroy()
			provider.destroy()
			awareness.destroy()
			document.destroy()
			listeners.clear()
		},
	}
}

export type SharedResponseOwner = ReturnType<typeof createSharedResponseOwner>
const emptySnapshot: SharedResponseSnapshot = { status: 'connecting', content: null }
const noSubscribe = () => () => {}
const getEmptySnapshot = () => emptySnapshot

/** Parent keys this subtree by organization/session/member/capability. StrictMode
 * setup/cleanup creates a fresh owner; an abandoned render creates nothing. */
export function useResponseEditorCollaboration(
	options: SharedResponseOptions,
	editorRef: RefObject<RichTextEditorRef | null>,
) {
	const [owner, setOwner] = useState<SharedResponseOwner | null>(null)
	useMountEffect(() => {
		const next = createSharedResponseOwner(options)
		setOwner(next)
		return () => {
			// A keyed replacement may already have assigned the shared external ref
			// before passive cleanup. Never destroy that replacement's editor.
			const editor = editorRef.current?.editor
			const binding = editor?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')
			if (binding?.options.document === next.binding.document) editor?.destroy()
			next.destroy()
		}
	})
	const snapshot = useSyncExternalStore(
		owner?.subscribe ?? noSubscribe,
		owner?.getSnapshot ?? getEmptySnapshot,
		getEmptySnapshot,
	)
	return owner ? { owner, ...snapshot } : null
}
