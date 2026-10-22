import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { BillingTabContent } from '@/components/settings/BillingTabContent'
import { useRedirectIfSettingsSectionHidden } from '@/components/settings/settings-sections'
import { BillingRedirectResult } from '@/domains/billing/BillingRedirectResult'
import { normalizeBillingRedirectSearch } from '@/domains/billing/redirect'
import { useRiptideApi } from '@/orpc/client'

export const Route = createFileRoute('/settings/billing')({
	component: BillingSettingsRoute,
	validateSearch: normalizeBillingRedirectSearch,
})

function BillingSettingsRoute() {
	const { billing, billing_error } = Route.useSearch()
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	useRedirectIfSettingsSectionHidden('billing')

	return (
		<>
			{billing || billing_error ? (
				<BillingRedirectResult
					key={`${billing ?? ''}:${billing_error ?? ''}`}
					billing={billing}
					billingError={billing_error}
					onHandled={() => {
						void queryClient.invalidateQueries({ queryKey: api.auth.admin.billing.info.key() })
						navigate({ to: '/settings/billing', search: {}, replace: true })
					}}
				/>
			) : null}
			<BillingTabContent />
		</>
	)
}
