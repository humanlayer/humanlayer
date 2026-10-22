import {
	parseApplyPatch,
	parseToolInput,
	type ApplyPatchToolInput,
	type ConversationEvent,
	type WriteToolInput,
} from '@humanlayer/ui/components/conversation-stream'
import { normalizeToolName } from '@humanlayer/ui/lib/tool-names'

export interface CurrentArtifactReference {
	id: string
	path: string
	frontmatterType?: string | null
	isDeleted?: boolean
}

export const SHAREABLE_CONVERSATION_ARTIFACT_TYPES = new Set([
	'design-discussion',
	'design-prd',
	'design-tdd',
	'structure-outline',
])

function normalizeAbsolutePath(path: string): string | null {
	const slashPath = path.replaceAll('\\', '/')
	if (!slashPath.startsWith('/')) return null

	const segments: string[] = []
	for (const segment of slashPath.split('/')) {
		if (!segment || segment === '.') continue
		if (segment === '..') {
			if (segments.length === 0) return null
			segments.pop()
			continue
		}
		segments.push(segment)
	}
	return `/${segments.join('/')}`
}

function resolvePath(workingDirectory: string, path: string): string | null {
	const slashPath = path.replaceAll('\\', '/')
	return normalizeAbsolutePath(slashPath.startsWith('/') ? slashPath : `${workingDirectory}/${slashPath}`)
}

function taskArtifactRoot(path: string): string | null {
	const match = path.match(/^(.*?\.humanlayer\/tasks\/[^/]+)(?:\/|$)/)
	return match?.[1] ?? null
}

/**
 * Build an exact-path resolver over the current task's synchronized artifacts.
 * The returned function performs no queries, so virtualized rows can share it.
 */
export function createCurrentArtifactResolver({
	workingDirectory,
	artifacts,
}: {
	workingDirectory: string | null | undefined
	artifacts: CurrentArtifactReference[]
}): (filePath: string) => CurrentArtifactReference | null {
	const normalizedWorkingDirectory = workingDirectory ? normalizeAbsolutePath(workingDirectory) : null
	if (!normalizedWorkingDirectory) return () => null

	const indexedArtifacts = artifacts.flatMap((artifact) => {
		if (artifact.isDeleted) return []
		const absolutePath = resolvePath(normalizedWorkingDirectory, artifact.path)
		const root = absolutePath ? taskArtifactRoot(absolutePath) : null
		return absolutePath && root ? [{ artifact, absolutePath, root }] : []
	})

	return (filePath) => {
		const candidate = resolvePath(normalizedWorkingDirectory, filePath)
		if (!candidate) return null
		const matches = indexedArtifacts.filter(
			({ absolutePath, root }) => candidate === absolutePath && candidate.startsWith(`${root}/`),
		)
		return matches.length === 1 ? (matches[0]?.artifact ?? null) : null
	}
}

const WRITE_CREATED_RESULT_PATTERN = /^File created successfully at:\s*.+/i

/** Return only paths from completed operations that prove they created a file. */
export function getCreatedFilePaths(event: ConversationEvent, toolResult?: ConversationEvent): string[] {
	if (event.eventType !== 'tool_call' || !event.isCompleted) return []
	const normalizedToolName = normalizeToolName(event.toolName)

	if (normalizedToolName === 'write') {
		const input = parseToolInput<WriteToolInput>(event.toolInputJson)
		const result = toolResult?.toolResultContent ?? event.toolResultContent
		return input?.file_path && result && WRITE_CREATED_RESULT_PATTERN.test(result.trim()) ? [input.file_path] : []
	}

	if (normalizedToolName === 'applypatch') {
		const input = parseToolInput<ApplyPatchToolInput>(event.toolInputJson)
		if (typeof input?.patch_text !== 'string') return []
		return parseApplyPatch(input.patch_text)
			.filter((operation) => operation.type === 'add')
			.map((operation) => operation.filePath)
	}

	return []
}

export function isShareableConversationArtifact(artifact: CurrentArtifactReference): boolean {
	return !!artifact.frontmatterType && SHAREABLE_CONVERSATION_ARTIFACT_TYPES.has(artifact.frontmatterType)
}
