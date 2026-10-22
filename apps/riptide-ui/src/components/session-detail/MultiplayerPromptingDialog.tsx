import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Clock3, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'

import { UserSelector } from '@/components/UserSelector'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import type { MultiplayerPromptingDuration } from '@/hooks/stores/settingsStore'
import type { OrgMember } from '@/hooks/useOrgMembers'

const DURATIONS: Array<{ value: MultiplayerPromptingDuration; label: string }> = [
	{ value: '15m', label: '15m' },
	{ value: '30m', label: '30m' },
	{ value: '1h', label: '1h' },
	{ value: '2h', label: '2h' },
	{ value: '1d', label: '1d' },
	{ value: 'unlimited', label: 'No limit' },
]

export interface MultiplayerPromptingDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	members: OrgMember[]
	currentUserIds: string[]
	activeLabel?: string
	initialDuration: MultiplayerPromptingDuration
	isPending?: boolean
	onSave: (value: { userIds: string[]; duration: MultiplayerPromptingDuration }) => void
	onEnd: () => void
}

function initials(member: OrgMember) {
	return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}` || member.email[0]?.toUpperCase() || '?'
}

export function MultiplayerPromptingDialog({
	open,
	onOpenChange,
	members,
	currentUserIds,
	activeLabel,
	initialDuration,
	isPending,
	onSave,
	onEnd,
}: MultiplayerPromptingDialogProps) {
	const [userIds, setUserIds] = useState(currentUserIds)
	const [duration, setDuration] = useState(initialDuration)
	const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
	const availableMembers = members.filter((member) => !userIds.includes(member.id))
	const submit = () => userIds.length > 0 && onSave({ userIds, duration })

	useAppHotkeys('mod+enter', submit, { scopes: [HOTKEY_SCOPES.MULTIPLAYER_PROMPTING_DIALOG], enabled: open })

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-[440px]" data-testid="multiplayer-prompting-dialog">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 px-5 pt-5">
						<Users className="size-4 text-accent" />
						Multiplayer Prompting
					</DialogTitle>
					<DialogDescription className="border-b px-5 pb-4 pt-1">
						{currentUserIds.length > 0
							? 'Manage who can prompt this session'
							: 'Let teammates send prompts to this session'}
					</DialogDescription>
				</DialogHeader>
				{activeLabel && (
					<div className="mx-5 mt-4 flex items-center border border-accent bg-accent/10 px-3 py-2 text-xs text-accent">
						<span>● Sharing active</span>
						<span className="ml-auto flex items-center gap-1 text-foreground">
							<Clock3 className="size-3" /> {activeLabel}
						</span>
					</div>
				)}
				<div className="space-y-5 px-5 py-4">
					<div className="space-y-2">
						<div className="text-xs font-semibold">
							{currentUserIds.length > 0 ? 'People with access' : 'Add people'}
						</div>
						<UserSelector
							users={availableMembers}
							onSelect={(id) => setUserIds((ids) => [...ids, id])}
							placeholder="Search by name or email..."
						/>
						<div
							className="flex max-h-[132px] flex-col gap-1.5 overflow-y-auto"
							data-testid="multiplayer-roster"
						>
							{userIds.map((id) => {
								const member = memberMap.get(id)
								if (!member) return null
								const name =
									[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
								return (
									<div
										key={id}
										className="flex shrink-0 items-center gap-2 border bg-background px-2 py-1.5"
									>
										<Avatar className="size-[22px]">
											<AvatarImage src={member.profilePictureUrl ?? ''} />
											<AvatarFallback>{initials(member)}</AvatarFallback>
										</Avatar>
										<div className="min-w-0 flex-1 truncate text-xs">{name}</div>
										<Button
											variant="ghost"
											size="icon"
											className="size-8 text-muted-foreground hover:text-destructive"
											aria-label={`Remove ${name}`}
											onClick={() => setUserIds((ids) => ids.filter((value) => value !== id))}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								)
							})}
						</div>
					</div>
					<div>
						<div className="mb-2 text-xs font-semibold">
							Time limit <span className="font-normal text-accent">· remembers your last choice</span>
						</div>
						<div className="flex flex-wrap gap-2">
							{DURATIONS.map((option) => (
								<Button
									key={option.value}
									type="button"
									variant={duration === option.value ? 'default' : 'outline'}
									size="sm"
									className="h-7 px-3 text-xs"
									onClick={() => setDuration(option.value)}
								>
									{option.label}
								</Button>
							))}
						</div>
						<div className="mt-2 text-[10px] text-muted-foreground">
							{currentUserIds.length > 0
								? 'Pick a duration to reset the countdown from now. No limit lasts until you end it.'
								: 'Everyone shares one countdown. No limit lasts until you end it.'}
						</div>
					</div>
				</div>
				<DialogFooter className="border-t px-5 py-3 sm:justify-between">
					<div>
						{currentUserIds.length > 0 && (
							<Button variant="destructive" size="sm" onClick={onEnd} disabled={isPending}>
								End sharing
							</Button>
						)}
					</div>
					<div className="flex gap-2">
						<Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
							{currentUserIds.length > 0 ? 'Close' : 'Cancel'} <KeyboardShortcut>Esc</KeyboardShortcut>
						</Button>
						<Button size="sm" onClick={submit} disabled={userIds.length === 0 || isPending}>
							{isPending ? 'Saving...' : currentUserIds.length > 0 ? 'Save' : 'Grant access'}{' '}
							<KeyboardShortcut>⌘+ENTER</KeyboardShortcut>
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
