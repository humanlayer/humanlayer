import {
	InvitationForm as InvitationFormPresentation,
	type CreateInvitationInput,
} from '@humanlayer/ui/administration/InvitationForm'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'

export function InvitationForm({ defaultEmail, onSubmitted }: { defaultEmail?: string; onSubmitted: () => void }) {
	const { queryClient: api } = useRiptideApi()
	const cache = useQueryClient()
	const [upgradeRequiredMessage, setUpgradeRequiredMessage] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const refreshRequestQueue = () =>
		Promise.all([
			cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.list.key() }),
			cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.unreadCount.key() }),
		])

	const startUpgrade = useMutation(
		api.billing.startUpgrade.mutationOptions({
			onSuccess: (result) => window.open(result.url, '_blank', 'noopener,noreferrer'),
			onError: (error) => {
				Sentry.captureException(error)
				toast.error('Unable to start upgrade checkout')
			},
		}),
	)
	const create = useMutation(
		api.auth.admin.invitations.create.mutationOptions({
			onSuccess: async () => {
				setErrorMessage(null)
				setUpgradeRequiredMessage(null)
				toast.success('Invitation sent!')
				await Promise.all([
					cache.invalidateQueries({ queryKey: api.auth.admin.invitations.list.key() }),
					refreshRequestQueue(),
				])
				onSubmitted()
			},
			onError: async (error) => {
				if (isDefinedError(error) && error.code === 'UPGRADE_REQUIRED') {
					setUpgradeRequiredMessage(error.data.message)
					return
				}
				if (isDefinedError(error) && (error.code === 'ALREADY_INVITED' || error.code === 'ALREADY_A_MEMBER')) {
					setErrorMessage(error.data.message)
					await refreshRequestQueue()
					return
				}
				Sentry.captureException(error, { tags: { action: 'create_invitation' } })
				setErrorMessage(error.message || 'Failed to send invitation')
			},
		}),
	)

	return (
		<InvitationFormPresentation
			defaultEmail={defaultEmail}
			isPending={create.isPending}
			errorMessage={errorMessage}
			upgradeRequiredMessage={upgradeRequiredMessage}
			isUpgradePending={startUpgrade.isPending}
			onUpgrade={() => startUpgrade.mutate({ checkoutAttemptId: crypto.randomUUID(), client: 'cloud' })}
			onSubmit={(input: CreateInvitationInput) => create.mutate(input)}
		/>
	)
}
