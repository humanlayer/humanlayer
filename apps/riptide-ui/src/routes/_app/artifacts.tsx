import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { ArtifactsPage } from '@/minimalist/components/ArtifactsPage'

export const Route = createFileRoute('/_app/artifacts')({
	component: ArtifactsRoute,
})

/** The artifact list exists only in the minimalist interface. */
function ArtifactsRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return <ArtifactsPage />
	return <Navigate to="/" />
}
