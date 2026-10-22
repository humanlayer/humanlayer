import { createFileRoute } from '@tanstack/react-router'

import { sessionsSearchSchema } from '@/components/sessions-page/sessionsRoute'
import { SessionsRoutePage } from '@/components/sessions-page/SessionsRoutePage'

export const Route = createFileRoute('/_app/sessions/')({
	validateSearch: sessionsSearchSchema,
	component: SessionsIndexRoute,
})

function SessionsIndexRoute() {
	const { tab } = Route.useSearch()
	return <SessionsRoutePage tab={tab} routeTo="/sessions" />
}
