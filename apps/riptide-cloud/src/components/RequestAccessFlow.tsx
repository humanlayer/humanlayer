import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { isDefinedError } from '@orpc/client'
import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import { AccessibleNowRedirect } from './AccessibleNowRedirect'
import { InvitationPendingScreen } from './InvitationPendingScreen'
import { RequestAccessScreen } from './RequestAccessScreen'
import { RequestPendingScreen } from './RequestPendingScreen'
import { ResourceNotFound } from './ResourceNotFound'
import { SwitchOrganizationPrompt } from './SwitchOrganizationPrompt'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function RequestAccessFlow({ artifactId }: { artifactId: string }) {
	const { queryClient } = useRiptideApi()
	const lookupQuery = useQuery({
		...queryClient.public.artifacts.info.queryOptions({ input: { artifactId } }),
		enabled: uuidRegex.test(artifactId),
		retry: false,
	})

	if (!uuidRegex.test(artifactId)) return <ResourceNotFound />

	if (lookupQuery.isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
			</div>
		)
	}

	if (lookupQuery.isError) {
		if (isDefinedError(lookupQuery.error) && lookupQuery.error.code === 'NOT_FOUND') {
			return <ResourceNotFound />
		}

		return (
			<div className="flex items-center justify-center h-full">
				<Card className="p-8 text-center max-w-md">
					<p className="text-destructive mb-4">Failed to check artifact access</p>
					<Button variant="outline" onClick={() => lookupQuery.refetch()}>
						Retry
					</Button>
				</Card>
			</div>
		)
	}

	const lookup = lookupQuery.data
	if (!lookup) return <ResourceNotFound />
	if (lookup.accessible === true) {
		if (lookup.requiresOrgSwitch === true) {
			return (
				<SwitchOrganizationPrompt
					workosOrganizationId={lookup.workosOrganizationId}
					organizationName={lookup.organizationName}
				/>
			)
		}
		return <AccessibleNowRedirect />
	}
	switch (lookup.myRequestStatus) {
		case 'pending':
			return <RequestPendingScreen artifactId={artifactId} lookup={lookup} />
		case 'invited':
			return <InvitationPendingScreen lookup={lookup} />
		case 'archived':
		case 'none':
			return <RequestAccessScreen artifactId={artifactId} lookup={lookup} />
	}
}
