import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { ChevronDown } from 'lucide-react'

export interface FilterDropdownProps<T extends string> {
	/** Singular noun for the filtered dimension (e.g. "model", "agent", "repo"); labels derive from it. */
	noun: string
	/** Distinct options present in the currently active date range. */
	options: readonly T[]
	/** Currently selected options; empty = no filter (sent as `undefined` to the API). */
	selected: T[]
	onChange: (selected: T[]) => void
	className?: string
}

/**
 * Compact multi-select dropdown for filtering the hero scatter
 * (SpendScatterCard) along one dimension (models, agents, repos).
 *
 * `options` reflects only the currently active week window, but a selection
 * made on one window can outlive a switch to a window where that value has no
 * data. Rather than silently drop it from `selected` (which would stealthily
 * widen the filter back to "all"), any selected-but-absent values are still
 * listed — checked — below a divider so the user can see and deliberately
 * clear them.
 */
export function FilterDropdown<T extends string>({
	noun,
	options,
	selected,
	onChange,
	className,
}: FilterDropdownProps<T>) {
	const selectedSet = new Set(selected)
	const strandedSelected = selected.filter((value) => !options.includes(value))

	const toggle = (value: T) => {
		onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value])
	}

	const plural = `${noun}s`
	const label =
		selected.length === 0
			? plural.charAt(0).toUpperCase() + plural.slice(1)
			: `${selected.length} ${selected.length === 1 ? noun : plural}`

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" className={className}>
					{label}
					<ChevronDown className="ml-1 size-3.5 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
				<DropdownMenuLabel>Filter by {noun}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{options.length === 0 && strandedSelected.length === 0 ? (
					<div className="px-2 py-1.5 text-sm text-muted-foreground">No {plural} in range</div>
				) : (
					options.map((value) => (
						<DropdownMenuCheckboxItem
							key={value}
							checked={selectedSet.has(value)}
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={() => toggle(value)}
						>
							{value}
						</DropdownMenuCheckboxItem>
					))
				)}
				{strandedSelected.length > 0 && (
					<>
						<DropdownMenuSeparator />
						{strandedSelected.map((value) => (
							<DropdownMenuCheckboxItem
								key={value}
								checked
								onSelect={(event) => event.preventDefault()}
								onCheckedChange={() => toggle(value)}
							>
								{value}
							</DropdownMenuCheckboxItem>
						))}
					</>
				)}
				{selected.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={(event) => {
								event.preventDefault()
								onChange([])
							}}
						>
							Clear filter
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
