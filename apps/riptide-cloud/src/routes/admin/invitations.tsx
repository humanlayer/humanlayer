import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'
import z from 'zod/v4'

import { AccessRequestsTable } from '@/components/AccessRequestsTable'
import { InvitationForm } from '@/components/InvitationForm'
import { InvitationsTable } from '@/components/InvitationsTable'

const invitationsSearchSchema = z.object({
	invite: z.string().optional(),
})

export const Route = createFileRoute('/admin/invitations')({
	validateSearch: invitationsSearchSchema,
	component: AdminInvitationsPage,
})

function AdminInvitationsPage() {
	const { isLoading, roles } = useAuth()
	const navigate = useNavigate()
	const { invite } = Route.useSearch()
	const [localDialog, setLocalDialog] = useState<{ open: boolean; email?: string }>({ open: false })

	const dialogOpen = localDialog.open || !!invite
	const defaultEmail = localDialog.open ? localDialog.email : invite

	if (isLoading) return null

	if (!roles?.includes('admin')) {
		navigate({ to: '/artifacts' })
		return null
	}

	const openInviteDialog = (email?: string) => {
		setLocalDialog({ open: true, email })
	}

	const handleDialogOpenChange = (open: boolean) => {
		setLocalDialog({ open, email: open ? localDialog.email : undefined })
		if (!open && invite) {
			navigate({ to: '/admin/invitations', search: {} })
		}
	}

	return (
		<div className="p-6 space-y-6">
			<div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
				<AccessRequestsTable onOpenInviteDialog={(email) => openInviteDialog(email)} />
				<InvitationsTable onOpenInviteDialog={() => openInviteDialog()} />
			</div>
			<Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Send Invitation</DialogTitle>
						<DialogDescription>Invite a new user to join your organization</DialogDescription>
					</DialogHeader>
					<InvitationForm
						key={`${defaultEmail ?? ''}:${dialogOpen}`}
						defaultEmail={defaultEmail}
						onSubmitted={() => handleDialogOpenChange(false)}
					/>
				</DialogContent>
			</Dialog>
		</div>
	)
}
