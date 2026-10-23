import { isHtmlFile } from '@humanlayer/ui/lib/file-types'

import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { isImageFileName } from '@/lib/task-artifact-path'

/**
 * What a reader should see: no YAML frontmatter (the panel header already shows it)
 * and no HTML comments, which carry machine trailers like `HumanLayer-Session:`.
 * Comments inside fenced code stay, since there they are the content.
 */
export function body(markdown: string): string {
	return markdown
		.replace(/^---\n[\s\S]*?\n---\n?/, '')
		.split(/((?:^|\n)(?:```+|~~~+)[^\n]*\n[\s\S]*?\n(?:```+|~~~+)[^\S\n]*(?=\n|$))/)
		.map((part, index) => (index % 2 === 1 ? part : part.replace(/<!--[\s\S]*?-->\n?/g, '')))
		.join('')
		.trimEnd()
}

export function artifactName(fileName: string): string {
	// Uploads carry a uuid prefix to stay unique; people know them by the original name.
	return fileName
		.slice(fileName.lastIndexOf('/') + 1)
		.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, '')
}

/** Top-level markdown blocks: split on blank lines, keeping fenced code whole. */
export function splitBlocks(markdown: string): string[] {
	const blocks: string[] = []
	let current: string[] = []
	let fence: string | null = null
	for (const line of markdown.split('\n')) {
		const marker = line.match(/^\s*(```+|~~~+)/)?.[1]
		if (marker && (fence === null || marker.startsWith(fence))) fence = fence === null ? marker : null
		if (fence === null && !marker && line.trim() === '') {
			if (current.length) blocks.push(current.join('\n'))
			current = []
			continue
		}
		current.push(line)
	}
	if (current.length) blocks.push(current.join('\n'))
	return blocks
}

/** The block's text as a reader sees it, which is what comments anchor to. */
export function plainText(markdown: string): string {
	return markdown
		.replace(/^\s*(```+|~~~+).*$/gm, '')
		.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|\*|_|~~|`)/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * The task artifact a written file becomes. The daemon syncs files under
 * .humanlayer/tasks/<slug>/, and the part after the slug is the artifact's file_name.
 */
export function artifactPath(filePath: string): { slug: string; fileName: string } | null {
	const match = filePath.match(/\/\.humanlayer\/tasks\/([^/]+)\/(.+)$/)
	return match?.[1] && match[2] ? { slug: match[1], fileName: match[2] } : null
}

const DOC_KINDS: Array<[string, string]> = [
	['research', 'Research'],
	['questions', 'Questions'],
	['prd', 'PRD'],
	['design', 'Design'],
	['outline', 'Outline'],
	['structure', 'Outline'],
	['plan', 'Plan'],
	['description', 'PR description'],
	['review', 'Review'],
	['notes', 'Notes'],
]

/** What kind of document a file is, read from the words in its name ("01-research-x.md" is Research). */
export function docKind(fileName: string): string {
	const words = new Set(
		artifactName(fileName)
			.toLowerCase()
			.split(/[^a-z]+/),
	)
	return DOC_KINDS.find(([word]) => words.has(word))?.[1] ?? 'Document'
}

export type Heading = { index: number; depth: number; text: string }

/** Top-level blocks that are H1–H3 headings: a document's outline. */
export function headingsOf(blocks: readonly string[]): Heading[] {
	return blocks.flatMap((block, index) => {
		const [, hashes, text] = block.match(/^(#{1,3})\s+(.+)/) ?? []
		return hashes && text ? [{ index, depth: hashes.length, text: plainText(text) }] : []
	})
}

export function wordCount(markdown: string): number {
	return plainText(body(markdown)).split(' ').filter(Boolean).length
}

/**
 * Files you attached for the agent, which upload under `uploads/`, and images or archives
 * however they arrived: they aren't documents to read or comment on.
 */
export function isAttachment(artifact: Pick<TaskArtifact, 'file_name'>): boolean {
	return artifact.file_name.startsWith('uploads/') || /\.(png|jpe?g|gif|webp|svg|pdf|zip)$/i.test(artifact.file_name)
}

/** An image the agent saved in the task, such as a screenshot. Your own uploads stay attachments. */
export function isImageArtifact(artifact: Pick<TaskArtifact, 'file_name'>): boolean {
	return !artifact.file_name.startsWith('uploads/') && isImageFileName(artifact.file_name)
}

/** A web page the agent saved, such as a mockup. It runs in a frame rather than reading as markdown. */
export function isHtmlArtifact(artifact: Pick<TaskArtifact, 'file_name'>): boolean {
	return isHtmlFile(artifact.file_name)
}

/** What a task's artifact lists show: documents and the agent's images, not attachments or archives. */
export function isListedArtifact(artifact: Pick<TaskArtifact, 'file_name'>): boolean {
	return !isAttachment(artifact) || isImageArtifact(artifact)
}

/** The task's own prompt, saved as task.md. The thread already shows it, so it never leads the panel. */
export function isPromptArtifact(artifact: Pick<TaskArtifact, 'file_name'>): boolean {
	return artifactName(artifact.file_name) === 'task.md'
}

/** The paths in a ```task-artifact block, one per line. */
export function taskArtifactPaths(source: string): string[] {
	return source
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
}
