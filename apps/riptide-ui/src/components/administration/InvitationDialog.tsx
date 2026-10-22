import { InvitationForm, type CreateInvitationInput } from '@humanlayer/ui/administration/InvitationForm'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { getBillingCheckoutClient } from '@/domains/billing/checkout-client'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { openExternal } from '@/lib/url-opener'
import { useRiptideApi } from '@/orpc/client'

interface InvitationDialogProps {
	open: boolean
	defaultEmail?: string
	description?: string
	onOpenChange: (open: boolean) => void
}

export function InvitationDialog({ open, defaultEmail, description, onOpenChange }: InvitationDialogProps) {
	const { queryClient: api, authScope } = useRiptideApi()
	const cache = useQueryClient()
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [upgradeRequiredMessage, setUpgradeRequiredMessage] = useState<string | null>(null)
	const scope = authScope
	const listKeys = (['pending', 'archived'] as const).map((status) => {
		const options = api.auth.admin.accessRequests.list.queryOptions({ input: { status } })
		return [...options.queryKey, scope]
	})
	const countOptions = api.auth.admin.accessRequests.unreadCount.queryOptions({ input: {} })
	const invitationsKey = [...api.auth.admin.invitations.list.key(), scope]
	const refreshQueue = () =>
		Promise.all([
			...listKeys.map((queryKey) => cache.invalidateQueries({ queryKey })),
			cache.invalidateQueries({ queryKey: [...countOptions.queryKey, scope] }),
		])

	const upgrade = useMutation(
		api.billing.startUpgrade.mutationOptions({
			onSuccess: async (result) => openExternal(result.url),
			onError: (error) => {
				Sentry.captureException(error)
				toast.error('Unable to start upgrade checkout')
			},
		}),
	)
	const create = useMutation(
		api.auth.admin.invitations.create.mutationOptions({
			onSuccess: async () => {
				await Promise.all([cache.invalidateQueries({ queryKey: invitationsKey }), refreshQueue()])
				if (scope.userId === authScope.userId && scope.organizationId === authScope.organizationId) {
					toast.success('Invitation sent')
					onOpenChange(false)
				}
			},
			onError: async (error) => {
				if (isDefinedError(error) && error.code === 'UPGRADE_REQUIRED') {
					setUpgradeRequiredMessage(error.data.message)
					return
				}
				if (isDefinedError(error) && (error.code === 'ALREADY_INVITED' || error.code === 'ALREADY_A_MEMBER')) {
					setErrorMessage(error.data.message)
					await refreshQueue()
					return
				}
				Sentry.captureException(error, { tags: { action: 'create_native_invitation' } })
				setErrorMessage(error.message || 'Failed to send invitation')
			},
		}),
	)

	const submit = (input: CreateInvitationInput) => {
		setErrorMessage(null)
		setUpgradeRequiredMessage(null)
		create.mutate(input)
	}

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.ADMIN_INVITATION_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="AdminInvitationDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent onEscapeKeyDown={(event) => event.stopPropagation()}>
					<DialogHeader>
						<DialogTitle>Send invitation</DialogTitle>
						<DialogDescription>
							{description ?? 'Invite a new user to join your organization.'}
						</DialogDescription>
					</DialogHeader>
					<InvitationForm
						defaultEmail={defaultEmail}
						isPending={create.isPending}
						errorMessage={errorMessage}
						upgradeRequiredMessage={upgradeRequiredMessage}
						isUpgradePending={upgrade.isPending}
						onUpgrade={() =>
							upgrade.mutate({
								checkoutAttemptId: crypto.randomUUID(),
								client: getBillingCheckoutClient(),
							})
						}
						onSubmit={submit}
					/>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
