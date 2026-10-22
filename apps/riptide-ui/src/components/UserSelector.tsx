import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check, ChevronsUpDown } from 'lucide-react'
import { useRef, useState } from 'react'

import type { OrgMember } from '@/hooks/useOrgMembers'

function getUserInitials(firstName?: string, lastName?: string, email?: string): string {
	if (firstName || lastName) {
		return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
	}
	return email ? email.charAt(0).toUpperCase() : '?'
}

interface UserSelectorProps {
	users: OrgMember[]
	onSelect: (userId: string) => void
	selectedUserId?: string | null
	placeholder?: string
	className?: string
	disabled?: boolean
}

export function UserSelector({
	users,
	onSelect,
	placeholder = 'Add a user...',
	className,
	disabled = false,
	selectedUserId = null,
}: UserSelectorProps) {
	const [open, setOpen] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const listboxId = 'user-selector-listbox'
	const selectedUser = selectedUserId ? users.find((user) => user.id === selectedUserId) : undefined
	const selectedUserName = selectedUser
		? [selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(' ') || selectedUser.email
		: undefined

	const handleSelect = (userId: string) => {
		onSelect(userId)
		setOpen(false)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					ref={buttonRef}
					variant="outline"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					disabled={disabled || users.length === 0}
					className={cn(
						'w-full justify-between font-normal normal-case tracking-normal group text-muted-foreground',
						className,
					)}
					onKeyDown={(e) => {
						if (e.metaKey || e.ctrlKey) return
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							e.stopPropagation()
							setOpen((o) => !o)
						}
					}}
				>
					<span className={cn('truncate', selectedUserName && 'text-foreground')}>
						{selectedUserName ?? placeholder}
					</span>
					<ChevronsUpDown className="h-4 w-4 ml-2 shrink-0 stroke-accent group-hover:stroke-background" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="max-h-[min(16rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
				align="start"
				collisionPadding={16}
			>
				<Command>
					<CommandInput placeholder="Search users..." />
					<CommandList id={listboxId} className="max-h-52 overflow-y-auto overscroll-contain">
						<CommandEmpty>{users.length === 0 ? 'No users available' : 'No users found'}</CommandEmpty>
						<CommandGroup>
							{users.map((member) => {
								const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ')
								const displayName = fullName || member.email
								const initials = getUserInitials(member.firstName, member.lastName, member.email)

								return (
									<CommandItem
										key={member.id}
										value={`${fullName} ${member.email}`}
										onSelect={() => handleSelect(member.id)}
										className="group"
									>
										<Avatar className="h-6 w-6 mr-2 shrink-0">
											<AvatarImage src={member.profilePictureUrl ?? ''} alt={displayName} />
											<AvatarFallback className="text-xs">{initials}</AvatarFallback>
										</Avatar>
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="text-sm truncate">{displayName}</span>
											{fullName && (
												<span className="text-xs text-muted-foreground group-data-[selected=true]:text-background truncate">
													{member.email}
												</span>
											)}
										</div>
										<Check
											className={cn(
												'ml-auto h-4 w-4 shrink-0',
												member.id === selectedUserId ? 'opacity-100' : 'opacity-0',
											)}
										/>
									</CommandItem>
								)
							})}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}
