import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/tasks')({
	component: TasksLayout,
})

function TasksLayout() {
	return <Outlet />
}
