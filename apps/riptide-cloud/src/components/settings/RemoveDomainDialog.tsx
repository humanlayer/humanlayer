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

interface RemoveDomainDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	domainToRemove: { domain: string; isVerified: boolean } | null
	onConfirm: () => void
	isPending: boolean
}

export function RemoveDomainDialog({
	open,
	onOpenChange,
	domainToRemove,
	onConfirm,
	isPending,
}: RemoveDomainDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{domainToRemove?.isVerified ? 'Remove Verified Domain?' : 'Remove Domain?'}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{domainToRemove?.isVerified ? (
							<>
								<strong>Warning:</strong> Removing the verified domain{' '}
								<strong>{domainToRemove.domain}</strong> will:
								<ul className="mt-2 list-disc list-inside space-y-1">
									<li>
										Prevent users with this email domain from automatically joining your
										organization
									</li>
									<li>Disable SSO for users from this domain</li>
									<li>Require manual invitations for new users from this domain</li>
								</ul>
								<p className="mt-3">
									This action cannot be undone. You'll need to re-verify the domain if you want to add
									it back.
								</p>
							</>
						) : (
							<>
								Are you sure you want to remove <strong>{domainToRemove?.domain}</strong>? This domain
								hasn't been verified yet.
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className={
							domainToRemove?.isVerified
								? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
								: ''
						}
					>
						{isPending ? 'Removing...' : 'Remove Domain'}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
