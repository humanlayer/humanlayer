export const PRODUCT_NAME = 'HumanLayer'

export function formatDocumentTitle({
	resourceName,
	artifactFilename,
	isArtifactFullscreen,
	defaultTitle = PRODUCT_NAME,
}: {
	resourceName?: string | null
	artifactFilename?: string | null
	isArtifactFullscreen: boolean
	defaultTitle?: string
}): string {
	const visibleName = isArtifactFullscreen && artifactFilename ? artifactFilename : resourceName
	return visibleName ? `${visibleName} | ${PRODUCT_NAME}` : defaultTitle
}
