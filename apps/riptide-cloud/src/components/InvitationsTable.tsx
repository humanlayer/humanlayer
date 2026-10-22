import { InvitationsTable as InvitationsTablePresentation } from '@humanlayer/ui/administration/InvitationsTable'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'

export function InvitationsTable({ onOpenInviteDialog }: { onOpenInviteDialog: () => void }) {
	const { client, queryClient: api } = useRiptideApi()
	const cache = useQueryClient()
	const invitations = useQuery({
		...api.auth.admin.invitations.list.queryOptions({ input: {} }),
		refetchInterval: 30_000,
	})
	const revoke = useMutation({
		mutationFn: (invitationId: string) => client.auth.admin.invitations.revoke({ invitationId }),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: api.auth.admin.invitations.list.key() })
			toast.success('Invitation revoked')
		},
		onError: (error) => {
			Sentry.captureException(error, { tags: { action: 'revoke_invitation' } })
			toast.error('Failed to revoke invitation')
		},
	})

	return (
		<InvitationsTablePresentation
			invitations={invitations.data?.invitations ?? []}
			isLoading={invitations.isLoading}
			error={invitations.error}
			isRevokePending={revoke.isPending}
			onRetry={() => void invitations.refetch()}
			onRevoke={(invitationId) => revoke.mutate(invitationId)}
			onOpenInviteDialog={onOpenInviteDialog}
		/>
	)
}
