import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { revisionBase } from '@/minimalist/lib/doc-diff'
import { useRiptideApi } from '@/orpc/client'

/**
 * A document's saved versions: reading an older one as it was, and comparing the latest with the
 * text from before the agent's latest revision. Versions load quietly; a failure shows in place.
 */
export function useDocHistory(artifactId: string) {
	const { queryClient: orpc } = useRiptideApi()
	const versions = useQuery({
		...orpc.artifacts.versions.list.queryOptions({ input: { artifactId }, context: { silent: true } }),
		retry: false,
	}).data
	const version = (versionId: string | null, enabled: boolean) => ({
		...orpc.artifacts.versions.get.queryOptions({
			input: { artifactId, versionId: versionId ?? '' },
			context: { silent: true },
		}),
		enabled: enabled && versionId !== null,
		retry: false,
	})

	const [readingId, setReadingId] = useState<string | null>(null)
	const reading = useQuery(version(readingId, true))
	const [comparing, setComparing] = useState(false)
	const base = versions ? revisionBase(versions.archived) : null
	const compared = useQuery(version(base?.id ?? null, comparing))

	return {
		versions,
		/** The older version on screen, or null while the latest is. */
		readingId,
		read: setReadingId,
		old: reading.data,
		oldFailed: reading.isError,
		oldLoading: readingId !== null && reading.isPending,
		/** What "Show changes" compares against; null until there is an earlier version. */
		base,
		comparing: comparing && base !== null,
		compare: setComparing,
		baseContent: compared.data?.content,
		baseFailed: compared.isError,
	}
}

export type DocHistory = ReturnType<typeof useDocHistory>
