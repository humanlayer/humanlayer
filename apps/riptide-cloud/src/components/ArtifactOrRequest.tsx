import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync } from '@/providers/SyncProvider'

import { ArtifactViewer } from './ArtifactViewer'
import { RequestAccessFlow } from './RequestAccessFlow'

export function ArtifactOrRequest({ artifactId }: { artifactId: string }) {
	const { isLoading, user } = useAuth()

	if (isLoading) return <ArtifactLoading />
	// Canonical artifact URLs require authentication. AuthEnforcer redirects this state;
	// keep the artifact lookup hidden while that navigation completes.
	if (!user) return <ArtifactLoading />

	return <AuthedArtifactOrRequest artifactId={artifactId} />
}

function AuthedArtifactOrRequest({ artifactId }: { artifactId: string }) {
	const { artifactsCollection } = useSync()
	const { data, isError, isLoading } = useLiveQuery(
		(q) => q.from({ artifacts: artifactsCollection }).where(({ artifacts }) => eq(artifacts.id, artifactId)),
		[artifactsCollection, artifactId],
	)

	const artifact = data?.[0]

	if (artifact) return <ArtifactViewer artifactId={artifactId} artifact={artifact} />

	if (isError) {
		return (
			<div className="flex items-center justify-center h-full">
				<Card className="p-8 text-center max-w-md">
					<p className="text-destructive mb-4">Failed to load artifact</p>
					<Button variant="outline" onClick={() => window.location.reload()}>
						Retry
					</Button>
				</Card>
			</div>
		)
	}

	if (isLoading) return <ArtifactLoading />

	return <RequestAccessFlow artifactId={artifactId} />
}

function ArtifactLoading() {
	return (
		<div className="flex items-center justify-center h-full">
			<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
		</div>
	)
}
