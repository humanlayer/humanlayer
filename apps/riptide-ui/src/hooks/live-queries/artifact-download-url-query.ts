import type { useRiptideApi } from '@/orpc/client'

type QueryClient = ReturnType<typeof useRiptideApi>['queryClient']

export function artifactDownloadUrlQueryOptions(
	api: QueryClient,
	artifact: { id: string; last_updated_at: bigint } | null | undefined,
) {
	const options = api.uploads.downloadUrl.queryOptions({ input: { artifactId: artifact?.id ?? '' } })
	return {
		...options,
		queryKey: [...options.queryKey, artifact?.last_updated_at.toString()],
	}
}
