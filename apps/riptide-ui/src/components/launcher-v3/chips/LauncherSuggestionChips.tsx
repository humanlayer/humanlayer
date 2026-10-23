import { Plug, Server, X } from 'lucide-react'

export type LauncherSuggestionChipKind = 'integration' | 'host'

export interface LauncherSuggestionChip {
	id: string
	label: string
	kind: LauncherSuggestionChipKind
}

export interface LauncherSuggestionChipsProps {
	chips: readonly LauncherSuggestionChip[]
	disabled?: boolean
	onSelectChip: (chipId: string) => void
	onDismissChip: (chipId: string) => void
}

function ChipIcon({ kind }: { kind: LauncherSuggestionChipKind }) {
	if (kind === 'host') return <Server aria-hidden className="size-3 shrink-0" />
	return <Plug aria-hidden className="size-3 shrink-0" />
}

/** Suggested-action chips rendered underneath the composer box. */
export function LauncherSuggestionChips({
	chips,
	disabled = false,
	onSelectChip,
	onDismissChip,
}: LauncherSuggestionChipsProps) {
	if (chips.length === 0) return null

	return (
		<section aria-label="Suggested actions" className="flex flex-wrap items-center gap-1.5">
			{chips.map((chip) => (
				<span
					key={chip.id}
					className="flex h-6 items-center overflow-hidden bg-muted/60 text-[11px] text-muted-foreground"
				>
					<button
						type="button"
						disabled={disabled}
						onClick={() => onSelectChip(chip.id)}
						className="flex h-full cursor-pointer items-center gap-1.5 pl-2.5 pr-1.5 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
					>
						<ChipIcon kind={chip.kind} />
						{chip.label}
					</button>
					<button
						type="button"
						disabled={disabled}
						onClick={() => onDismissChip(chip.id)}
						aria-label={`Dismiss ${chip.label}`}
						title="Dismiss suggestion"
						className="flex h-full cursor-pointer items-center px-1.5 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
					>
						<X aria-hidden className="size-3" />
					</button>
				</span>
			))}
		</section>
	)
}
