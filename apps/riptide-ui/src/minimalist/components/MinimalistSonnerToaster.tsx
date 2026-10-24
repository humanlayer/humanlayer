import { X } from 'lucide-react'
import { Toaster } from 'sonner'

export function MinimalistSonnerToaster() {
	return (
		<Toaster
			className="minimalist-sonner-toasts"
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
