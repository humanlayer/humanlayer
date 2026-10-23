import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { SharedArtifactRoute } from '@/components/shared-artifact/SharedArtifactRoute'
import { optionalBooleanSearchParam } from '@/lib/search-params'

const sharedArtifactSearchSchema = z.object({
	key: z.string().optional(),
	// Comment and heading links the shared viewer copies (see ArtifactViewerV2).
	artifactId: z.string().optional(),
	comment: z.string().optional(),
	headingId: z.string().optional(),
	fullscreen: optionalBooleanSearchParam,
})

export const Route = createFileRoute('/shared/artifacts/$artifactId')({
	validateSearch: sharedArtifactSearchSchema,
	component: SharedArtifactPage,
})

function SharedArtifactPage() {
	const { artifactId } = Route.useParams()
	const { key } = Route.useSearch()
	return <SharedArtifactRoute artifactId={artifactId} shareKey={key} />
}
