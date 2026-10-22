import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@humanlayer/ui/components/sheet'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check } from 'lucide-react'
import type { FC } from 'react'

export interface MobileEffortSelectorProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Currently selected effort level (null = none selected). */
	value: string | null
	/** Supported effort levels for the current model. */
	levels: readonly string[]
	onChange: (value: string) => void
}

/**
 * Bottom-Sheet effort/reasoning picker for mobile. Pure component — caller owns
 * state and supplies the level list. Mirrors MobileModelSelector so the two
 * pickers stay visually consistent. Selecting a level fires onChange and closes.
 */
export const MobileEffortSelector: FC<MobileEffortSelectorProps> = ({
	open,
	onOpenChange,
	value,
	levels,
	onChange,
}) => {
	const handleSelect = (next: string) => {
		onChange(next)
		onOpenChange(false)
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="bottom"
				className="h-auto rounded-none border-x-0 border-b-0 px-0 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] [&>button]:hidden"
			>
				<SheetHeader className="border-b border-border px-4 pb-3 pt-3 text-left">
					<SheetTitle className="text-sm font-medium text-foreground">Reasoning Effort</SheetTitle>
				</SheetHeader>
				<div className="pt-1">
					{levels.map((level) => {
						const isSelected = value === level
						return (
							<button
								key={level}
								type="button"
								className={cn(
									'w-full border-l-2 px-4 py-3 text-left transition-colors',
									'flex items-center justify-between gap-3 hover:bg-muted/30 active:bg-muted/50',
									isSelected
										? 'border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/6'
										: 'border-transparent',
								)}
								onClick={() => handleSelect(level)}
							>
								<div className="min-w-0 truncate text-base font-medium uppercase">{level}</div>
								{isSelected && <Check className="h-4 w-4 shrink-0 text-[var(--terminal-accent)]" />}
							</button>
						)
					})}
				</div>
			</SheetContent>
		</Sheet>
	)
}
