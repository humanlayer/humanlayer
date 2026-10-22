import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'

import { useIsColocated } from '@/hooks/use-colocated'
import { fuzzySearchFiles } from '@/integrations/desktop/filesystem'
import { artifactName, isAttachment, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { useTaskArtifacts } from '@/minimalist/lib/data'

/** Where `@` looks: the task's documents, and the working directory when this machine runs the host. */
export type MentionScope = { taskId: string | null; hostId: string | null; directory: string | null }

export type Mention = { key: string; label: string; detail: string; insert: string; kind: 'doc' | 'file' | 'dir' }

/** The `@word` being typed at the caret, or null. An @ inside a word (an email) is not a mention. */
export function mentionAt(value: string, caret: number): { start: number; query: string } | null {
	const query = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret))?.[1]
	return query === undefined ? null : { start: caret - query.length - 1, query }
}

/** Replaces the `@word` with the chosen mention and a space, returning where the caret goes. */
export function insertMention(
	value: string,
	at: { start: number; query: string },
	text: string,
): { value: string; caret: number } {
	const rest = value.slice(at.start + 1 + at.query.length)
	return { value: `${value.slice(0, at.start)}${text} ${rest.replace(/^ /, '')}`, caret: at.start + text.length + 1 }
}

const MAX = 10

/** What `@query` offers: matching task documents first, then files. Empty while no mention is being typed. */
export function useMentions(query: string | null, scope: MentionScope | undefined): Mention[] {
	const artifacts = useTaskArtifacts(scope?.taskId ?? null)
	const { isColocated } = useIsColocated(scope?.hostId)
	const debounced = useDebounce(query ?? '', 120)
	const directory = scope?.directory ?? null
	const files = useQuery({
		queryKey: ['minimalist-mentions', directory, debounced],
		queryFn: () => fuzzySearchFiles(debounced, directory ? [directory] : [], MAX),
		enabled: query !== null && isColocated && directory !== null && debounced.length > 0,
		placeholderData: keepPreviousData,
	})
	if (query === null) return []
	const needle = query.toLowerCase()
	const docs: Mention[] = artifacts
		.filter((artifact) => artifact.task_slug && !isPromptArtifact(artifact) && !isAttachment(artifact))
		.filter((artifact) => artifactName(artifact.file_name).toLowerCase().includes(needle))
		.slice(0, 6)
		.map((artifact) => ({
			key: artifact.id,
			label: artifactName(artifact.file_name),
			detail: 'Task document',
			insert: `@.humanlayer/tasks/${artifact.task_slug}/${artifact.file_name}`,
			kind: 'doc',
		}))
	const found: Mention[] = (query ? (files.data ?? []) : []).map((match) => ({
		key: match.path,
		label: match.display_path.slice(match.display_path.lastIndexOf('/') + 1) || match.display_path,
		detail: match.display_path,
		insert: `@${match.path}`,
		kind: match.is_directory ? 'dir' : 'file',
	}))
	return [...docs, ...found].slice(0, MAX)
}
