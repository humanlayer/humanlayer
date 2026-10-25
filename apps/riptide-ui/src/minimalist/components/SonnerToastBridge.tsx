import { type ToastT, toast, useSonner } from 'sonner'

import { useMountEffect } from '@/hooks/useMountEffect'
import { toForwardedToast } from '@/minimalist/lib/sonner-toasts'
import { useUi } from '@/minimalist/lib/ui-state'

export function SonnerToastBridge() {
	const { toasts } = useSonner()
	return toasts.map((sonnerToast) => <ForwardSonnerToast key={sonnerToast.id} sonnerToast={sonnerToast} />)
}

function ForwardSonnerToast({ sonnerToast }: { sonnerToast: ToastT }) {
	const { showToast } = useUi()
	useMountEffect(() => {
		const forwarded = toForwardedToast(sonnerToast)
		if (forwarded) showToast(forwarded.text, forwarded.action)
		toast.dismiss(sonnerToast.id)
	})
	return null
}
