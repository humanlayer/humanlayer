import { Button } from '@humanlayer/ui/components/button'
import { Separator } from '@humanlayer/ui/components/separator'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { BillingTabContent } from '@/components/settings/BillingTabContent'
import { ExperimentsSection } from '@/components/settings/ExperimentsSection'
import { IntegrationsSection } from '@/components/settings/IntegrationsSection'
import { OptionalFeaturesSection } from '@/components/settings/OptionalFeaturesSection'
import { OrganizationDomainsSection } from '@/components/settings/OrganizationDomainsSection'
import { TaskSharingSection } from '@/components/settings/TaskSharingSection'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useBillingVisible } from '@/lib/billing-visibility'
import { BillingRedirectResult } from '@/lib/billing/components/BillingRedirectResult'
import { settingsSearchSchema } from '@/lib/settings-search'

export const Route = createFileRoute('/settings')({
	component: SettingsPage,
	validateSearch: settingsSearchSchema,
})

function OrganizationIdBlock() {
	const { dbOrganizationId } = useUserInfo()
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		if (!dbOrganizationId) return
		await navigator.clipboard.writeText(dbOrganizationId)
		setCopied(true)
		toast.success('Organization ID copied to clipboard')
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="max-w-5xl mb-8">
			<p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Organization ID</p>
			<div className="relative">
				<pre className="overflow-x-auto rounded-lg bg-muted p-4 pr-14 font-mono text-sm">
					<code>{dbOrganizationId ?? '—'}</code>
				</pre>
				<Button
					onClick={handleCopy}
					variant="outline"
					size="icon"
					className="absolute right-2 top-2 h-8 w-8"
					disabled={!dbOrganizationId}
					aria-label="Copy organization ID"
				>
					{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
				</Button>
			</div>
		</div>
	)
}

function SettingsPage() {
	const { billing, billing_error: billingError } = Route.useSearch()
	const { isLoading, user, organizationId, role, roles } = useAuth()
	const navigate = useNavigate()
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const billingVisible = useBillingVisible()

	if (isLoading || !user || !organizationId || !role || !roles) return null
	if (!roles?.includes('admin')) {
		return (
			<div className="flex h-full items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Organization settings are available to admins only.</p>
			</div>
		)
	}

	return (
		<div className="w-full p-6">
			{billing || billingError ? (
				<BillingRedirectResult
					key={`${billing ?? ''}:${billingError ?? ''}`}
					billing={billing}
					billingError={billingError}
					onHandled={() => {
						void queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
						navigate({
							to: '/settings',
							search: (previous) => ({ ...previous, billing: undefined, billing_error: undefined }),
							replace: true,
						})
					}}
				/>
			) : null}
			{/* Page Header */}
			<div className="mb-8">
				<h1 className="text-lg font-bold">Settings</h1>
				<p className="text-md text-muted-foreground">Manage your organization settings and configuration</p>
			</div>

			<OrganizationIdBlock />

			<div className="max-w-5xl space-y-8">
				<OptionalFeaturesSection />
				<Separator />
				<TaskSharingSection />
				<Separator />
				<IntegrationsSection />
				{billingVisible && (
					<>
						<Separator />
						<section>
							<div className="mb-4">
								<h2 className="text-base font-semibold">Billing</h2>
								<p className="text-sm text-muted-foreground">
									Manage your organization's billing and subscription.
								</p>
							</div>
							<BillingTabContent />
						</section>
					</>
				)}
				<Separator />
				<ExperimentsSection />
				<Separator />
				<OrganizationDomainsSection />
			</div>
		</div>
	)
}
