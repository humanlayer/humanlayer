import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle, ExternalLink, Globe, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { RemoveDomainDialog } from '@/components/settings/RemoveDomainDialog'

function getStatusBadge(state: string) {
	switch (state) {
		case 'verified':
			return (
				<Badge variant="default" className="gap-1">
					<CheckCircle className="h-3 w-3" />
					Verified
				</Badge>
			)
		case 'pending':
			return (
				<Badge variant="secondary" className="gap-1">
					<AlertCircle className="h-3 w-3" />
					Pending
				</Badge>
			)
		default:
			return null
	}
}

export function OrganizationDomainsSection() {
	const { queryClient: apiQueryClient } = useRiptideApi()
	const [newDomain, setNewDomain] = useState('')
	const [isAddingDomain, setIsAddingDomain] = useState(false)
	const [alertDialogOpen, setAlertDialogOpen] = useState(false)
	const [domainToRemove, setDomainToRemove] = useState<{ domain: string; isVerified: boolean } | null>(null)

	const organizationQuery = useQuery(
		apiQueryClient.auth.organizations.getCurrent.queryOptions({
			input: {},
			refetchInterval: 30_000,
		}),
	)

	const generatePortalLinkMutation = useMutation(
		apiQueryClient.auth.admin.organizations.generatePortalLink.mutationOptions({
			onSuccess: (data) => {
				window.location.href = data.link
			},
			onError: (error) => {
				console.error('Failed to generate portal link:', error)
				Sentry.captureException(error instanceof Error ? error : new Error('Failed to generate portal link'), {
					tags: { action: 'generate_portal_link' },
				})
				toast.error('Unable to generate verification link. Please try again.')
			},
		}),
	)

	const addDomainMutation = useMutation(
		apiQueryClient.auth.admin.organizations.addDomain.mutationOptions({
			onSuccess: () => {
				toast.success('Domain added successfully')
				setNewDomain('')
				setIsAddingDomain(false)
				void organizationQuery.refetch()
			},
			onError: (error) => {
				console.error('Failed to add domain:', error)
				if (!isDefinedError(error)) {
					Sentry.captureException(error instanceof Error ? error : new Error('Failed to add domain'), {
						tags: { action: 'add_domain' },
					})
					toast.error(error.message || 'Unable to add domain. Please try again.')
					return
				}
				Sentry.captureException(error, {
					tags: { action: 'add_domain', error_code: error.code },
				})
				if (error.code === 'DOMAIN_LIMIT_EXCEEDED') {
					toast.error('Maximum domain limit reached (5 domains)')
				} else if (error.code === 'DOMAIN_ALREADY_EXISTS') {
					toast.error('This domain already exists in your organization')
				} else if (error.code === 'INVALID_DOMAIN') {
					toast.error(error.data?.message || 'Invalid domain')
				} else {
					toast.error(error.message || 'Unable to add domain. Please try again.')
				}
			},
		}),
	)

	const removeDomainMutation = useMutation(
		apiQueryClient.auth.admin.organizations.removeDomain.mutationOptions({
			onSuccess: () => {
				toast.success('Domain removed successfully')
				setAlertDialogOpen(false)
				setDomainToRemove(null)
				void organizationQuery.refetch()
			},
			onError: (error) => {
				console.error('Failed to remove domain:', error)
				if (isDefinedError(error) && error.code === 'DOMAIN_NOT_FOUND') {
					Sentry.captureException(error, {
						tags: { action: 'remove_domain', error_code: error.code },
					})
					toast.error('Domain not found. It may have already been removed.')
				} else {
					Sentry.captureException(error instanceof Error ? error : new Error('Failed to remove domain'), {
						tags: { action: 'remove_domain' },
					})
					toast.error(error.message || 'Unable to remove domain. Please try again.')
				}
				setAlertDialogOpen(false)
				setDomainToRemove(null)
			},
		}),
	)

	const handleAddDomain = () => {
		if (!newDomain) return

		const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i
		if (!domainRegex.test(newDomain)) {
			toast.error('Please enter a valid domain (e.g., example.com)')
			return
		}

		const consumerDomains = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']
		if (consumerDomains.includes(newDomain.toLowerCase())) {
			toast.error('Consumer email domains are not allowed')
			return
		}

		addDomainMutation.mutate({ domain: newDomain })
	}

	const domains = organizationQuery.data?.domains || []
	const canAddMoreDomains = domains.length < 5

	return (
		<>
			<section>
				<div className="mb-4">
					<h2 className="text-base font-semibold">Organization Domains</h2>
					<p className="text-sm text-muted-foreground">
						Manage domains for your organization. Verified domains enable SSO and improve security.
						{domains.length > 0 && ` (${domains.length}/5 domains)`}
					</p>
				</div>
				<div className="max-w-2xl space-y-4">
					{domains.length === 0 ? (
						<div className="rounded-lg border border-dashed p-8 text-center">
							<Globe className="mx-auto h-12 w-12 text-muted-foreground/50" />
							<p className="mt-2 text-sm text-muted-foreground">
								No domains configured. Add your first domain to enable SSO.
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{domains.map((domain) => (
								<div
									key={domain.domain}
									className="flex items-center justify-between rounded-lg border px-4 py-2"
								>
									<div className="flex items-center gap-3">
										<Globe className="h-4 w-4 text-muted-foreground" />
										<span className="text-sm">{domain.domain}</span>
										{getStatusBadge(domain.state)}
									</div>
									<div className="flex items-center gap-2">
										{domain.state === 'pending' && (
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													generatePortalLinkMutation.mutate({
														intent: 'domain_verification',
													})
												}
												disabled={generatePortalLinkMutation.isPending}
											>
												{generatePortalLinkMutation.isPending ? 'Loading...' : 'Verify'}
												<ExternalLink className="ml-2 h-3 w-3" />
											</Button>
										)}
										<Button
											size="sm"
											variant="ghost"
											className=" hover:text-destructive focus:ring-destructive hover:border-destructive hover:bg-destructive/20 text-destructive"
											onClick={() => {
												setDomainToRemove({
													domain: domain.domain,
													isVerified: domain.state === 'verified',
												})
												setAlertDialogOpen(true)
											}}
											disabled={removeDomainMutation.isPending}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
						</div>
					)}

					{canAddMoreDomains &&
						(isAddingDomain ? (
							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="new-domain">New Domain</Label>
									<div className="flex gap-2">
										<Input
											id="new-domain"
											type="text"
											placeholder="example.com"
											value={newDomain}
											onChange={(e) => setNewDomain(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === 'Enter') handleAddDomain()
											}}
											disabled={addDomainMutation.isPending}
										/>
										<Button
											onClick={handleAddDomain}
											disabled={!newDomain || addDomainMutation.isPending}
										>
											{addDomainMutation.isPending ? 'Adding...' : 'Add Domain'}
										</Button>
										<Button
											variant="outline"
											onClick={() => {
												setIsAddingDomain(false)
												setNewDomain('')
											}}
											disabled={addDomainMutation.isPending}
										>
											Cancel
										</Button>
									</div>
									<p className="text-xs text-muted-foreground">
										Enter a domain name without http:// or https://
									</p>
								</div>
							</div>
						) : (
							<Button variant="outline" onClick={() => setIsAddingDomain(true)}>
								<Plus className="mr-2 h-4 w-4" />
								Add Domain
							</Button>
						))}

					{!canAddMoreDomains && (
						<div className="rounded-lg bg-muted/50 p-3">
							<p className="text-sm text-muted-foreground">
								Maximum domain limit reached (5 domains). Remove an existing domain to add a new one.
							</p>
						</div>
					)}
				</div>
			</section>

			<RemoveDomainDialog
				open={alertDialogOpen}
				onOpenChange={setAlertDialogOpen}
				domainToRemove={domainToRemove}
				onConfirm={() => {
					if (domainToRemove) {
						removeDomainMutation.mutate({ domain: domainToRemove.domain })
					}
				}}
				isPending={removeDomainMutation.isPending}
			/>
		</>
	)
}
