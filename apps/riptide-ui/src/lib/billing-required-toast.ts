import { toast } from 'sonner'

import { type NavigateFn, navigateToSettings } from '@/lib/settings-navigation'

/**
 * Show a role-aware recovery toast when a BILLING_REQUIRED error is received.
 *
 * - Admins get an actionable toast that navigates to the Billing settings route.
 * - Non-admins get guidance to ask an organization admin.
 */
export function showBillingRequiredToast(isAdmin: boolean, navigate: NavigateFn): void {
	if (isAdmin) {
		toast.error('A billing subscription is required to perform this action.', {
			action: {
				label: 'Open Billing',
				onClick: () => {
					navigateToSettings(navigate, 'billing')
				},
			},
			duration: 8000,
		})
	} else {
		toast.error(
			'A billing subscription is required to perform this action. Please ask an organization admin to set up billing.',
			{ duration: 8000 },
		)
	}
}
