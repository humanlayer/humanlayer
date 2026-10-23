export function buildArtifactHeadingLink(
	currentHref: string,
	artifactId: string,
	headingId: string,
	displayMode: 'sidebar' | 'fullscreen',
): string {
	const url = new URL(currentHref)
	url.searchParams.set('artifactId', artifactId)
	url.searchParams.set('headingId', headingId)
	url.searchParams.delete('forceViewerV2')
	if (displayMode === 'fullscreen') url.searchParams.set('fullscreen', 'true')
	else url.searchParams.delete('fullscreen')
	url.searchParams.delete('commentId')
	return url.toString()
}
