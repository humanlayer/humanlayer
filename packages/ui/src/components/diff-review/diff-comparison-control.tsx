import { History } from 'lucide-react'
import { useId } from 'react'

import { Button } from '../button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '../dropdown-menu'

/**
 * What the left side of every diff in the review is. `since-last-review` starts each file at
 * the version last marked reviewed, or at task start when there is none.
 */
export type DiffComparison = 'since-last-review' | 'since-task-start'

const COMPARISON_LABELS: Record<DiffComparison, string> = {
	'since-last-review': 'Since last review',
	'since-task-start': 'Since task start',
}

const COMPARISON_OPTIONS: readonly { value: DiffComparison; label: string; description: string }[] = [
	{
		value: 'since-last-review',
		label: COMPARISON_LABELS['since-last-review'],
		description: "Each file starts from the version you last reviewed, or from task start if you haven't reviewed it.",
	},
	{
		value: 'since-task-start',
		label: COMPARISON_LABELS['since-task-start'],
		description: 'Every file shows all changes made during the task.',
	},
]

export interface DiffComparisonControlProps {
	comparison: DiffComparison
	onComparisonChange: (comparison: DiffComparison) => void
}

/**
 * One icon for the whole review, not one per file. The dot marks the incremental mode, so a
 * reader can tell at a glance that a diff may start after task start.
 */
export function DiffComparisonControl({ comparison, onComparisonChange }: DiffComparisonControlProps) {
	const descriptionId = useId()
	const currentLabel = COMPARISON_LABELS[comparison].toLowerCase()
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="relative size-8"
					aria-label={`Compare files: ${currentLabel}`}
					title={`Showing changes ${currentLabel}`}
				>
					<History className="size-4" />
					{comparison === 'since-last-review' ? (
						<span
							aria-hidden="true"
							data-slot="comparison-mode-dot"
							className="absolute right-1.5 bottom-1.5 size-1.5 bg-accent ring-1 ring-background"
						/>
					) : null}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" collisionPadding={8} className="w-72 max-w-[calc(100vw-1rem)]">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Compare files</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={comparison}
					onValueChange={(value) => onComparisonChange(value as DiffComparison)}
				>
					{COMPARISON_OPTIONS.map((option) => (
						<DropdownMenuRadioItem
							key={option.value}
							value={option.value}
							aria-label={option.label}
							aria-describedby={`${descriptionId}-${option.value}`}
							className="items-start"
						>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="text-sm">{option.label}</span>
								<span id={`${descriptionId}-${option.value}`} className="text-xs text-muted-foreground">
									{option.description}
								</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
