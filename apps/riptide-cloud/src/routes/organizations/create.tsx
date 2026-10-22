import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { normalizeOrganizationDomain } from '@humanlayer/ui/lib/organization-domain'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { createApiClient } from '@/api/client'
import { env } from '@/env'
import { useSwitchOrganization } from '@/hooks/useSwitchOrganization'
import { consumeAuthReturnTo } from '@/utils/auth-route-state'

export const Route = createFileRoute('/organizations/create')({
	component: OrganizationCreatePage,
})

function OrganizationCreationBlocked() {
	const navigate = useNavigate()
	return (
		<div className="flex h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md p-4">
				<CardHeader>
					<Button
						variant="ghost"
						size="sm"
						className="w-fit -ml-2 mb-2"
						onClick={() => navigate({ to: '/organizations/select' })}
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
					<CardTitle className="font-mono uppercase tracking-wider">Organization Signups Closed</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4 text-sm text-muted-foreground">
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
				</CardContent>
			</Card>
		</div>
	)
}

// HumanLayer staff (humanlayer.dev / humanlayer.com) may still create orgs even
// when new org creation is blocked for the environment.
function isHumanlayerStaffEmail(email: string | undefined): boolean {
	const domain = email?.split('@')[1]?.toLowerCase()
	return domain === 'humanlayer.dev' || domain === 'humanlayer.com'
}

function OrganizationCreatePage() {
	const { user } = useAuth()
	if (env.blockNewOrgCreation && !isHumanlayerStaffEmail(user?.email)) {
		return <OrganizationCreationBlocked />
	}
	return <OrganizationCreateForm />
}

function OrganizationCreateForm() {
	const { getAccessToken } = useAuth()
	const switchToOrganization = useSwitchOrganization()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { client, queryClient: apiQueryClient } = createApiClient(getAccessToken)
	const [name, setName] = useState('')
	const [domains, setDomains] = useState<string[]>([])
	const [inviteEmails, setInviteEmails] = useState('')
	const [eulaAccepted, setEulaAccepted] = useState(false)

	const addDomain = () => {
		if (domains.length < 5) {
			setDomains([...domains, ''])
		}
	}

	const removeDomain = (index: number) => {
		setDomains(domains.filter((_, i) => i !== index))
	}

	const updateDomain = (index: number, value: string) => {
		const updated = [...domains]
		updated[index] = value
		setDomains(updated)
	}

	const createMutation = useMutation({
		mutationFn: async ({
			name: orgName,
			domains: orgDomains,
			inviteEmails: rawEmails,
		}: {
			name: string
			domains: string[]
			inviteEmails: string
		}) => {
			const parsedEmails = rawEmails
				.split(/[\s,]+/)
				.map((e) => e.trim())
				.filter((e) => e.includes('@'))
			const result = await client.auth.user.organizations.create({
				name: orgName,
				domains: orgDomains.map(normalizeOrganizationDomain).filter((domain) => domain.length > 0),
				eulaAccepted: true,
				inviteEmails: parsedEmails,
			})
			return result
		},
		onSuccess: async (data) => {
			if (data.failedInvites && data.failedInvites.length > 0) {
				toast.warning(
					`Organization created, but ${data.failedInvites.length} invite(s) failed. Manage invitations at /admin/invitations`,
					{ duration: 8000 },
				)
			} else {
				toast.success('Organization created!')
			}
			// Invalidate orgs list
			await queryClient.invalidateQueries({
				queryKey: apiQueryClient.auth.user.organizations.list.key({}),
			})
			// Switch to new org
			await switchToOrganization({ organizationId: data.workosOrganizationId })
			const returnTo = consumeAuthReturnTo()
			if (returnTo) {
				await navigate({
					to: returnTo.pathname,
					search: returnTo.search,
					hash: returnTo.hash,
					replace: true,
				} as never)
			} else {
				await navigate({ to: '/artifacts' })
			}
		},
		onError: (error) => {
			console.error('Failed to create org:', error)
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to create organization'), {
				tags: { action: 'org_create' },
			})
			toast.error(error?.message || 'Failed to create organization')
		},
	})

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (!name.trim()) {
			toast.error('Organization name is required')
			return
		}
		createMutation.mutate({ name: name.trim(), domains, inviteEmails })
	}

	return (
		<div className="flex h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md p-4">
				<CardHeader>
					<Button
						variant="ghost"
						size="sm"
						className="w-fit -ml-2 mb-2"
						onClick={() => navigate({ to: '/organizations/select' })}
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
					<CardTitle className="font-mono uppercase tracking-wider">Create Organization</CardTitle>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">Organization Name</Label>
							<Input
								id="name"
								placeholder="My Company"
								value={name}
								onChange={(e) => setName(e.target.value)}
								disabled={createMutation.isPending}
							/>
						</div>

						<div className="space-y-2">
							<Label>Domains (optional)</Label>
							{domains.map((domain, index) => (
								<div key={index} className="flex gap-2">
									<Input
										placeholder="example.com"
										value={domain}
										onChange={(e) => updateDomain(index, e.target.value)}
										disabled={createMutation.isPending}
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => removeDomain(index)}
										disabled={createMutation.isPending}
									>
										<X className="h-4 w-4" />
									</Button>
								</div>
							))}
							{domains.length < 5 && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={addDomain}
									disabled={createMutation.isPending}
								>
									<Plus className="h-4 w-4 mr-1" />
									Add Domain
								</Button>
							)}
							<p className="text-xs text-muted-foreground">{domains.length}/5 domains</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="inviteEmails">Invite Team Members (optional)</Label>
							<Textarea
								id="inviteEmails"
								placeholder={'alice@example.com\nbob@example.com'}
								value={inviteEmails}
								onChange={(e) => setInviteEmails(e.target.value)}
								disabled={createMutation.isPending}
								rows={3}
							/>
							<p className="text-xs text-muted-foreground">
								Separate emails with commas, spaces, or new lines
							</p>
							<p className="text-xs text-muted-foreground">
								Starter is free while your team has three or fewer active members. You can invite up to
								two teammates now; larger teams can upgrade after setup.
							</p>
						</div>

						<div className="flex items-center space-x-2 py-2">
							<Checkbox
								id="eula-accepted"
								checked={eulaAccepted}
								onCheckedChange={(checked) => setEulaAccepted(checked === true)}
								disabled={createMutation.isPending}
							/>
							<Label htmlFor="eula-accepted" className="text-sm text-muted-foreground cursor-pointer">
								I agree to the{' '}
								<a
									href="https://humanlayer.dev/legal/eula"
									target="_blank"
									rel="noopener noreferrer"
									className="underline text-foreground hover:text-primary"
								>
									End User License Agreement
								</a>
							</Label>
						</div>

						<Button type="submit" className="w-full" disabled={createMutation.isPending || !eulaAccepted}>
							{createMutation.isPending ? (
								<>
									<SyncGridAnimation variant="snake" size="sm" speed={120} className="mr-2" />
									Creating...
								</>
							) : (
								'Create Organization'
							)}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}
