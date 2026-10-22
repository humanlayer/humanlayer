import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { createRangeAnchor, pmTextBetween } from '../anchor/block-text-offsets'
import { normalizeAnchorText, transformQuoteText } from '../anchor/doc-text-search'
import type { AnchorV2 } from '../anchor/types'

/**
 * A serializable, verified precise selection: the exact PM range, the V2 anchor
 * to persist, the agreed quote, and the toolbar rectangle. Produced only when
 * the custom rendered-range quote and the PM segment-mapped quote normalize to
 * the same text.
 */
export interface SelectionIntent {
	from: number
	to: number
	anchor: AnchorV2
	quote: string
	/** Selection rectangle for the floating toolbar; null when unavailable. */
	rect: DOMRect | null
}

export type SelectionResult =
	| { status: 'selection'; intent: SelectionIntent }
	| { status: 'empty' }
	| { status: 'mismatch'; reason: string }

/** Two quotes agree if they normalize equal, or agree after typographic folding. */
function quotesAgree(a: string, b: string): boolean {
	if (normalizeAnchorText(a) === normalizeAnchorText(b)) return true
	return transformQuoteText(a) === transformQuoteText(b)
}

/**
 * Reconcile one normalized rendered range with the live ProseMirror selection
 * and the exact segment map. Acceptance requires the rendered quote and the
 * PM-derived quote to normalize to the same text; on disagreement the target is
 * non-persistable and cleared with a diagnostic rather than persisting an
 * approximate anchor. A collapsed range is `empty` (the focused-block target
 * remains authoritative).
 *
 * This is the pure core; `MarkdownViewerV2` supplies `from`/`to` from
 * `editor.state.selection` and `renderedQuote`/`rect` from the DOM adapter.
 */
export function buildSelectionIntent(
	doc: ProseMirrorNode,
	from: number,
	to: number,
	renderedQuote: string,
	rect: DOMRect | null,
): SelectionResult {
	const lo = Math.min(from, to)
	const hi = Math.max(from, to)
	if (hi <= lo) return { status: 'empty' }

	const pmQuote = pmTextBetween(doc, lo, hi)
	if (normalizeAnchorText(pmQuote).length === 0) return { status: 'empty' }

	if (!quotesAgree(renderedQuote, pmQuote)) {
		return {
			status: 'mismatch',
			reason: 'Rendered selection and document text disagree; not persisting an approximate anchor.',
		}
	}

	const anchor = createRangeAnchor(doc, lo, hi)
	if (!anchor) return { status: 'mismatch', reason: 'Selection endpoints are not within commentable text.' }

	// Persist the exact rendered quote (block newlines preserved); resolution
	// compares normalized, so either quote round-trips.
	return { status: 'selection', intent: { from: lo, to: hi, anchor, quote: renderedQuote, rect } }
}
