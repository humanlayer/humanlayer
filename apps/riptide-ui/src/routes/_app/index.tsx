import { createFileRoute } from '@tanstack/react-router'
import z from 'zod/v4'

import { sessionsSearchSchema } from '@/components/sessions-page/sessionsRoute'
import { SessionsRoutePage } from '@/components/sessions-page/SessionsRoutePage'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { NewTask } from '@/minimalist/components/NewTask'

// `project` and `dir` preselect where the minimalist home launches, from a sidebar project's pencil.
const indexSearchSchema = sessionsSearchSchema.extend({
	project: z.string().optional(),
	dir: z.string().optional(),
	host: z.string().optional(),
})

export const Route = createFileRoute('/_app/')({
	validateSearch: indexSearchSchema,
	component: AppIndexRoute,
})

function AppIndexRoute() {
	const { tab, task, project, dir, host } = Route.useSearch()
	const minimalist = useMinimalistLayout()
	if (minimalist)
		return (
			<NewTask
				key={task ?? project ?? dir ?? 'new'}
				existingTaskId={task}
				projectId={project}
				directory={dir}
				hostId={host}
			/>
		)
	return <SessionsRoutePage tab={tab} routeTo="/" />
}
