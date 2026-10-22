import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/archive')({
	component: ArchiveLayout,
})

function ArchiveLayout() {
	return <Outlet />
}
