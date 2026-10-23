import { toast } from 'sonner'

/**
 * Show a role-aware recovery toast when a BILLING_REQUIRED error is received.
 *
 * - Admins get an actionable toast that navigates to /settings.
 * - Non-admins get guidance to ask an organization admin.
 *
 * Cloud uses page-level navigation to /settings rather than riptide-ui's
 * dialog-based settings panel.
 */
export function showBillingRequiredToast(isAdmin: boolean, navigate?: (opts: { to: string }) => void): void {
	if (isAdmin) {
		toast.error('A billing subscription is required to perform this action.', {
			action: navigate
				? {
						label: 'Open Billing',
						onClick: () => {
							navigate({ to: '/settings' })
						},
					}
				: undefined,
			duration: 8000,
		})
	} else {
		toast.error(
			'A billing subscription is required to perform this action. Please ask an organization admin to set up billing.',
			{ duration: 8000 },
		)
	}
}
