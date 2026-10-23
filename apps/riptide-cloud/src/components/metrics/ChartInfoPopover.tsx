import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { Info } from 'lucide-react'

export interface ChartInfoPopoverProps {
	/**
	 * Methodology and disclosure lines — encodings, counting rules,
	 * data-quality notes. Empty strings are skipped so callers can pass
	 * conditional notes (`outlierNote`, `gapSummary(...)`) unfiltered.
	 */
	notes: string[]
}

/**
 * The ⓘ next to a chart title. The visible caption stays to one line
 * (question + date range); the methodology and honesty notes — how the ratio
 * is computed, what the encodings mean, what was clamped or folded — live
 * here instead of turning every card header into a paragraph. The notes are
 * still one click away, never gone: hiding a disclosure entirely would trade
 * a wordy card for a misleading one.
 */
export function ChartInfoPopover({ notes }: ChartInfoPopoverProps) {
	const visible = notes.filter((note) => note.length > 0)
	if (visible.length === 0) return null
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label="How this chart is computed"
					className="text-muted-foreground transition-colors hover:text-foreground"
				>
					<Info className="size-4" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-96">
				<ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
					{visible.map((note) => (
						<li key={note} className="flex gap-1.5">
							<span aria-hidden>·</span>
							<span>{note}</span>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	)
}
