import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { ProjectCreatePage } from '@/components/projects/ProjectCreatePage'

const projectCreateSearchSchema = z.object({ onboarding: z.boolean().optional() })

export const Route = createFileRoute('/settings/projects_/new')({
	validateSearch: projectCreateSearchSchema,
	component: ProjectCreateRoute,
})

function ProjectCreateRoute() {
	const { onboarding } = Route.useSearch()
	return <ProjectCreatePage onboarding={onboarding} />
}
