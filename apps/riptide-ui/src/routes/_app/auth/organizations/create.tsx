import { Card, CardHeader } from '@humanlayer/ui/components/card'
import { Separator } from '@humanlayer/ui/components/separator'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Building2 } from 'lucide-react'

import { OrganizationCreateForm } from '@/components/organizations/OrganizationCreateForm'

// HumanLayer staff (humanlayer.dev / humanlayer.com) may still create orgs even
// when new org creation is blocked for the environment.
function isHumanlayerStaffEmail(email: string | undefined): boolean {
	const domain = email?.split('@')[1]?.toLowerCase()
	return domain === 'humanlayer.dev' || domain === 'humanlayer.com'
}

export const Route = createFileRoute('/_app/auth/organizations/create')({
	component: OrganizationCreatePage,
})

function OrganizationCreationBlocked() {
	return (
		<div className="flex flex-col h-full grow items-center justify-center bg-background">
			<Card className="w-md p-6">
				<CardHeader className="flex flex-col gap-2 w-full items-center text-center">
					<Building2 className="mx-auto mb-4 size-12 text-muted-foreground" />
					<p className="text-xl font-semibold">Organization Signups Closed</p>
				</CardHeader>
				<Separator className="my-4" />
				<div className="flex flex-col gap-4 text-sm text-muted-foreground">
					<p>
						This is the HumanLayer beta environment, which is no longer accepting new organization signups.
					</p>
					<p>
						Please get an invite to your team’s existing org, or create a new organization at{' '}
						<a
							href="https://cloud.humanlayer.com"
							target="_blank"
							rel="noopener noreferrer"
							className="underline text-foreground hover:text-primary"
						>
							cloud.humanlayer.com
						</a>{' '}
						to proceed.
					</p>
					<p>You can uninstall this beta build with</p>
					<pre className="rounded bg-muted px-3 py-2 font-mono text-foreground">
						brew uninstall riptide-beta
					</pre>
				</div>
			</Card>
		</div>
	)
}

function OrganizationCreatePage() {
	const { user } = useAuth()
	const blocked = import.meta.env.VITE_PUBLIC_BLOCK_NEW_ORG_CREATION === 'true'
	if (blocked && !isHumanlayerStaffEmail(user?.email)) {
		return <OrganizationCreationBlocked />
	}
	return (
		<div className="flex flex-col h-full grow items-center justify-center bg-background">
			<Card className="w-md p-6">
				<CardHeader className="flex flex-col gap-2 w-full items-center text-center">
					<Building2 className="mx-auto mb-4 size-12 text-muted-foreground" />
					<p className="text-xl font-semibold">Create Organization</p>
					<p className="text-muted-foreground">Set up a new organization to get started.</p>
				</CardHeader>
				<Separator className="my-4" />
				<OrganizationCreateForm />
			</Card>
		</div>
	)
}
