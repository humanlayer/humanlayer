import { X } from 'lucide-react'
import { Toaster } from 'sonner'

/**
 * Toasts that shared code raises through sonner (API errors, the daemon, copy and open helpers,
 * undo), drawn in the minimalist style. It replaces the standard toaster in the minimalist frame,
 * so it must render inside `.minimalist-ui` for the scoped styles to apply.
 */
export function SharedToasts() {
	return (
		<Toaster
			className="shared-toasts"
			position="bottom-center"
			offset={18}
			mobileOffset={12}
			gap={8}
			closeButton
			icons={{
				success: null,
				info: null,
				warning: null,
				error: null,
				loading: null,
				close: <X className="i sm" />,
			}}
			toastOptions={{ unstyled: true, closeButtonAriaLabel: 'Dismiss' }}
		/>
	)
}
