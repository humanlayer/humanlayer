import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import { useAuth } from '@workos-inc/authkit-react'
import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { OwnerReassignmentDialog } from '@/components/OwnerReassignmentDialog'
import { useTaskOwnerDisplay } from '@/hooks/task-detail/useTaskOwnerDisplay'
import { canReassignTaskOwner } from '@/lib/tasks/can-reassign-task-owner'

interface WiredMobileTaskOwnerControlProps {
	taskId: string
	taskName: string
	resourceOwnerUserId: string
}

export function WiredMobileTaskOwnerControl({
	taskId,
	taskName,
	resourceOwnerUserId,
}: WiredMobileTaskOwnerControlProps) {
	const { user, role, roles } = useAuth()
	const [ownerDialogOpen, setOwnerDialogOpen] = useState(false)
	const ownerDisplay = useTaskOwnerDisplay(resourceOwnerUserId)
	const canReassignOwner = canReassignTaskOwner(resourceOwnerUserId === user?.id, role ?? null, roles ?? [])

	return (
		<>
			<div className="shrink-0 border-b border-border px-4 py-3">
				<div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Owner</div>
				<Button
					type="button"
					variant="ghost"
					className="h-auto max-w-full justify-start gap-2 p-0 text-sm text-muted-foreground hover:bg-transparent hover:text-accent"
					disabled={!canReassignOwner}
					onClick={() => setOwnerDialogOpen(true)}
					aria-label={canReassignOwner ? `Reassign owner ${ownerDisplay.ownerFullName}` : undefined}
				>
					<Avatar className="size-6 shrink-0">
						<AvatarImage
							src={ownerDisplay.ownerMember?.profilePictureUrl ?? ''}
							alt={ownerDisplay.ownerFullName}
						/>
						<AvatarFallback className="text-[9px]">{ownerDisplay.ownerInitials}</AvatarFallback>
					</Avatar>
					<span className="min-w-0 truncate font-mono">{ownerDisplay.ownerFullName}</span>
					{canReassignOwner && <Pencil className="size-3.5 shrink-0 text-accent" />}
				</Button>
			</div>
			{(canReassignOwner || ownerDialogOpen) && (
				<OwnerReassignmentDialog
					open={ownerDialogOpen}
					taskId={taskId}
					taskName={taskName}
					currentOwnerUserId={resourceOwnerUserId}
					onOpenChange={setOwnerDialogOpen}
				/>
			)}
		</>
	)
}
