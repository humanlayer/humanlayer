import type { StarterDowngradeEligibility } from '@humanlayer/ui/components/billing/types'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'

type DowngradeToStarterActionProps = {
	eligibility: StarterDowngradeEligibility
	isPending: boolean
	onDowngrade: () => void
}

export function DowngradeToStarterAction({ eligibility, isPending, onDowngrade }: DowngradeToStarterActionProps) {
	const button = (
		<Button variant="outline" onClick={onDowngrade} disabled={!eligibility.isEligible || isPending}>
			{isPending ? 'Downgrading...' : 'Downgrade to Starter'}
		</Button>
	)
	if (!eligibility.disabledReason) return button
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex cursor-not-allowed">{button}</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-80" side="top" align="start">
				{eligibility.disabledReason}
			</TooltipContent>
		</Tooltip>
	)
}
