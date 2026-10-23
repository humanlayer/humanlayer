import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@humanlayer/ui/components/sheet'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check } from 'lucide-react'
import type { FC } from 'react'

export interface MobileModelOption {
	value: string
	label: string
}

export interface MobileModelSelectorProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	value: string
	options: readonly MobileModelOption[]
	onChange: (value: string) => void
}

/**
 * Bottom-Sheet model picker for mobile. Pure component — caller owns state
 * and supplies the option list. Selecting an option fires onChange and closes the sheet.
 */
export const MobileModelSelector: FC<MobileModelSelectorProps> = ({ open, onOpenChange, value, options, onChange }) => {
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
					<SheetTitle className="text-sm font-medium text-foreground">Select Model</SheetTitle>
				</SheetHeader>
				<div className="pt-1">
					{options.map((option) => {
						const isSelected = value === option.value
						return (
							<button
								key={option.value}
								type="button"
								className={cn(
									'w-full border-l-2 px-4 py-3 text-left transition-colors',
									'flex items-center justify-between gap-3 hover:bg-muted/30 active:bg-muted/50',
									isSelected
										? 'border-[var(--terminal-accent)] bg-[var(--terminal-accent)]/6'
										: 'border-transparent',
								)}
								onClick={() => handleSelect(option.value)}
							>
								<div className="min-w-0 truncate text-base font-medium">{option.label}</div>
								{isSelected && <Check className="h-4 w-4 shrink-0 text-[var(--terminal-accent)]" />}
							</button>
						)
					})}
				</div>
			</SheetContent>
		</Sheet>
	)
}
