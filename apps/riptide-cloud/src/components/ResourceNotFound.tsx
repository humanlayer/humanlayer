import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { FileQuestion } from 'lucide-react'

import { OrganizationSwitcher } from './OrganizationSwitcher'

export function ResourceNotFound() {
	const { isLoading, user } = useAuth()

	return (
		<div className="flex items-center justify-center h-full">
			<Card className="p-8 text-center max-w-md">
				<FileQuestion className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
				<h2 className="font-mono uppercase tracking-wider mb-2">Artifact Not Found</h2>
				{!isLoading && user && (
					<>
						<p className="text-sm text-muted-foreground mb-6">
							This artifact may be in a different organization.
						</p>
						<div className="flex flex-col gap-3 items-center">
							<OrganizationSwitcher />
							<Button variant="ghost" size="sm" asChild>
								<Link to="/tasks">Back to Tasks</Link>
							</Button>
						</div>
					</>
				)}
			</Card>
		</div>
	)
}
