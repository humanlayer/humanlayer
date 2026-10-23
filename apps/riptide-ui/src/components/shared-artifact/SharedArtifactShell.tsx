import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import type { PropsWithChildren, ReactNode } from 'react'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { captureAuthReturnToState, storeAuthReturnTo } from '@/utils/auth-route-state'

type SharedArtifactShellProps = PropsWithChildren<{
	title?: string
	action?: ReactNode
	permission?: 'view' | 'comment'
}>

export function SharedArtifactShell({
	children,
	title = 'Shared artifact',
	action,
	permission,
}: SharedArtifactShellProps) {
	const { user } = useAuth()
	const { signIn } = useBrowserAuth()
	const location = useLocation()
	const navigate = useNavigate()

	const handleSignIn = () => {
		storeAuthReturnTo(captureAuthReturnToState(location.pathname, location.search))
		void signIn()
	}

	return (
		<div className="flex min-h-dvh w-full flex-col bg-background text-foreground">
			<header className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-4 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="min-w-0 truncate text-sm font-medium">{title}</span>
					{permission ? (
						<Badge variant="outline">{permission === 'comment' ? 'Can comment' : 'View only'}</Badge>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{action}
					{user ? (
						<Button variant="outline" size="sm" onClick={() => void navigate({ to: '/' })}>
							Open HumanLayer
						</Button>
					) : (
						<Button variant="outline" size="sm" onClick={handleSignIn}>
							Sign in
						</Button>
					)}
				</div>
			</header>
			<main className="flex min-h-0 flex-1">{children}</main>
		</div>
	)
}
