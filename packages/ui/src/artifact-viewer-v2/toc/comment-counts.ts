import type { ArtifactCommentProjection, ProjectedCommentThread } from '../comments/project-comments'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import type { OutlineItem } from './build-outline'

/** An outline row enriched with its direct, open review count. */
export interface CountedOutlineItem extends Omit<OutlineItem, 'children'> {
	commentCount: number
	children: CountedOutlineItem[]
}

/**
 * Add direct-section counts from the controller's existing comment projection.
 * Each eligible root is assigned once, using the section of the block that
 * contains the resolved placement start. Child-section counts never roll up.
 */
export function addOpenCommentCounts(
	items: OutlineItem[],
	blocks: NavigableBlock[],
	projection: ArtifactCommentProjection | null,
): CountedOutlineItem[] {
	const counts = new Map<string, number>()

	for (const thread of projection?.threads ?? []) {
		const sectionId = sectionForOpenRoot(thread, blocks)
		if (sectionId) counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1)
	}

	const enrich = (item: OutlineItem): CountedOutlineItem => ({
		...item,
		commentCount: counts.get(item.id) ?? 0,
		children: item.children.map(enrich),
	})

	return items.map(enrich)
}

function sectionForOpenRoot(thread: ProjectedCommentThread, blocks: NavigableBlock[]): string | null {
	if (
		thread.root.reply_to_comment_id != null ||
		thread.root.is_deleted ||
		thread.root.is_resolved ||
		thread.placement.status !== 'resolved'
	) {
		return null
	}

	const startBlock = blocks.find(
		(block) => thread.placement.status === 'resolved' && thread.placement.from >= block.pos && thread.placement.from < block.end,
	)
	return startBlock?.sectionId ?? null
}
