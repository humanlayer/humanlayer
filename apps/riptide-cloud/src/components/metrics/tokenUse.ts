/**
 * The Token use by task card's pure parts: the lens vocabulary and the display
 * rules a task row follows. Free of React and recharts so every judgement call
 * here is unit-testable — the card itself only lays these out.
 */

import type { TokenUseMeasure } from '@humanlayer/riptide-api-contract/api/metrics/tokenUseByTask'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

/* ────────────────────────────── the lenses ────────────────────────────── */

/** What a bar stands for. */
export const TOKEN_USE_LENSES = ['tasks', 'fanout'] as const
export type TokenUseLens = (typeof TOKEN_USE_LENSES)[number]
export const DEFAULT_TOKEN_USE_LENS: TokenUseLens = 'tasks'

/**
 * What a bar is made of.
 *
 * Five of the six segment the bar. `mode` does NOT, and cannot: a task has
 * exactly one `workflow_type`, so a mode split would paint one band at 100% on
 * every row. It tints the whole bar instead, which turns the ranked list into
 * colour-banded groups — "the top three are all outline-only" is the finding it
 * exists to show. See `splitSegmentsBar`.
 */
export const TOKEN_USE_SPLITS = ['none', 'agent', 'model', 'stage', 'person', 'mode'] as const
export type TokenUseSplit = (typeof TOKEN_USE_SPLITS)[number]

export const SPLIT_LABELS: Record<TokenUseSplit, string> = {
	none: 'Total',
	agent: 'By agent',
	model: 'By model',
	stage: 'By stage',
	person: 'By person',
	mode: 'By mode',
}

/**
 * Whether this split divides a bar into bands, or only recolours it.
 *
 * The distinction is load-bearing in two places: the legend (a tint still
 * needs one — colour is naming something either way) and the segment builder,
 * which must not emit a single 100% band and call it a split.
 */
export function splitSegmentsBar(split: TokenUseSplit): boolean {
	return split !== 'none' && split !== 'mode'
}

/**
 * The split only means something when bars ARE tasks: the fan-out lens buckets
 * tasks rather than ranking them, so there is no bar to divide. The control
 * stays visible and disabled rather than disappearing, so the control row
 * never reflows under the pointer mid-click.
 */
export function supportsSplit(lens: TokenUseLens): boolean {
	return lens === 'tasks'
}

export const LENS_LABELS: Record<TokenUseLens, string> = {
	tasks: 'Tasks',
	fanout: 'Fan-out',
}

export const MEASURE_LABELS: Record<TokenUseMeasure, string> = {
	tokens: 'Tokens',
	cost: 'Cost',
}

/** The question the caption leads with, per lens. */
export function lensQuestion(lens: TokenUseLens, measure: TokenUseMeasure): string {
	switch (lens) {
		case 'tasks':
			return measure === 'cost' ? 'Which tasks eat the budget?' : 'Which tasks eat the tokens?'
		case 'fanout':
			return 'Does a heavy task pull in more people, agents or models?'
	}
}

/**
 * The other measure — what clicking the inactive figure column switches to.
 *
 * The task list has no separate sort control: the two figure headers ARE the
 * sort, because the measure already decides both the ranking and the bar, and
 * a segmented Tokens/Cost toggle sitting beside a sortable column header would
 * be two controls for one piece of state.
 */
export function otherMeasure(measure: TokenUseMeasure): TokenUseMeasure {
	return measure === 'cost' ? 'tokens' : 'cost'
}

/* ─────────────────────────────── agents ─────────────────────────────── */

/**
 * Fixed hue per agent, assigned in a FIXED ORDER and never by rank — a filter
 * that changes which agents are present must not repaint the survivors. Uses
 * the theme's chart slots so the split matches the rest of the page.
 */
export const AGENT_COLORS: Record<CodingAgent, string> = {
	codelayer: 'var(--chart-4)',
	claude: 'var(--chart-5)',
	fold: 'var(--chart-2)',
	opencode: 'var(--chart-3)',
	pi: 'var(--chart-1)',
	codex: 'var(--chart-6)',
	'claude-code': 'var(--chart-7)',
}

export const AGENT_LABELS: Record<CodingAgent, string> = {
	codelayer: 'Codelayer',
	claude: 'Claude',
	fold: 'Fold',
	opencode: 'OpenCode',
	pi: 'pi',
	codex: 'Codex',
	'claude-code': 'Claude Code (local)',
}

/**
 * The single-series hue, used whenever bars carry no split.
 *
 * An inline `var(--chart-4)`, NOT a `bg-chart-4` utility: the theme declares
 * `--chart-1..10` as plain custom properties and never registers them in
 * Tailwind's `--color-*` namespace, so `bg-chart-4` compiles to nothing and
 * the bars render invisible.
 */
export const SERIES_COLOR = 'var(--chart-4)'

/** Stable paint order, so a task missing an agent doesn't shift the others' hues. */
export const AGENT_ORDER: readonly CodingAgent[] = [
	'codelayer',
	'claude',
	'fold',
	'opencode',
	'pi',
	'codex',
	'claude-code',
]

/* ─────────────────────────────── models ─────────────────────────────── */

/**
 * Model colour slots. Same number, same rank-ordered `--chart-N` assignment
 * and same muted fold as the Model spend card, so the two read as one system.
 *
 * The hues are NOT guaranteed to agree between the two cards, and cannot be:
 * that card ranks models over every task in the range, this one sees only the
 * ranked page. The same model can therefore hold a different slot in each.
 * Both cards carry a legend, which is what keeps identity readable regardless.
 */
export const MAX_MODEL_SERIES = 5

/** Key of the folded tail. */
export const OTHER_MODEL_KEY = '__other__'

export interface ModelSeries {
	/** The model name, or {@link OTHER_MODEL_KEY} for the fold. */
	key: string
	label: string
	color: string
	/** Range spend, the value the ranking is on. */
	costUsd: number
}

/**
 * Ranks the models across the visible tasks and assigns each a colour.
 *
 * Ranked on SPEND, and on spend even when the card is showing tokens, so the
 * palette is independent of the measure toggle: flipping Tokens↔Cost re-sorts
 * the bars without repainting the segments. A reader who has learnt which band
 * is which keeps that knowledge across the flip.
 *
 * Spend is also what the Model spend card ranks on, so the two use one rule —
 * though not necessarily the same outcome, since that card ranks over every
 * task in the range and this one over the ranked page (see MAX_MODEL_SERIES).
 *
 * Everything past the cap folds into one muted band rather than minting a
 * sixth hue no one can tell from the fifth.
 */
export function rankModelSeries(
	tasks: ReadonlyArray<{ models: ReadonlyArray<{ model: string; costUsd: number }> }>,
	maxSeries: number = MAX_MODEL_SERIES,
): ModelSeries[] {
	const totals = new Map<string, number>()
	for (const task of tasks) {
		for (const entry of task.models) {
			totals.set(entry.model, (totals.get(entry.model) ?? 0) + entry.costUsd)
		}
	}

	// Name ascending on ties so the order (and therefore the colours) is stable
	// across refetches instead of shuffling when two models draw level.
	const ranked = [...totals.entries()].sort((a, b) => {
		const diff = b[1] - a[1]
		return diff !== 0 ? diff : a[0].localeCompare(b[0])
	})

	const series: ModelSeries[] = ranked.slice(0, maxSeries).map(([model, costUsd], index) => ({
		key: model,
		label: model,
		color: `var(--chart-${(index % MAX_MODEL_SERIES) + 1})`,
		costUsd,
	}))

	const dropped = ranked.slice(maxSeries)
	if (dropped.length > 0) {
		series.push({
			key: OTHER_MODEL_KEY,
			label: `other (${dropped.length})`,
			color: 'var(--color-muted-foreground)',
			costUsd: dropped.reduce((sum, [, costUsd]) => sum + costUsd, 0),
		})
	}

	return series
}

/** model name → the series it paints as, folding anything past the cap. */
export function modelSeriesLookup(series: readonly ModelSeries[]): (model: string) => ModelSeries | undefined {
	const byKey = new Map(series.map((entry) => [entry.key, entry]))
	const fold = byKey.get(OTHER_MODEL_KEY)
	return (model: string) => byKey.get(model) ?? fold
}

/* ─────────────────────────────── people ─────────────────────────────── */

/**
 * Contributor colour slots.
 *
 * People have no canonical order the way stages and modes do — there is no
 * "first" person — so, exactly like models, they are ranked over the visible
 * page and take `--chart-N` in that order, with the tail folded into one muted
 * band. Ranked on SPEND even when the card shows tokens, so flipping the
 * measure re-sorts the rows without repainting anyone.
 *
 * Held to the same cap as models: a sixth hue is one no reader can tell from
 * the fifth, and on today's data 99% of tasks have a single contributor
 * anyway, so the cap is reached only on the legend.
 */
export const MAX_PERSON_SERIES = 5

/** Key of the folded tail. */
export const OTHER_PERSON_KEY = '__other_people__'

export interface PersonSeries {
	/** The WorkOS user id, or {@link OTHER_PERSON_KEY} for the fold. */
	key: string
	label: string
	color: string
	/** Range spend, the value the ranking is on. */
	costUsd: number
}

/**
 * Ranks contributors across the visible tasks and assigns each a colour.
 *
 * `nameFor` resolves a display name from the org member list. Someone who has
 * left the org is not in it, and falls back to their raw id rather than having
 * their spend dropped — the same rule the two Spend-by-person cards follow.
 */
export function rankPersonSeries(
	tasks: ReadonlyArray<{ contributors: ReadonlyArray<{ userId: string; costUsd: number }> }>,
	nameFor: (userId: string) => string | undefined,
	maxSeries: number = MAX_PERSON_SERIES,
): PersonSeries[] {
	const totals = new Map<string, number>()
	for (const task of tasks) {
		for (const entry of task.contributors) {
			totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.costUsd)
		}
	}

	// Id ascending on ties, so the order (and therefore the colours) is stable
	// across refetches instead of shuffling when two people draw level.
	const ranked = [...totals.entries()].sort((a, b) => {
		const diff = b[1] - a[1]
		return diff !== 0 ? diff : a[0].localeCompare(b[0])
	})

	const series: PersonSeries[] = ranked.slice(0, maxSeries).map(([userId, costUsd], index) => ({
		key: userId,
		label: nameFor(userId) ?? userId,
		color: `var(--chart-${(index % MAX_PERSON_SERIES) + 1})`,
		costUsd,
	}))

	const dropped = ranked.slice(maxSeries)
	if (dropped.length > 0) {
		series.push({
			key: OTHER_PERSON_KEY,
			label: `other (${dropped.length})`,
			color: 'var(--color-muted-foreground)',
			costUsd: dropped.reduce((sum, [, costUsd]) => sum + costUsd, 0),
		})
	}

	return series
}

/** user id → the series it paints as, folding anyone past the cap. */
export function personSeriesLookup(series: readonly PersonSeries[]): (userId: string) => PersonSeries | undefined {
	const byKey = new Map(series.map((entry) => [entry.key, entry]))
	const fold = byKey.get(OTHER_PERSON_KEY)
	return (userId: string) => byKey.get(userId) ?? fold
}

/* ──────────────────────────── task display ──────────────────────────── */

export interface TaskLabelParts {
	/** The ticket to render as a separate chip, or null when there isn't one to show. */
	ticket: string | null
	/** The task name with a leading duplicate ticket stripped. */
	name: string
}

const LEADING_TICKET = /^\s*\[([A-Z][A-Z0-9]*-\d+)\]\s*/

/**
 * Splits a task into a ticket chip and a name.
 *
 * Tasks created from a ticket usually have the ticket baked into the name as
 * well ("[CORE-1725] new task form v3"), so rendering `ticketId` beside the
 * raw name prints it twice. The leading bracketed form is stripped when it
 * matches, and promoted to the chip when the row has no `ticketId` of its own.
 */
export function taskLabelParts(name: string, ticketId: string | null): TaskLabelParts {
	const match = LEADING_TICKET.exec(name)
	if (!match) return { ticket: ticketId, name: name.trim() }
	const embedded = match[1] ?? null
	return { ticket: ticketId ?? embedded, name: name.slice(match[0].length).trim() }
}

/**
 * Whether a task row shows its contributor count.
 *
 * Only when the answer is not "one". On today's data 99.4% of tasks are a
 * single person, so a mark on every row printed the same word twelve times and
 * carried no information; showing it only on the exceptions is what makes it
 * mean something. The count itself stays in the row's tooltip either way.
 */
export function showsContributorMark(contributorCount: number): boolean {
	return contributorCount > 1
}

/** "2 people" / "3 people" — a count, never a name. */
export function contributorMarkLabel(contributorCount: number): string {
	return `${contributorCount} people`
}

/* ──────────────────────────── formatting ──────────────────────────── */

/**
 * Token counts, compacted. Deliberately coarse: these are raw provider
 * counters running to billions, and no one reads the last three digits of
 * "1,688,412,905".
 */
export function formatTokens(tokens: number): string {
	if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(2)}B`
	if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`
	if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}K`
	return String(Math.round(tokens))
}

/** A share of a whole, one decimal. Returns '—' when the whole is zero. */
export function formatShare(part: number, whole: number): string {
	if (whole <= 0) return '—'
	return `${((part / whole) * 100).toFixed(1)}%`
}

/** The value a bar is drawn from, under the active measure. */
export function measureValue(row: { tokens: number; costUsd: number }, measure: TokenUseMeasure): number {
	return measure === 'cost' ? row.costUsd : row.tokens
}

/**
 * Bar width as a percentage of the longest bar.
 *
 * Floored so a task with real-but-tiny use still paints a sliver — a row with
 * a label, a value and no bar at all reads as a rendering bug rather than as a
 * small number.
 *
 * The floor is sized against the bar COLUMN, which is a fixed 10.5rem (168px):
 * 1.5% is ~2.5px, small enough not to imply magnitude and wide enough to
 * survive rounding. The previous 0.35% dated from when the bar spanned the
 * row's free width; against 168px it rounds to half a pixel, and the lightest
 * tasks in the range drew nothing at all.
 */
export const MIN_BAR_PERCENT = 1.5

export function barWidthPercent(value: number, max: number): number {
	if (max <= 0) return 0
	return Math.max((value / max) * 100, MIN_BAR_PERCENT)
}
