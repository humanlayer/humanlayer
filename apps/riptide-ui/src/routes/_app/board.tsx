import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { BoardPage } from '@/minimalist/components/BoardPage'

export const Route = createFileRoute('/_app/board')({
	component: BoardRoute,
})

/** The minimalist board; the standard interface has its own on the tasks page. */
function BoardRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return <BoardPage />
	return <Navigate to="/" />
}
