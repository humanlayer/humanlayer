import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { PullRequestsPage } from '@/minimalist/components/PullRequestsPage'

export const Route = createFileRoute('/_app/pull-requests')({
	component: PullRequestsRoute,
})

/** The pull request inbox exists only in the minimalist interface. */
function PullRequestsRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return <PullRequestsPage />
	return <Navigate to="/" />
}
