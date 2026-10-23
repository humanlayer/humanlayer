import { createFileRoute } from '@tanstack/react-router'

import { TasksListPage } from '@/components/TasksListPage'

export const Route = createFileRoute('/tasks/')({
	component: TasksListPage,
})
