import { useState, type ReactNode } from 'react'
import { Badge } from '@humanlayer/ui/components/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { formatNextInvoice, formatPaymentMethod } from './formatters'
import type { BillingDiscount, BillingRolloutDisplayState, BillingSectionProps, BillingTier } from './types'
import { SubscriptionStatusBadge } from './subscription-status-badge'
import type { SubscriptionStatus } from './types'

const missingValue = <span className="text-muted-foreground">—</span>

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono">{value}</span>
    </div>
  )
}

function BillingTile({ label, children, accent }: { label: string; children: ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-md border border-border bg-muted/30 p-3 ${accent ? 'border-l-2 border-l-primary' : ''}`}
    >
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <div className="mt-2 text-sm font-medium">{children}</div>
    </div>
  )
}

function rolloutDisplayStateLabel(state: BillingRolloutDisplayState): string {
  switch (state) {
    case 'not_linked':
      return 'Not Linked'
    case 'billing_linked':
      return 'Linked (no subscription)'
    case 'billing_enrolled':
      return 'Enrolled'
  }
}

function rolloutDisplayStateBadgeVariant(
  state: BillingRolloutDisplayState,
): 'default' | 'secondary' | 'outline' {
  switch (state) {
    case 'not_linked':
      return 'outline'
    case 'billing_linked':
      return 'secondary'
    case 'billing_enrolled':
      return 'default'
  }
}

function tierLabel(tier: BillingTier): string {
  if (tier === 'starter') {
    return 'Starter'
  }

  if (tier === 'enterprise') {
    return 'Enterprise'
  }

  if (tier === 'pro') {
    return 'Pro'
  }

  return 'Unknown'
}

function timestampToDate(value?: number | null): string {
  if (!value) {
    return '—'
  }

  return new Date(value * 1000).toLocaleDateString()
}

function timestampToRawPeriodEnd(value?: number | null): string {
  if (!value) {
    return '—'
  }

  return String(value)
}

function timestampToDatetime(value?: number | null): string {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString()
}

function discountLabel(discount?: BillingDiscount | null): string {
  if (!discount) {
    return 'No discount'
  }

  if (discount.percentOff != null) {
    return `${discount.percentOff}% off`
  }

  if (discount.amountOff != null) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: discount.currency ?? 'USD',
    }).format(discount.amountOff / 100)
  }

  return 'Discount applied'
}

function discountDetail(discount?: BillingDiscount | null): string | null {
  if (!discount) {
    return null
  }

  return discount.name ?? discount.code ?? 'Promotion applied'
}

export function BillingSection({
  organizationId,
  rolloutDisplayState,
  tier,
  subscriptionStatus,
  stripeCustomerId,
  subscriptionId,
  priceId,
  currentPeriodEnd,
	syncedAt,
	activeSeatCount,
	pendingInvitationCount,
	freeCapacity,
	discount,
  paymentMethod,
  nextInvoice,
  promoCodeAction,
  diagnosticsDefaultOpen = false,
  children,
}: BillingSectionProps) {
	const discountSummary = discountLabel(discount)
	const discountDescription = discountDetail(discount)
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(diagnosticsDefaultOpen)
	const usedFreeCapacity = (activeSeatCount ?? 0) + (pendingInvitationCount ?? 0)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Billing Status</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <BillingTile label="Plan / Status" accent>
            <div className="flex flex-wrap items-center gap-2">
              {tier ? <Badge variant="secondary">{tierLabel(tier)}</Badge> : missingValue}
              <SubscriptionStatusBadge status={subscriptionStatus} />
            </div>
          </BillingTile>
          <BillingTile label="Period End">{timestampToDate(currentPeriodEnd)}</BillingTile>
						<BillingTile label="Next Invoice">{formatNextInvoice(nextInvoice)}</BillingTile>
						<BillingTile label={tier === 'starter' ? 'Free Capacity' : 'Active Seats'}>
							{tier === 'starter' && freeCapacity != null ? `${usedFreeCapacity}/${freeCapacity} used` : activeSeatCount ?? missingValue}
						</BillingTile>
						<BillingTile label="Payment Method">{formatPaymentMethod(paymentMethod)}</BillingTile>
          <BillingTile label="Discount">
            <div className="space-y-1">
              <p>{discountSummary}</p>
              {discountDescription ? <p className="text-xs font-normal text-muted-foreground">{discountDescription}</p> : null}
            </div>
          </BillingTile>
					</div>
					{tier === 'starter' ? (
						<div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
							<p className="font-medium text-foreground">HumanLayer Starter</p>
							<p>Free while your team has three or fewer active members.</p>
							<p>Teams with four or more active members are billed for every active member.</p>
							{pendingInvitationCount != null ? (
								<p>
									Current usage includes {activeSeatCount ?? 0} active member{activeSeatCount === 1 ? '' : 's'} and{' '}
									{pendingInvitationCount} pending invitation{pendingInvitationCount === 1 ? '' : 's'}.
								</p>
							) : null}
						</div>
					) : null}
				</div>

      {promoCodeAction}

      <Collapsible open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} className="space-y-2">
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/40">
          <span>Billing Diagnostics</span>
          <span className="flex items-center gap-1 text-[10px] normal-case tracking-normal">
            {diagnosticsOpen ? (
              <>
                Collapse details
                <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            ) : (
              <>
                Expand details
                <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
              </>
            )}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="bg-muted/30 rounded-md p-3 space-y-0">
            <InfoRow label="Rollout State" value={<Badge variant={rolloutDisplayStateBadgeVariant(rolloutDisplayState)}>{rolloutDisplayStateLabel(rolloutDisplayState)}</Badge>} />
            <InfoRow label="Organization ID" value={organizationId ?? missingValue} />
            <InfoRow label="Customer ID" value={stripeCustomerId ?? missingValue} />
            <InfoRow label="Subscription ID" value={subscriptionId ?? missingValue} />
            <InfoRow label="Price ID" value={priceId ?? missingValue} />
            <InfoRow label="Period End Raw" value={timestampToRawPeriodEnd(currentPeriodEnd)} />
            <InfoRow label="Last Synced" value={timestampToDatetime(syncedAt)} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {children}
    </div>
  )
}
