import { cn } from '../../lib/utils'
import type { CommentVisibility } from './comment-visibility'

export type { CommentVisibility } from './comment-visibility'

export interface CommentVisibilityToggleProps {
	value: CommentVisibility
	onChange: (value: CommentVisibility) => void
}

const OPTIONS: { value: CommentVisibility; label: string }[] = [
	{ value: 'open', label: 'Open' },
	{ value: 'resolved', label: 'Resolved' },
	{ value: 'all', label: 'All' },
]

/**
 * Narrow three-state completion filter for the review rail. A Pure leaf:
 * receives the current value + `onChange` one-hop from the Wired rail and
 * forwards the selection straight back. The rail remembers the selection per
 * artifact for the browser session; this control owns no state of its own.
 */
export function CommentVisibilityToggle({ value, onChange }: CommentVisibilityToggleProps) {
	return (
		<div className="artifact-viewer-v2-visibility-toggle" role="group" aria-label="Comment visibility">
			{OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					className={cn(
						'artifact-viewer-v2-visibility-toggle-option',
						value === option.value && 'artifact-viewer-v2-visibility-toggle-option-active',
					)}
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	)
}
