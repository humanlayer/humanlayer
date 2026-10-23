import type { Session } from '@humanlayer/db/tables/sessions'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { formatMultiplayerPromptingCountdown, isMultiplayerPromptingActive } from '@/hooks/useMultiplayerPromptingNow'
import { type OrgMember, useOrgMembers } from '@/hooks/useOrgMembers'
import { computeSessionPermissions } from '@/hooks/useSessionPermissions'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'

/**
 * What the signed-in user may do in a session, by the standard UI's rules: its creator
 * prompts and approves, and so do teammates the creator lets prompt for a while.
 */
export function useSessionAccess(session: Session | undefined) {
	const { user } = useBrowserAuth()
	const { taskOrganizationAclsCollection, taskUserAclsCollection } = useSync()
	const task = useMemo(
		() =>
			session?.task_id
				? { id: session.task_id, resource_owner_user_id: session.resource_owner_user_id }
				: undefined,
		[session?.task_id, session?.resource_owner_user_id],
	)
	const { effectivePermission } = useTaskPermissions(
		task,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	// Only a teammate on the list loses access with time, so only they wait on the clock.
	const granted =
		!!user?.id && session?.created_by !== user.id && !!session?.multiplayer_prompting_user_ids?.includes(user.id)
	const now = useClock(granted && session ? windowOf(session) : null, false)
	return useMemo(
		() => computeSessionPermissions(session, user?.id, effectivePermission, multiplayerPromptingEnabled, now),
		[session, user?.id, effectivePermission, multiplayerPromptingEnabled, now],
	)
}

type SharingWindow = { startedAt: bigint | null; expiresAt: bigint | null }

/**
 * The time, refreshed when the sharing window opens or closes, and every second
 * while `tick` drives a countdown. Outside a window it never refreshes.
 */
function useClock(span: SharingWindow | null, tick: boolean): number {
	const { data } = useQuery({
		queryKey: ['minimalist-clock', span?.startedAt?.toString(), span?.expiresAt?.toString(), tick],
		queryFn: Date.now,
		initialData: Date.now,
		networkMode: 'always',
		refetchInterval: (query) => {
			const now = query.state.data ?? Date.now()
			if (span?.startedAt == null) return false
			if (Number(span.startedAt) > now) return Number(span.startedAt) - now + 50
			const left = span.expiresAt == null ? 0 : Number(span.expiresAt) - now
			if (left <= 0) return false
			return tick ? Math.min(1000, left) : left + 50
		},
		refetchIntervalInBackground: true,
	})
	return data
}

function windowOf(
	session: Pick<Session, 'multiplayer_prompting_started_at' | 'multiplayer_prompting_expires_at'>,
): SharingWindow {
	return { startedAt: session.multiplayer_prompting_started_at, expiresAt: session.multiplayer_prompting_expires_at }
}

/**
 * A session is multiplayer once its owner has shared prompting, even after sharing ends, or once
 * more than one person has written in it. Its messages then show who sent them.
 */
export function isMultiplayerThread(
	session: Pick<Session, 'multiplayer_prompting_started_at'>,
	authorIds: readonly (string | null | undefined)[],
): boolean {
	if (session.multiplayer_prompting_started_at !== null) return true
	return new Set(authorIds.filter(Boolean)).size > 1
}

/** Who the creator lets prompt and how long is left, ticking for the countdown. */
export function usePromptSharing(
	session: Pick<
		Session,
		'multiplayer_prompting_user_ids' | 'multiplayer_prompting_started_at' | 'multiplayer_prompting_expires_at'
	>,
) {
	const userIds = session.multiplayer_prompting_user_ids ?? []
	const expiresAt = session.multiplayer_prompting_expires_at
	const now = useClock(userIds.length > 0 ? windowOf(session) : null, true)
	const active = isMultiplayerPromptingActive(userIds, session.multiplayer_prompting_started_at, expiresAt, now)
	return {
		userIds,
		active,
		left: active && expiresAt !== null ? formatMultiplayerPromptingCountdown(expiresAt, now) : null,
	}
}

/** "Ada Lovelace", else the email, else "Someone" for a member this org doesn't list. */
export function memberName(member: Pick<OrgMember, 'firstName' | 'lastName' | 'email'> | undefined): string {
	if (!member) return 'Someone'
	return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email || 'Someone'
}

/** "Ada", else the part of the email before the @: for tight spots like the thread header. */
export function memberFirstName(member: Pick<OrgMember, 'firstName' | 'email'> | undefined): string {
	return member?.firstName || member?.email.split('@')[0] || 'Someone'
}

export function useMemberName() {
	const { membersMap } = useOrgMembers()
	return (userId: string | null | undefined) => memberName(userId ? membersMap.get(userId) : undefined)
}
