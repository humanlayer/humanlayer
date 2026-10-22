import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { ArtifactOrRequest } from '@/components/ArtifactOrRequest'

const artifactDetailSearchSchema = z.object({
	/**
	 * Parity flag with the riptide-ui task route. The cloud artifact-detail route
	 * is already a full-page (fullscreen) surface — cloud has no sidebar viewer —
	 * so this is accepted for URL parity and is effectively always-on here.
	 */
	fullscreen: z.boolean().optional(),
	/** V2 comment deep link: one-shot reveal of a root/reply ID on this artifact. */
	comment: z.string().optional(),
})

export const Route = createFileRoute('/artifacts/$artifactId')({
	validateSearch: artifactDetailSearchSchema,
	component: ArtifactDetailRoute,
})

function ArtifactDetailRoute() {
	const { artifactId } = Route.useParams()
	return <ArtifactOrRequest artifactId={artifactId} />
}
