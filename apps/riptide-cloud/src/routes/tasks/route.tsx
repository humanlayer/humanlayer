import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks')({
	component: TasksLayout,
})

function TasksLayout() {
	return (
		<div className="h-full overflow-auto">
			<Outlet />
		</div>
	)
}
