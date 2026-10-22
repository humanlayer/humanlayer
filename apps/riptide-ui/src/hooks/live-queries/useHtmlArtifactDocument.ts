import { isHtmlFile } from '@humanlayer/ui/lib/file-types'
import { resolveArtifactSubpath, rewriteRelativeAssets } from '@humanlayer/ui/lib/html-artifact-assets'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Key } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useRiptideApi } from '@/orpc/client'

const DOWNLOAD_URL_STALE_TIME_MS = 4 * 60 * 60 * 1000

interface HtmlArtifactDocumentParams {
	artifactId?: string | null
	fileName?: string
	imageUrl?: string | null
	storageType?: string
	iframeRenderKey?: Key
}

// Every S3 artifact is served from its own presigned URL, so a relative
// <link>/<script>/<img> inside an HTML artifact 403s unless it is rewritten
// to the sibling artifact's presigned URL first.
export function useHtmlArtifactDocument({
	artifactId,
	fileName,
	imageUrl,
	storageType,
	iframeRenderKey,
}: HtmlArtifactDocumentParams): string | null {
	const { artifactsMetadataCollection } = useSync()
	const { queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()

	const enabled = Boolean(artifactId && imageUrl && storageType === 's3' && isHtmlFile(fileName ?? ''))

	const { data } = useQuery({
		queryKey: ['html-artifact-document', artifactId, imageUrl, iframeRenderKey?.toString() ?? null],
		enabled,
		staleTime: Infinity,
		retry: false,
		queryFn: async (): Promise<string | null> => {
			if (!artifactId || !imageUrl) return null
			const source = artifactsMetadataCollection.get(artifactId)
			if (!source?.task_id) return null

			const response = await fetch(imageUrl)
			if (!response.ok) return null
			const html = await response.text()

			const { html: rewritten, rewrittenCount } = await rewriteRelativeAssets(html, async (reference) => {
				const siblingFileName = resolveArtifactSubpath(source.file_name, reference)
				if (!siblingFileName) return null
				const sibling = artifactsMetadataCollection.toArray.find(
					(artifact) =>
						artifact.task_id === source.task_id &&
						artifact.file_name === siblingFileName &&
						!artifact.is_deleted &&
						artifact.storage_type === 's3',
				)
				if (!sibling) return null
				const { downloadUrl } = await tanstackQueryClient.fetchQuery({
					...artifactDownloadUrlQueryOptions(api, sibling),
					staleTime: DOWNLOAD_URL_STALE_TIME_MS,
					retry: false,
				})
				return downloadUrl
			})

			return rewrittenCount > 0 ? rewritten : null
		},
	})

	return enabled ? (data ?? null) : null
}
