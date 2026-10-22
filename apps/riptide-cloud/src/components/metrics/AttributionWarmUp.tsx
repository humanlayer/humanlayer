import { Card } from '@humanlayer/ui/components/card'
import { format } from 'date-fns'
import { Hourglass } from 'lucide-react'

export interface AttributionWarmUpProps {
	/**
	 * The day output was first attributed, or null when NOTHING has been
	 * attributed yet — the org turned tracking on and no agent commit has
	 * landed since. The two are different states, not a value and its fallback;
	 * see the copy below.
	 */
	coverageStart: Date | null
	/** The first day a range may start on — the day after coverage began. */
	unlocksOn: Date | null
	/** How far back the range brush reaches, for the closing reassurance. */
	historyDays: number
}

/**
 * What the commit-denominated cards show before attribution can denominate
 * anything.
 *
 * Token spend is recorded for every org whatever the collection flags say, so
 * a freshly enabled org already has months of numerator and days — or none —
 * of denominator. Every unit cost on this page would be wrong by the ratio of
 * the two coverages: not noisy, wrong.
 *
 * TWO states reach this card, and they are told apart by `coverageStart`:
 *
 *  - **null — nothing attributed yet.** The org has turned tracking on but no
 *    agent commit has been attributed, so there is no first day to name. The
 *    page cannot compute a coverage floor either (`coverageFloor(null)` is
 *    null), which is why this state has to be detected from the date itself
 *    rather than from the range bounds. The copy states that tracking is on,
 *    which the caller guarantees: the route pairs `attributionPending` with
 *    `commitTrackingEnabled`, because an org that collects nothing is not
 *    waiting for anything.
 *  - **a date — attributed, but no whole bucket has closed.** The older case:
 *    attribution began today, so the first selectable bucket is still ahead.
 *
 * The second state is rare now. The page once offered only fixed 4/8/12-week
 * windows, so an org whose coverage was three weeks old had nothing it could
 * be shown and waited. A brush can select any covered span, and the range is
 * clamped to the coverage floor before it is queried, so the page opens on
 * whatever IS covered.
 */
export function AttributionWarmUp({ coverageStart, unlocksOn, historyDays }: AttributionWarmUpProps) {
	// No first attributed commit means no date to promise anything against, so
	// this branch says what is missing and what produces it — never a date the
	// page would be inventing.
	if (coverageStart === null) {
		return (
			<Card className="flex flex-col items-center gap-3 p-10 text-center">
				<Hourglass className="size-6 text-muted-foreground" aria-hidden="true" />
				<h2 className="text-lg font-medium">Waiting for the first attributed commit</h2>
				<p className="max-w-prose text-sm text-muted-foreground">
					Commit tracking is on, but no commit has been attributed to an agent yet. Token spend was already
					being recorded before tracking was switched on, so a cost per commit now would divide months of
					spend by nothing.
				</p>
				<p className="max-w-prose text-sm text-muted-foreground">
					These charts fill in from the first agent commit in a tracked repository, and widen day by day up to{' '}
					{historyDays} days as coverage accrues. Spend is still being collected in the meantime, and every
					chart that does not need a commit still shows it.
				</p>
			</Card>
		)
	}

	return (
		<Card className="flex flex-col items-center gap-3 p-10 text-center">
			<Hourglass className="size-6 text-muted-foreground" aria-hidden="true" />
			<h2 className="text-lg font-medium">Collecting your first full bucket</h2>
			<p className="max-w-prose text-sm text-muted-foreground">
				Attribution started on {format(coverageStart, 'MMMM do')}. Token spend was already being recorded before
				then, so comparing the two now would divide months of spend by hours of output.
			</p>
			<p className="max-w-prose text-sm text-muted-foreground">
				The dashboard opens{' '}
				{unlocksOn ? (
					<span className="text-foreground">on {format(unlocksOn, 'MMMM do')}</span>
				) : (
					'as soon as a whole day of output has been attributed'
				)}
				, and widens day by day up to {historyDays} days as coverage accrues. Nothing is being lost in the
				meantime — commits and spend are both being collected.
			</p>
		</Card>
	)
}
