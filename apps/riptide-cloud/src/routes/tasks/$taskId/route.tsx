import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks/$taskId')({
	component: TaskDetailLayout,
})

function TaskDetailLayout() {
	return (
		<div className="h-full overflow-auto">
			<Outlet />
		</div>
	)
}
