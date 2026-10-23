import { createFileRoute } from '@tanstack/react-router'

import { TasksListPage } from '@/components/TasksListPage'

export const Route = createFileRoute('/artifacts/')({
	component: TasksListPage,
})
