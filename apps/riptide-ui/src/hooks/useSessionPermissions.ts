import { useMemo } from 'react'

import { useMultiplayerPromptingNow } from '@/hooks/useMultiplayerPromptingNow'

export const SessionAccessControl = {
	noAccess: 'no_access',
	view: 'view',
	prompt: 'prompt',
	owner: 'owner',
} as const
export type SessionAccessControlLevel = (typeof SessionAccessControl)[keyof typeof SessionAccessControl]
export type TaskAclPermission = 'read' | 'comment' | 'edit' | null

export interface SessionLike {
	resource_owner_user_id: string
	created_by: string
	task_id?: string | null
	multiplayer_prompting_user_ids?: string[] | null
	multiplayer_prompting_started_at?: bigint | null
	multiplayer_prompting_expires_at?: bigint | null
}

function sessionAccessLevel(canManage: boolean, canPrompt: boolean, canView: boolean): SessionAccessControlLevel {
	if (canManage) return SessionAccessControl.owner
	if (canPrompt) return SessionAccessControl.prompt
	if (canView) return SessionAccessControl.view
	return SessionAccessControl.noAccess
}

export function computeSessionPermissions(
	session: SessionLike | undefined,
	userId: string | undefined,
	effectiveTaskPermission: TaskAclPermission,
	multiplayerPromptingEnabled: boolean,
	nowMillis = Date.now(),
) {
	const isCreator = !!session && !!userId && session.created_by === userId
	const hasTaskView = !!session?.task_id && effectiveTaskPermission !== null
	const hasTaskEdit = !!session?.task_id && effectiveTaskPermission === 'edit'
	const ownsStandalone = !!session && !session.task_id && session.resource_owner_user_id === userId
	const canManage = isCreator && (hasTaskEdit || ownsStandalone)
	const activeGrant =
		!!session &&
		!!userId &&
		multiplayerPromptingEnabled &&
		(session.multiplayer_prompting_user_ids ?? []).includes(userId) &&
		session.multiplayer_prompting_started_at != null &&
		session.multiplayer_prompting_started_at <= BigInt(nowMillis) &&
		(session.multiplayer_prompting_expires_at == null ||
			session.multiplayer_prompting_expires_at > BigInt(nowMillis))
	const canPrompt = canManage || (activeGrant && (hasTaskEdit || !session?.task_id))
	const canView = canPrompt || hasTaskView || ownsStandalone
	const accessLevel = sessionAccessLevel(canManage, canPrompt, canView)
	return {
		isOwner: isCreator,
		accessLevel,
		canManageSession: canManage,
		canSendPrompt: canPrompt,
		canResolveApproval: canPrompt,
	}
}

export function useSessionPermissions(
	session: SessionLike | undefined,
	userId: string | undefined,
	effectiveTaskPermission: TaskAclPermission,
	multiplayerPromptingEnabled: boolean,
) {
	const nowMillis = useMultiplayerPromptingNow(session?.multiplayer_prompting_expires_at)
	return useMemo(
		() =>
			computeSessionPermissions(session, userId, effectiveTaskPermission, multiplayerPromptingEnabled, nowMillis),
		[session, userId, effectiveTaskPermission, multiplayerPromptingEnabled, nowMillis],
	)
}
