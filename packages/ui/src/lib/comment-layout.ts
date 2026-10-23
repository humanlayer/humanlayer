type ThreadItem = {
	threads: Array<{ root: { id: string } }>
	top: number
}

/**
 * Sum the measured (or estimated) heights of all threads in a group,
 * including inter-thread gaps.
 */
export function computeThreadGroupHeight(
	threads: Array<{ root: { id: string } }>,
	measuredHeights: Map<string, number>,
	gap: number,
	defaultHeight: number,
): number {
	let total = 0
	for (let i = 0; i < threads.length; i++) {
		total += measuredHeights.get(threads[i]!.root.id) ?? defaultHeight
		if (i < threads.length - 1) total += gap
	}
	return total
}

/**
 * Walk positioned items bottom-to-top, clamping any thread whose bottom edge
 * would extend past `containerHeight`. Each item respects the floor set by the
 * item above it so threads never overlap. Stops early once an item fits
 * (all items above are guaranteed to fit too).
 *
 * Mutates `items[].top` in place.
 */
export function reverseClampToContainer(
	items: ThreadItem[],
	containerHeight: number,
	measuredHeights: Map<string, number>,
	gap: number,
	defaultHeight: number,
): void {
	if (containerHeight <= 0 || items.length === 0) return

	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!
		const itemHeight = computeThreadGroupHeight(item.threads, measuredHeights, gap, defaultHeight)
		const maxTop = containerHeight - itemHeight - gap

		if (item.top <= maxTop) break

		const floor =
			i > 0
				? items[i - 1]!.top +
					computeThreadGroupHeight(items[i - 1]!.threads, measuredHeights, gap, defaultHeight) +
					gap
				: 0

		item.top = Math.max(floor, maxTop)
	}
}
