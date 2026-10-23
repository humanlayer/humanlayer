import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect } from 'react'

export const Route = createFileRoute('/callback')({
	component: RouteComponent,
})

function RouteComponent() {
	const { user, isLoading } = useAuth()
	const navigate = useNavigate()
	useEffect(() => {
		if (user && !isLoading) navigate({ to: '/sessions' })
		else {
			console.log('unable to redirect', user, isLoading)
		}
	}, [user, isLoading])
	return (
		<div className="flex h-screen items-center justify-center bg-background">
			<div className="text-center max-w-md px-4">
				<SyncGridAnimation variant="snake" speed={120} className="mx-auto w-8 text-primary" />
				<p className="mt-4 text-muted-foreground">Signing in…</p>
				<Button
					variant="secondary"
					className="mt-4 w"
					type="button"
					onClick={() => navigate({ to: '/auth/signin' })}
				>
					Try again
				</Button>
			</div>
		</div>
	)
}
