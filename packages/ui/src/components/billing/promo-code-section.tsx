import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from '@humanlayer/ui/components/input-group'
import type { BillingDiscount } from './types'

type PromoCodeSectionProps = {
	code: string
	isApplying: boolean
	discount?: BillingDiscount | null
	errorMessage?: string | null
	successMessage?: string | null
	variant?: 'section' | 'compact'
	onCodeChange(code: string): void
	onApply(): void
}

function formatCurrencyAmount(amountOff: number, currency: string | null): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency ?? 'USD',
	}).format(amountOff / 100)
}

function formatDuration(duration: string | null): string {
	switch (duration) {
		case 'forever':
			return 'applies forever'
		case 'once':
			return 'applies once'
		case 'repeating':
			return 'applies for a limited billing period'
		default:
			return 'duration unavailable'
	}
}

function formatDiscountValue(discount: BillingDiscount): string {
	if (discount.percentOff != null) {
		return `${discount.percentOff}% off`
	}

	if (discount.amountOff != null) {
		return `${formatCurrencyAmount(discount.amountOff, discount.currency)} off`
	}

	return 'Discount applied'
}

export function PromoCodeSection({
	code,
	isApplying,
	discount,
	errorMessage,
	successMessage,
	variant = 'section',
	onCodeChange,
	onApply,
}: PromoCodeSectionProps) {
	const canApply = code.trim().length > 0 && !isApplying
	const isCompact = variant === 'compact'

	if (discount) {
		const label = discount.name ?? discount.code ?? 'Promotion applied'
		const codeLabel = discount.code ? `Code ${discount.code}` : 'Promotion code unavailable'

		if (isCompact) {
			return (
				<div className="w-full min-w-64 rounded-md border border-border bg-muted/30 px-3 py-2">
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm font-medium">{label}</span>
						<span className="text-xs font-mono">{formatDiscountValue(discount)}</span>
					</div>
					<div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
						<span>{codeLabel}</span>
						<span>{formatDuration(discount.duration)}</span>
					</div>
				</div>
			)
		}

		return (
			<div className="space-y-2">
				<div className="space-y-1">
					<p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Promotion Code</p>
					<p className="text-sm text-muted-foreground">
						A discount is already applied to your current subscription.
					</p>
				</div>
				<div className="bg-muted/30 rounded-md border border-border p-3 space-y-1">
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm font-medium">{label}</span>
						<span className="text-sm font-mono">{formatDiscountValue(discount)}</span>
					</div>
					<div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
						<span>{codeLabel}</span>
						<span>{formatDuration(discount.duration)}</span>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className={isCompact ? 'space-y-1' : 'space-y-2'}>
			{isCompact ? null : (
				<div className="space-y-1">
					<p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Promotion Code</p>
					<p className="text-sm text-muted-foreground">
						Apply a promotion code to your current subscription. Codes are applied immediately through Stripe.
					</p>
				</div>
			)}
			<InputGroup className={isCompact ? 'w-full min-w-64' : 'w-full'}>
				<InputGroupInput
					type="text"
					placeholder="Enter promo code"
					value={code}
					onChange={(event) => onCodeChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && canApply) {
							onApply()
						}
					}}
					disabled={isApplying}
					aria-invalid={!!errorMessage}
					aria-label="Promotion code"
				/>
				<InputGroupAddon align="inline-end">
					<InputGroupButton size="sm" onClick={onApply} disabled={!canApply}>
						{isApplying ? 'Applying...' : 'Apply'}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			{errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
			{successMessage ? <p className="text-xs text-muted-foreground">{successMessage}</p> : null}
		</div>
	)
}

export type { PromoCodeSectionProps }
