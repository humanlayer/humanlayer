import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { AlertTriangle } from 'lucide-react'

export const Route = createFileRoute('/auth/callback')({
	validateSearch: (search: Record<string, unknown>) => ({
		code: typeof search.code === 'string' ? search.code : '',
	}),
	component: CallbackPage,
})

function CallbackPage() {
	const { user, isLoading } = useAuth()
	const { code } = Route.useSearch()

	if (isLoading || user || !code) return <CallbackStatus />
	return <SigninFailure />
}

function CallbackStatus() {
	return (
		<div className="flex h-screen items-center justify-center">
			<div className="text-center">
				<SyncGridAnimation variant="snake" speed={120} className="mx-auto w-8 text-primary" />
				<p className="mt-4 text-muted-foreground">Completing sign in...</p>
			</div>
		</div>
	)
}

function SigninFailure() {
	return (
		<div className="flex min-h-full items-center justify-center p-6">
			<Card className="w-full max-w-md border-border bg-background p-8 text-center shadow-none">
				<AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />
				<h2 className="mb-2 font-mono uppercase tracking-wider">We couldn't complete sign-in</h2>
				<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
					The sign-in link may have expired or already been used. Start sign-in again to continue.
				</p>
				<Button className="w-full uppercase tracking-wider" asChild>
					<a href="/auth/signin">Try again</a>
				</Button>
			</Card>
		</div>
	)
}
