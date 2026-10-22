import { ArrowUpDown } from 'lucide-react'

import { Button } from '../button'

/** `path` groups the review by location; `recent` puts the agent's latest change first. */
export type DiffFileSort = 'path' | 'recent'

export interface DiffFileSortToggleProps {
	sort: DiffFileSort
	onSortChange: (sort: DiffFileSort) => void
	className?: string
}

/**
 * The icon never changes and the text always names the order the list is in now.
 * An icon that swapped with the mode read as a state to some people and as an
 * action to others, and a screenshot gave no way to tell which.
 */
export function DiffFileSortToggle({ sort, onSortChange, className }: DiffFileSortToggleProps) {
	const recent = sort === 'recent'
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className={className ?? 'h-8 gap-1 px-1.5'}
			aria-pressed={recent}
			aria-label={recent ? 'Files ordered by latest change. Order by path instead' : 'Files ordered by path. Order by latest change instead'}
			title={recent ? 'Ordered by latest change' : 'Ordered by path'}
			onClick={() => onSortChange(recent ? 'path' : 'recent')}
		>
			<ArrowUpDown className="size-3.5" />
			<span className="text-xs">{recent ? 'Recent' : 'Path'}</span>
		</Button>
	)
}
