import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { useMountEffect } from '@/hooks/useMountEffect'
import { sharedArtifactAppUrl } from '@/lib/shared-artifact-links'

const sharedArtifactSearchSchema = z.object({ key: z.string().optional() })

export const Route = createFileRoute('/shared/artifacts/$artifactId')({
	validateSearch: sharedArtifactSearchSchema,
	component: LegacySharedArtifactRedirect,
})

function LegacySharedArtifactRedirect() {
	const { artifactId } = Route.useParams()
	const { key } = Route.useSearch()
	useMountEffect(() => {
		window.location.replace(sharedArtifactAppUrl(artifactId, key))
	})

	return (
		<div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
			<div className="flex items-center gap-3 text-sm text-muted-foreground">
				<SyncGridAnimation variant="snake" speed={120} className="w-8" />
				<span>Opening shared artifact…</span>
			</div>
		</div>
	)
}
