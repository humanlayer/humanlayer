import type { DocPoint } from '@/minimalist/lib/doc-anchors'
import { domRange } from '@/minimalist/lib/doc-selection'

type Span = { start: DocPoint; end: DocPoint }

const NAME = 'minimalist-comment'
/** Every mounted document's marked ranges. The registry holds one highlight per name, so they share it. */
const marked = new Map<Element, Range[]>()

function publish() {
	if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
	const ranges = [...marked.values()].flat()
	if (ranges.length > 0) CSS.highlights.set(NAME, new Highlight(...ranges))
	else CSS.highlights.delete(NAME)
}

/**
 * A ref for a rendered document that marks the words comments are about. It uses the CSS highlight
 * registry, so the markdown's DOM is never touched; a new list of spans replaces the old one.
 */
export function markSpans(spans: readonly Span[]) {
	return (root: HTMLElement | null) => {
		if (!root) return
		marked.set(
			root,
			spans.flatMap((span) => domRange(root, span.start, span.end) ?? []),
		)
		publish()
		return () => {
			marked.delete(root)
			publish()
		}
	}
}
