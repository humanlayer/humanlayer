import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/context-shards/')({
	beforeLoad: () => {
		throw redirect({ to: '/', search: { tab: 'context-shards' } })
	},
})
