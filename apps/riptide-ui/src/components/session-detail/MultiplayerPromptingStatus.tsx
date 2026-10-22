import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { ChevronDown, Clock3 } from 'lucide-react'

import { participantStatus, type CollaborationParticipant } from '@/hooks/session-detail/response-editor-presence'

export interface MultiplayerPromptingParticipant {
	id: string
	email: string
	firstName?: string
	lastName?: string
	profilePictureUrl?: string
}

interface MultiplayerPromptingStatusBaseProps {
	participants: MultiplayerPromptingParticipant[]
	liveParticipants?: readonly CollaborationParticipant[]
	checkingPresence?: boolean
	countdown: string
}

/**
 * Live code renders this in exactly two shapes: a read-only collaborator badge
 * (`isOwner: false`) and an owner control whose button always opens the manage
 * dialog (`isOwner: true`). The owner variant therefore requires `onManage` so
 * the button can never render inert.
 */
export type MultiplayerPromptingStatusProps = MultiplayerPromptingStatusBaseProps &
	({ isOwner: false } | { isOwner: true; onManage: () => void })

export function MultiplayerPromptingStatus(props: MultiplayerPromptingStatusProps) {
	const { participants, countdown } = props
	const details = props.liveParticipants ? (
		<div className="response-presence font-mono">
			{props.checkingPresence && <p>Checking presence…</p>}
			{props.liveParticipants.map((participant) => (
				<p key={participant.memberId}>
					{participant.displayName} · {participantStatus(participant)}
				</p>
			))}
		</div>
	) : null
	const statusContent = (
		<span
			className="response-presence flex min-w-0 items-center gap-1.5"
			data-testid="multiplayer-prompting-status"
		>
			<AvatarGroup
				className="shrink-0 *:data-[slot=avatar]:ring-0 -space-x-1.5"
				data-testid="multiplayer-prompting-avatars"
			>
				{props.liveParticipants
					? props.liveParticipants.slice(0, 3).map((participant) => (
							<span
								key={participant.memberId}
								className="relative inline-flex"
								title={`${participant.displayName} · ${participantStatus(participant)}`}
							>
								<Avatar
									className="size-5"
									aria-label={`${participant.displayName} · ${participantStatus(participant)}`}
								>
									<AvatarImage src={participant.photoUrl} alt="" />
									<AvatarFallback className="bg-muted text-[8px] font-medium text-foreground">
										{participant.displayName[0]?.toUpperCase() || '?'}
									</AvatarFallback>
								</Avatar>
								<span
									aria-hidden="true"
									className="response-presence-marker absolute bottom-0 left-0"
									data-presence={participant.presence}
									style={{
										borderColor:
											participant.presence === 'present'
												? 'var(--terminal-success)'
												: 'var(--terminal-border)',
										backgroundColor:
											participant.presence === 'present'
												? 'var(--terminal-success)'
												: 'var(--terminal-bg)',
									}}
								/>
							</span>
						))
					: participants.slice(0, 3).map((participant) => {
							const initials =
								`${participant.firstName?.[0] ?? ''}${participant.lastName?.[0] ?? ''}` ||
								participant.email[0]?.toUpperCase() ||
								'?'
							return (
								<Avatar key={participant.id} className="size-5">
									<AvatarImage src={participant.profilePictureUrl ?? ''} alt="" />
									<AvatarFallback className="bg-muted text-[8px] font-medium text-foreground">
										{initials}
									</AvatarFallback>
								</Avatar>
							)
						})}
				{(props.liveParticipants ?? participants).length > 3 && (
					<AvatarGroupCount className="size-5 text-[8px] ring-0">
						+{(props.liveParticipants ?? participants).length - 3}
					</AvatarGroupCount>
				)}
			</AvatarGroup>
			{props.checkingPresence && <span className="sr-only">Checking presence…</span>}
			<span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-foreground">
				<Clock3 className="size-3" />
				{countdown}
			</span>
		</span>
	)

	if (!props.isOwner) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						role="status"
						tabIndex={0}
						aria-label="Multiplayer Prompting active"
						className="response-presence flex h-7 w-auto items-center border border-accent bg-accent/10 px-2 focus-visible:outline-2 focus-visible:outline-accent"
					>
						{statusContent}
					</span>
				</TooltipTrigger>
				<TooltipContent sideOffset={6} className="px-2 py-1 text-[11px]">
					Multiplayer Prompting active
					{details}
				</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="response-presence h-7 w-auto gap-1.5 border-accent bg-accent/10 px-2 text-accent hover:border-accent hover:bg-accent/20 hover:text-accent normal-case tracking-normal"
					onClick={props.onManage}
					aria-label="Multiplayer Prompting"
				>
					<span className="flex min-w-0 items-center gap-1.5">
						{statusContent}
						<ChevronDown className="size-3 shrink-0 text-accent" />
					</span>
				</Button>
			</TooltipTrigger>
			<TooltipContent sideOffset={6} className="px-2 py-1 text-[11px]">
				Manage Multiplayer Prompting
				{details}
			</TooltipContent>
		</Tooltip>
	)
}
