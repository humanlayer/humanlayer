import { createContext, useContext, useSyncExternalStore } from 'react'

import type { createResponsePresence } from '@/hooks/session-detail/response-editor-presence'
import {
	projectCollaborationParticipants,
	resolveCollaborationIdentities,
} from '@/hooks/session-detail/response-editor-presence'
import type { OrgMember } from '@/hooks/useOrgMembers'

export const ResponseEditorPresenceContext = createContext<ReturnType<typeof createResponsePresence> | null>(null)

const noPresenceSubscription = () => () => {}
const noPresenceSnapshot = () => null

export function useMultiplayerPresence(
	ownerId: string,
	invitedIds: readonly string[],
	members: ReadonlyMap<string, OrgMember>,
) {
	const store = useContext(ResponseEditorPresenceContext)
	const presence = useSyncExternalStore(
		store?.subscribe ?? noPresenceSubscription,
		store?.getSnapshot ?? noPresenceSnapshot,
		noPresenceSnapshot,
	)
	return {
		liveParticipants: presence
			? projectCollaborationParticipants(ownerId, invitedIds, presence, resolveCollaborationIdentities(members))
			: undefined,
		checkingPresence: presence?.checking,
	}
}
