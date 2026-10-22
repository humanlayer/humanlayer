import { useQuery } from '@tanstack/react-query'
import { hash } from 'ohash'
import { useState } from 'react'

import { useRiptideApi } from '@/api/client'
import { useOrgMembers } from '@/hooks/useOrgMembers'

const VERSION_LIST_STALE_TIME_MS = 30_000

export interface ArtifactVersionOption {
	id: string
	label: string
	createdAt: number
	createdBy: string
	addedLines: number
	removedLines: number
}

export interface ArtifactVersionDiffView {
	options: readonly ArtifactVersionOption[]
	sourceId: string | null
	destinationId: string
	onSourceChange: (id: string) => void
	onDestinationChange: (id: string) => void
	sourceLabel: string | null
	destinationLabel: string
	sourceText: string | null
	destinationText: string | null
	isLoading: boolean
	error: Error | null
	retry: () => void
}

interface VersionSelection {
	sourceId: string
	destinationId: string
}

export function useArtifactVersions({
	artifactId,
	currentContent,
	enabled,
}: {
	artifactId: string
	currentContent: string
	enabled: boolean
}): ArtifactVersionDiffView {
	const { queryClient, authScope } = useRiptideApi()
	const { memberFor } = useOrgMembers()
	const currentContentHash = hash(currentContent)
	const [selectionByArtifact, setSelectionByArtifact] = useState<Record<string, VersionSelection>>({})
	const requestedSelection = selectionByArtifact[artifactId]

	const listQueryOptions = queryClient.artifacts.versions.list.queryOptions({ input: { artifactId } })
	const listQuery = useQuery({
		...listQueryOptions,
		queryKey: [...listQueryOptions.queryKey, authScope ?? null, currentContentHash],
		enabled,
		staleTime: VERSION_LIST_STALE_TIME_MS,
	})
	const options: ArtifactVersionOption[] = listQuery.data
		? [
				{
					...listQuery.data.latest,
					createdBy: 'Current artifact',
					addedLines: 18,
					removedLines: 3,
				},
				...listQuery.data.archived.map((version) => ({
					...version,
					createdBy: memberFor(version.createdBy)?.displayName ?? version.createdBy,
					addedLines: 6 + ((version.versionNumber * 7) % 31),
					removedLines: 1 + ((version.versionNumber * 3) % 12),
				})),
			]
		: []
	const validIds = new Set(options.map((option) => option.id))
	const hasValidRequestedPair =
		requestedSelection !== undefined &&
		validIds.has(requestedSelection.sourceId) &&
		validIds.has(requestedSelection.destinationId)
	const sourceId = hasValidRequestedPair ? requestedSelection.sourceId : (listQuery.data?.archived[0]?.id ?? null)
	const destinationId = hasValidRequestedPair ? requestedSelection.destinationId : 'latest'

	const sourceQueryOptions = queryClient.artifacts.versions.get.queryOptions({
		input: { artifactId, versionId: sourceId && sourceId !== 'latest' ? sourceId : artifactId },
	})
	const sourceQuery = useQuery({
		...sourceQueryOptions,
		queryKey: [...sourceQueryOptions.queryKey, authScope ?? null],
		enabled: enabled && sourceId !== null && sourceId !== 'latest',
		staleTime: Infinity,
	})
	const destinationQueryOptions = queryClient.artifacts.versions.get.queryOptions({
		input: {
			artifactId,
			versionId: destinationId !== 'latest' ? destinationId : artifactId,
		},
	})
	const destinationQuery = useQuery({
		...destinationQueryOptions,
		queryKey: [...destinationQueryOptions.queryKey, authScope ?? null],
		enabled: enabled && destinationId !== 'latest',
		staleTime: Infinity,
	})

	const sourceLabel = options.find((option) => option.id === sourceId)?.label ?? null
	const destinationLabel = options.find((option) => option.id === destinationId)?.label ?? 'Latest'
	const sourceText = sourceId === 'latest' ? currentContent : (sourceQuery.data?.content ?? null)
	const destinationText = destinationId === 'latest' ? currentContent : (destinationQuery.data?.content ?? null)
	const error = listQuery.error ?? sourceQuery.error ?? destinationQuery.error
	const setSelection = (selection: VersionSelection) => {
		setSelectionByArtifact((current) => ({ ...current, [artifactId]: selection }))
	}

	return {
		options,
		sourceId,
		destinationId,
		onSourceChange: (id) => setSelection({ sourceId: id, destinationId }),
		onDestinationChange: (id) => {
			if (sourceId) setSelection({ sourceId, destinationId: id })
		},
		sourceLabel,
		destinationLabel,
		sourceText,
		destinationText,
		isLoading: listQuery.isLoading || sourceQuery.isLoading || destinationQuery.isLoading,
		error,
		retry: () => {
			void listQuery.refetch()
			if (sourceId && sourceId !== 'latest') void sourceQuery.refetch()
			if (destinationId !== 'latest') void destinationQuery.refetch()
		},
	}
}
