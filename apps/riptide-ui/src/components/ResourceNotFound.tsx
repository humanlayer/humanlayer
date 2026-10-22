import { Button } from '@humanlayer/ui/components/button'
import { Card } from '@humanlayer/ui/components/card'
import { Link } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'
import { useState } from 'react'

import { OrganizationSwitcher } from './OrganizationSwitcher'

interface ResourceNotFoundProps {
	title?: string
	description?: string
	showOrganizationSwitcher?: boolean
	backTo?: {
		label: string
		path: string
	}
}

export function ResourceNotFound({
	title = 'Resource Not Found',
	description = 'This resource may be in a different organization.',
	showOrganizationSwitcher = true,
	backTo,
}: ResourceNotFoundProps) {
	const [isOrgSwitcherOpen, setIsOrgSwitcherOpen] = useState(false)

	return (
		<div className="flex items-center justify-center h-full">
			<Card className="p-8 text-center max-w-md">
				<FileQuestion className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
				<h2 className="font-mono uppercase tracking-wider mb-2">{title}</h2>
				<p className="text-sm text-muted-foreground mb-6">{description}</p>
				<div className="flex flex-col gap-3 items-center">
					{showOrganizationSwitcher && (
						<OrganizationSwitcher isOpen={isOrgSwitcherOpen} setIsOpen={setIsOrgSwitcherOpen} />
					)}
					{backTo && (
						<Button variant="ghost" size="sm" asChild>
							<Link to={backTo.path}>{backTo.label}</Link>
						</Button>
					)}
				</div>
			</Card>
		</div>
	)
}
