import type { ReactNode } from 'react'

type PaymentMethodSectionProps = {
  hasPaymentMethod: boolean
  isOrgAdmin: boolean
  paymentMethodLabel?: string | null
  primaryAction?: ReactNode
  secondaryAction?: ReactNode
}

export function PaymentMethodSection({
  hasPaymentMethod,
  isOrgAdmin,
  paymentMethodLabel,
  primaryAction,
  secondaryAction,
}: PaymentMethodSectionProps) {
  const paymentMethodSummary = hasPaymentMethod
    ? paymentMethodLabel ?? 'Payment method is on file.'
    : 'No payment method on file.'

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Payment Method</h3>
        <p className="text-sm text-muted-foreground">{paymentMethodSummary}</p>
      </div>

      {isOrgAdmin ? (
        <div className="flex flex-wrap gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only organization admins can manage billing actions.</p>
      )}
    </section>
  )
}
