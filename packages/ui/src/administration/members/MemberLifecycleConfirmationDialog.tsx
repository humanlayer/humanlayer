import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@humanlayer/ui/components/alert-dialog'

import type { OrganizationMember } from '../member'

export type MemberDestructiveAction = 'deactivate' | 'remove'

interface MemberLifecycleConfirmationDialogProps {
	action: MemberDestructiveAction
	email: OrganizationMember['email']
	open: boolean
	pending: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}

export function MemberLifecycleConfirmationDialog({
	action,
	email,
	open,
	pending,
	onOpenChange,
	onConfirm,
}: MemberLifecycleConfirmationDialogProps) {
	const deactivating = action === 'deactivate'
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{deactivating ? 'Deactivate user?' : 'Remove user from organization?'}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{deactivating
							? `Deactivating ${email} prevents them from logging in, revokes active sessions through WorkOS, preserves their membership for later reactivation, and removes them from billing counts.`
							: `This will remove ${email} from your organization. They will lose access to all organization resources, and the membership must be re-created to add them back.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={pending}
						className="bg-background text-destructive border-destructive hover:bg-destructive hover:text-background focus-visible:border-destructive focus-visible:ring-destructive/50"
					>
						{pending
							? deactivating
								? 'Deactivating...'
								: 'Removing...'
							: deactivating
								? 'Deactivate User'
								: 'Remove User'}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
