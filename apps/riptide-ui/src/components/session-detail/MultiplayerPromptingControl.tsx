import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { MultiplayerPromptingEnableDialog } from '@humanlayer/ui/components/multiplayer-prompting-enable-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import type { UpdateMultiplayerPromptingParams } from '@/actions/multiplayer-prompting'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { SessionDetailSession } from '@/hooks/session-detail/useSessionDetailData'
import { useSettingsStore, type MultiplayerPromptingDuration } from '@/hooks/stores/settingsStore'
import { useMultiplayerPromptingActions } from '@/hooks/useMultiplayerPromptingActions'
import {
	formatMultiplayerPromptingCountdown,
	isMultiplayerPromptingActive,
	useMultiplayerPromptingNow,
} from '@/hooks/useMultiplayerPromptingNow'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { captureException } from '@/integrations/sentry/sentry'
import { useRiptideApi } from '@/orpc/client'

import { MultiplayerPromptingDialog } from './MultiplayerPromptingDialog'
import { MultiplayerPromptingStatus } from './MultiplayerPromptingStatus'
import { useMultiplayerPresence } from './response-editor-presence-context'

type SaveMultiplayerPromptingInput = {
	userIds: string[]
	duration: MultiplayerPromptingDuration
}

type SaveMultiplayerPromptingMutationVariables = {
	request: UpdateMultiplayerPromptingParams
	duration: MultiplayerPromptingDuration
}

function reportMultiplayerPromptingMutationError(
	error: unknown,
	message: string,
	errorType: string,
	sessionId: string,
) {
	toast.error(message)
	captureException(error instanceof Error ? error : new Error(String(error)), {
		tags: { error_type: errorType },
		extra: { sessionId },
	})
}

export interface MultiplayerPromptingControlProps {
	isOwner: boolean
	session: SessionDetailSession
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function MultiplayerPromptingControl({
	isOwner,
	session,
	open,
	onOpenChange,
}: MultiplayerPromptingControlProps) {
	const { roles } = useAuth()
	const { client } = useRiptideApi()
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const multiplayerActions = useMultiplayerPromptingActions()
	const { membersMap } = useOrgMembers()
	const now = useMultiplayerPromptingNow(session.multiplayer_prompting_expires_at)
	const lastDuration = useSettingsStore((state) => state.multiplayerPromptingLastDuration)
	const setLastDuration = useSettingsStore((state) => state.setMultiplayerPromptingLastDuration)
	const isAdmin = roles?.includes('admin') ?? false
	const roster = session.multiplayer_prompting_user_ids ?? []
	const active = isMultiplayerPromptingActive(
		roster,
		session.multiplayer_prompting_started_at,
		session.multiplayer_prompting_expires_at,
		now,
	)
	const countdown = formatMultiplayerPromptingCountdown(session.multiplayer_prompting_expires_at, now)
	const members = [...membersMap.values()].filter((member) => member.id !== session.created_by)
	const participants = roster.map((id) => membersMap.get(id) ?? { id, email: '' })
	const presenceProps = useMultiplayerPresence(session.created_by, roster, membersMap)

	const enableMutation = useMutation({
		mutationFn: () => client.auth.admin.organizations.settings.set({ multiplayerPromptingEnabled: true }),
		onSuccess: () => {
			useSettingsStore.setState((state) => ({
				orgSettings: { ...state.orgSettings, multiplayerPromptingEnabled: true },
			}))
			onOpenChange(false)
			toast.success('Multiplayer Prompting enabled for your organization')
		},
		onError: (error) => {
			reportMultiplayerPromptingMutationError(
				error,
				'Could not enable Multiplayer Prompting',
				'multiplayer_prompting_enable_failed',
				session.id,
			)
		},
	})

	const saveMutation = useMutation({
		mutationFn: ({ request }: SaveMultiplayerPromptingMutationVariables) => multiplayerActions.update(request),
		onSuccess: (_response, { duration }) => {
			setLastDuration(duration)
			onOpenChange(false)
			toast.success(active ? 'Multiplayer Prompting updated' : 'Prompt access granted')
		},
		onError: (error) => {
			reportMultiplayerPromptingMutationError(
				error,
				'Could not update Multiplayer Prompting',
				'multiplayer_prompting_update_failed',
				session.id,
			)
		},
	})

	const endMutation = useMutation({
		mutationFn: () => multiplayerActions.update({ sessionId: session.id, settings: { enabled: false } }),
		onSuccess: () => {
			onOpenChange(false)
			toast.success('Multiplayer Prompting ended')
		},
		onError: (error) => {
			reportMultiplayerPromptingMutationError(
				error,
				'Could not end Multiplayer Prompting',
				'multiplayer_prompting_end_failed',
				session.id,
			)
		},
	})
	const isPending = enableMutation.isPending || saveMutation.isPending || endMutation.isPending
	const handleSave = ({ userIds, duration }: SaveMultiplayerPromptingInput) => {
		const currentRosterUserIds = new Set(roster)
		const selectedUserIds = new Set(userIds)
		const addUserIds = userIds.filter((id) => !currentRosterUserIds.has(id))
		const removeUserIds = roster.filter((id) => !selectedUserIds.has(id))
		saveMutation.mutate({
			request: {
				sessionId: session.id,
				settings: {
					enabled: true,
					addUserIds: addUserIds.length > 0 ? addUserIds : undefined,
					removeUserIds: removeUserIds.length > 0 ? removeUserIds : undefined,
					duration,
				},
			},
			duration,
		})
	}
	const handleEnd = () => endMutation.mutate()
	const handleEnable = () => enableMutation.mutate()

	if (!isOwner && !active) return null

	if (!isOwner) {
		return (
			<MultiplayerPromptingStatus
				participants={participants}
				{...presenceProps}
				countdown={countdown}
				isOwner={false}
			/>
		)
	}

	let dialog: ReactNode
	if (multiplayerPromptingEnabled) {
		dialog = (
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.MULTIPLAYER_PROMPTING_DIALOG}
				isActive={open}
				rootScopeDisabled
				componentName="MultiplayerPromptingDialog"
			>
				<MultiplayerPromptingDialog
					key={`${open}-${roster.join(',')}`}
					open={open}
					onOpenChange={onOpenChange}
					members={members}
					currentUserIds={active ? roster : []}
					activeLabel={active ? `${countdown} left` : undefined}
					initialDuration={lastDuration}
					isPending={isPending}
					onSave={handleSave}
					onEnd={handleEnd}
				/>
			</HotkeyScopeBoundary>
		)
	} else if (isAdmin) {
		dialog = (
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.MULTIPLAYER_PROMPTING_DIALOG}
				isActive={open}
				rootScopeDisabled
				componentName="MultiplayerPromptingEnableDialog"
			>
				<MultiplayerPromptingEnableDialog
					open={open}
					onOpenChange={onOpenChange}
					onConfirm={handleEnable}
					isPending={isPending}
					hotkeyScope={HOTKEY_SCOPES.MULTIPLAYER_PROMPTING_DIALOG}
				/>
			</HotkeyScopeBoundary>
		)
	} else {
		dialog = (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Multiplayer Prompting</DialogTitle>
						<DialogDescription>
							Multiplayer Prompting is disabled for your organization. Ask an organization admin to enable
							it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => onOpenChange(false)}>Close</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		)
	}

	return (
		<>
			{active ? (
				<MultiplayerPromptingStatus
					participants={participants}
					{...presenceProps}
					countdown={countdown}
					isOwner
					onManage={() => onOpenChange(true)}
				/>
			) : (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2"
							onClick={() => onOpenChange(true)}
							aria-label="Multiplayer Prompting"
						>
							<Users className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>multiplayer prompting</TooltipContent>
				</Tooltip>
			)}

			{dialog}
		</>
	)
}
