import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
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
import { useAuth } from '@workos-inc/authkit-react'
import { AlertTriangle, UserRoundCog } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useOptimisticMutation } from '@/hooks/useOptimisticMutation'
import { useActiveOrgMembers } from '@/hooks/useOrgMembers'
import { useTaskActions } from '@/hooks/useTaskActions'
import { captureException } from '@/integrations/sentry/sentry'

import { UserSelector } from './UserSelector'

export interface OwnerReassignmentDialogProps {
	open: boolean
	taskId: string
	taskName: string
	currentOwnerUserId: string
	onOpenChange: (open: boolean) => void
}

export function OwnerReassignmentDialog(props: OwnerReassignmentDialogProps) {
	return <OwnerReassignmentDialogContent key={props.open ? 'open' : 'closed'} {...props} />
}

function OwnerReassignmentDialogContent({
	open,
	taskId,
	taskName,
	currentOwnerUserId,
	onOpenChange,
}: OwnerReassignmentDialogProps) {
	const { user } = useAuth()
	const taskActions = useTaskActions()
	const { members } = useActiveOrgMembers()
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [ownerUserId] = useState(currentOwnerUserId)
	const eligibleMembers = members.filter((member) => member.id !== ownerUserId)
	const reassignment = useOptimisticMutation(taskActions.reassignTaskOwner, {
		onSuccess: () => {
			toast.success('Task owner reassigned')
			onOpenChange(false)
		},
		onError: (error, input) => {
			captureException(error, {
				extra: {
					action: 'reassignTaskOwner',
					taskId: input.taskId,
					newOwnerUserId: input.newOwnerUserId,
					userId: user?.id,
				},
			})
		},
	})
	const errorMessage = reassignment.isError
		? reassignment.error instanceof Error
			? reassignment.error.message
			: 'Ownership could not be reassigned. Try again.'
		: null

	const handleOpenChange = (nextOpen: boolean) => {
		if (reassignment.isPending) return
		onOpenChange(nextOpen)
	}

	const handleConfirm = () => {
		if (!selectedUserId || reassignment.isPending) return
		reassignment.mutate({ taskId, newOwnerUserId: selectedUserId })
	}

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleConfirm()
		},
		{
			enabled: open && selectedUserId !== null && !reassignment.isPending,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_OWNER_REASSIGNMENT_DIALOG],
		},
		[open, selectedUserId, reassignment.isPending, handleConfirm],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleOpenChange(false)
		},
		{
			enabled: open && !reassignment.isPending,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_OWNER_REASSIGNMENT_DIALOG],
		},
		[open, reassignment.isPending, handleOpenChange],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.TASK_OWNER_REASSIGNMENT_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="OwnerReassignmentDialog"
		>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent
					className="w-[calc(100vw-2rem)] max-w-md gap-0 overflow-visible p-0"
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader className="min-w-0 border-b px-5 py-4">
						<DialogTitle className="flex min-w-0 items-center gap-2 text-base">
							<UserRoundCog className="h-4 w-4 text-accent" />
							Reassign task owner
						</DialogTitle>
						<DialogDescription className="min-w-0 break-words">
							Choose a new owner for {taskName}.
						</DialogDescription>
					</DialogHeader>

					<div className="min-w-0 space-y-3 bg-muted/20 px-5 py-4 text-sm">
						<UserSelector
							users={eligibleMembers}
							selectedUserId={selectedUserId}
							placeholder="Select a new owner..."
							disabled={reassignment.isPending}
							onSelect={(userId) => {
								setSelectedUserId(userId)
								reassignment.reset()
							}}
						/>
						<div className="flex min-w-0 gap-2 border border-[var(--terminal-warning)]/35 bg-[var(--terminal-warning)]/10 px-3 py-2 text-foreground">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--terminal-warning)]" />
							<p className="min-w-0 break-words">
								This task will be transferred to the new owner. The previous owner will still be able to
								manage their sessions in this task.
							</p>
						</div>
						{errorMessage && (
							<div
								role="alert"
								className="border border-destructive/60 bg-destructive/10 px-3 py-2 text-destructive"
							>
								{errorMessage}
							</div>
						)}
					</div>

					<DialogFooter className="min-w-0 flex-wrap border-t px-5 py-3">
						<Button
							type="button"
							variant="secondary"
							onClick={() => handleOpenChange(false)}
							disabled={reassignment.isPending}
						>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button
							type="button"
							onClick={handleConfirm}
							disabled={!selectedUserId || reassignment.isPending}
						>
							{reassignment.isPending ? 'Reassigning...' : 'Reassign owner'}
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
									? '⌘+ENTER'
									: 'Ctrl+ENTER'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
