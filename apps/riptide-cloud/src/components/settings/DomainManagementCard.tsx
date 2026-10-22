import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { Separator } from '@humanlayer/ui/components/separator'
import { AlertCircle, CheckCircle, ExternalLink, Globe, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface Domain {
	domain: string
	state: string
}

interface DomainManagementCardProps {
	domains: Domain[]
	onAddDomain: (domain: string) => void
	onRemoveDomain: (domain: string, isVerified: boolean) => void
	onVerifyDomain: () => void
	isAddingDomain: boolean
	isRemovingDomain: boolean
	isVerifyingDomain: boolean
}

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

export function DomainManagementCard({
	domains,
	onAddDomain,
	onRemoveDomain,
	onVerifyDomain,
	isAddingDomain,
	isRemovingDomain,
	isVerifyingDomain,
}: DomainManagementCardProps) {
	const [newDomain, setNewDomain] = useState('')
	const [showAddForm, setShowAddForm] = useState(false)

	const canAddMoreDomains = domains.length < 5

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

		onAddDomain(newDomain)
		setNewDomain('')
		setShowAddForm(false)
	}

	return (
		<Card className="p-4">
			<CardHeader>
				<CardTitle>Organization Domains</CardTitle>
				<CardDescription>
					Manage domains for your organization. Verified domains enable SSO and improve security.
					{domains.length > 0 && ` (${domains.length}/5 domains)`}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
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
											onClick={onVerifyDomain}
											disabled={isVerifyingDomain}
										>
											{isVerifyingDomain ? 'Loading...' : 'Verify'}
											<ExternalLink className="ml-2 h-3 w-3" />
										</Button>
									)}
									<Button
										size="sm"
										variant="ghost"
										className=" hover:text-destructive focus:ring-destructive hover:border-destructive hover:bg-destructive/20 text-destructive"
										onClick={() => onRemoveDomain(domain.domain, domain.state === 'verified')}
										disabled={isRemovingDomain}
									>
										<Trash2 className="h-4 w-4 \" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}

				{canAddMoreDomains && (
					<>
						<Separator />
						{showAddForm ? (
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
											disabled={isAddingDomain}
										/>
										<Button onClick={handleAddDomain} disabled={!newDomain || isAddingDomain}>
											{isAddingDomain ? 'Adding...' : 'Add Domain'}
										</Button>
										<Button
											variant="outline"
											onClick={() => {
												setShowAddForm(false)
												setNewDomain('')
											}}
											disabled={isAddingDomain}
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
							<Button variant="outline" className="w-full" onClick={() => setShowAddForm(true)}>
								<Plus className="mr-2 h-4 w-4" />
								Add Domain
							</Button>
						)}
					</>
				)}

				{!canAddMoreDomains && (
					<div className="rounded-lg bg-muted/50 p-3">
						<p className="text-sm text-muted-foreground">
							Maximum domain limit reached (5 domains). Remove an existing domain to add a new one.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
