import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'

import { useMountEffect } from '@/hooks/useMountEffect'

export const Route = createFileRoute('/_app/auth/signout')({
	component: RouteComponent,
})

function RouteComponent() {
	const { signOut } = useAuth()
	useMountEffect(() => {
		signOut({ returnTo: window.location.origin })
	})
	return null
}
