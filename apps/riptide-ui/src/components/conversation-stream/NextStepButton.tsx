import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { ArrowRight } from 'lucide-react'
import type { FC } from 'react'

import { getNextStepButtonLabel } from '@/utils/next-step-labels'

interface NextStepButtonProps {
	suggestion: NextStepSuggestion
	eventId: string
	onProceed: () => void
	isFocused: boolean
	variant?: 'loud-success-cta' | 'outline'
	labelOverride?: string
	disabled?: boolean
}

export const NextStepButton: FC<NextStepButtonProps> = ({
	suggestion,
	eventId,
	onProceed,
	isFocused,
	variant,
	labelOverride,
	disabled,
}) => {
	if (suggestion.extraction.type !== 'next_step_found') return null

	return (
		<div className="flex gap-2 mt-3" data-next-step-button={eventId}>
			<Button
				onClick={(e) => {
					e.stopPropagation()
					onProceed()
				}}
				variant={variant ?? 'loud-success-cta'}
				className="h-auto py-0.5 px-2 text-xs"
				data-focused={isFocused}
				disabled={disabled}
			>
				{labelOverride ?? getNextStepButtonLabel(suggestion.extraction.nextStepType)}
				<ArrowRight className="h-3 w-3 ml-1" />
				{!disabled && (
					<KeyboardShortcut size="xs" className="ml-1">
						⌘+Shift+Enter
					</KeyboardShortcut>
				)}
			</Button>
		</div>
	)
}
