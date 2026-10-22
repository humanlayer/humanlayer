import { collaborationPaletteSlot, type CollaborationIdentity } from '@humanlayer/ui/lib/collaboration-colors'
import { readResponseEditorAwareness } from '@humanlayer/ui/lib/response-editor-awareness'
import type { Awareness } from 'y-protocols/awareness'

import type { OrgMember } from '@/hooks/useOrgMembers'

export interface ResponsePresenceSnapshot {
	checking: boolean
	clients: readonly { clientId: number; memberId: string; editing: boolean }[]
}
export interface CollaborationParticipant extends CollaborationIdentity {
	memberId: string
	invitation: 'owner' | 'invited' | 'viewer'
	presence: 'checking' | 'present' | 'absent'
	editingClientIds: readonly number[]
	paletteSlot: number
}

function participantPresenceStatus(participant: CollaborationParticipant): string {
	if (participant.presence === 'checking') return 'Checking presence…'
	if (participant.presence === 'absent') return 'not present'
	if (participant.editingClientIds.length > 0) return 'Editing'
	return 'Present'
}

export function participantStatus(participant: CollaborationParticipant): string {
	const invitation =
		participant.invitation === 'owner' ? 'Owner' : participant.invitation === 'invited' ? 'Invited' : 'Viewer'
	const presence = participantPresenceStatus(participant)
	return `${invitation} · ${presence}`
}

export function resolveCollaborationIdentities(members: ReadonlyMap<string, OrgMember>) {
	return new Map(
		[...members].map(([id, member]) => [
			id,
			{
				displayName:
					[member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email || 'Teammate',
				photoUrl: member.profilePictureUrl,
			},
		]),
	)
}

export function projectCollaborationParticipants(
	ownerId: string,
	invitedIds: readonly string[],
	presence: ResponsePresenceSnapshot,
	identities: ReadonlyMap<string, CollaborationIdentity>,
): CollaborationParticipant[] {
	const invitedIdSet = new Set(invitedIds)
	const ids = new Set([ownerId, ...invitedIds])
	const presenceByMemberId = new Map<string, { clientCount: number; editingClientIds: number[] }>()
	for (const client of presence.clients) {
		if (identities.has(client.memberId)) ids.add(client.memberId)
		const memberPresence = presenceByMemberId.get(client.memberId) ?? { clientCount: 0, editingClientIds: [] }
		memberPresence.clientCount += 1
		if (client.editing) memberPresence.editingClientIds.push(client.clientId)
		presenceByMemberId.set(client.memberId, memberPresence)
	}
	return [...ids].map((memberId) => {
		const memberPresence = presenceByMemberId.get(memberId)
		const identity = identities.get(memberId) ?? { displayName: 'Teammate' }
		return {
			memberId,
			invitation: memberId === ownerId ? 'owner' : invitedIdSet.has(memberId) ? 'invited' : 'viewer',
			presence: memberPresence?.clientCount ? 'present' : presence.checking ? 'checking' : 'absent',
			editingClientIds: memberPresence?.editingClientIds ?? [],
			paletteSlot: collaborationPaletteSlot(memberId),
			...identity,
		}
	})
}

/** One observation window per awareness connection, not per UI subscriber.
 * The stream starts at now; allow one heartbeat before calling unseen invitees absent. */
export function createResponsePresence(awareness: Awareness) {
	let snapshot: ResponsePresenceSnapshot = { checking: true, clients: [] }
	let connected = false
	let timer: ReturnType<typeof setTimeout> | undefined
	const listeners = new Set<() => void>()
	const update = () => {
		const clients: ResponsePresenceSnapshot['clients'][number][] = []
		if (connected)
			for (const [clientId, raw] of awareness.getStates()) {
				const peer = readResponseEditorAwareness(raw)
				if (peer) clients.push({ clientId, memberId: peer.memberId, editing: peer.cursor !== null })
			}
		snapshot = { ...snapshot, clients }
		for (const listener of listeners) listener()
	}
	awareness.on('change', update)
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		setConnected(next: boolean) {
			if (connected === next) return
			connected = next
			clearTimeout(timer)
			snapshot = { ...snapshot, checking: true }
			if (next)
				timer = setTimeout(() => {
					snapshot = { ...snapshot, checking: false }
					update()
				}, 15_000)
			update()
		},
		destroy() {
			clearTimeout(timer)
			awareness.off('change', update)
			listeners.clear()
		},
	}
}
