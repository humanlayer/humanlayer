import { toast } from 'sonner'

import { useMountEffect } from '@/hooks/useMountEffect'

import { getBillingErrorMessage, getBillingSuccessMessage } from '../redirect'

type BillingRedirectResultProps = {
	billing: string | undefined
	billingError: string | undefined
	onHandled: () => void
}

export function BillingRedirectResult({ billing, billingError, onHandled }: BillingRedirectResultProps) {
	useMountEffect(() => {
		const errorMessage = getBillingErrorMessage(billingError)
		const successMessage = getBillingSuccessMessage(billing)
		if (errorMessage) toast.error(errorMessage)
		else if (successMessage) toast.success(successMessage)
		if (errorMessage || successMessage) onHandled()
	})
	return null
}
