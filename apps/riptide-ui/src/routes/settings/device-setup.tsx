import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/device-setup')({
	beforeLoad: () => {
		throw redirect({ to: '/settings/agent-sign-in' })
	},
})
