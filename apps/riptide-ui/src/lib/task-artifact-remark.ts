import {
	isBrowserLoadableImageUrl,
	parseTaskArtifactPath,
	TASK_ARTIFACT_MENTION_PATTERN,
} from '@/lib/task-artifact-path'

export const TASK_ARTIFACT_IMAGE_TAG = 'task-artifact-image'
export const TASK_ARTIFACT_MENTION_TAG = 'task-artifact-mention'

interface MarkdownNode {
	type: string
	value?: string
	url?: string
	alt?: string | null
	children?: MarkdownNode[]
	data?: Record<string, unknown>
}

const NON_MENTION_PARENTS = new Set(['link', 'linkReference'])

function decodeUrl(url: string): string {
	try {
		return decodeURI(url)
	} catch {
		return url
	}
}

function visitNodes(node: MarkdownNode, visitor: (node: MarkdownNode) => void) {
	visitor(node)
	for (const child of node.children ?? []) visitNodes(child, visitor)
}

/**
 * File paths are not URLs the browser can load (and rehype-harden blocks the relative
 * ones), so `![](…/.humanlayer/tasks/<slug>/x.png)` becomes an element that resolves the
 * artifact's download URL, and any other file path one that says the file is on the host.
 */
export const remarkTaskArtifactImages = () => (tree: MarkdownNode) => {
	visitNodes(tree, (node) => {
		if (node.type !== 'image' || !node.url) return
		const path = decodeUrl(node.url)
		if (isBrowserLoadableImageUrl(path) && !parseTaskArtifactPath(path)) return
		node.data = {
			...node.data,
			hName: TASK_ARTIFACT_IMAGE_TAG,
			hProperties: { path, alt: node.alt ?? '' },
		}
	})
}

function splitMentions(value: string): MarkdownNode[] | null {
	const nodes: MarkdownNode[] = []
	let lastIndex = 0
	for (const match of value.matchAll(TASK_ARTIFACT_MENTION_PATTERN)) {
		const [mention, path] = match
		if (!path) continue
		if (match.index > lastIndex) nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) })
		nodes.push({
			type: 'emphasis',
			children: [{ type: 'text', value: mention }],
			data: { hName: TASK_ARTIFACT_MENTION_TAG, hProperties: { path } },
		})
		lastIndex = match.index + mention.length
	}
	if (nodes.length === 0) return null
	if (lastIndex < value.length) nodes.push({ type: 'text', value: value.slice(lastIndex) })
	return nodes
}

/** `@.humanlayer/tasks/<slug>/<file>` mentions written by the composer. */
export const remarkTaskArtifactMentions = () => (tree: MarkdownNode) => {
	visitNodes(tree, (node) => {
		if (!node.children || NON_MENTION_PARENTS.has(node.type)) return
		if (node.data?.hName === TASK_ARTIFACT_MENTION_TAG) return
		node.children = node.children.flatMap((child) =>
			child.type === 'text' && child.value ? (splitMentions(child.value) ?? [child]) : [child],
		)
	})
}
