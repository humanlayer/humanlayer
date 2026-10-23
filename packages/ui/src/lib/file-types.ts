const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff)$/i
const PDF_EXTENSION = /\.pdf$/i
const HTML_EXTENSION = /\.html?$/i
const MARKDOWN_EXTENSION = /\.mdx?$/i
const JSON_EXTENSION = /\.json$/i
const JSONL_EXTENSION = /\.jsonl$/i

export type ArtifactFileViewMode = 'rendered' | 'raw'
export type ArtifactRendererKind = 'markdown' | 'json-tree' | 'raw'

export function isImageFile(fileName: string): boolean {
	return IMAGE_EXTENSIONS.test(fileName)
}

export function isPdfFile(fileName: string): boolean {
	return PDF_EXTENSION.test(fileName)
}

export function isHtmlFile(fileName: string): boolean {
	return HTML_EXTENSION.test(fileName)
}

export function isMarkdownFile(fileName: string): boolean {
	return MARKDOWN_EXTENSION.test(fileName)
}

export function isJsonFile(fileName: string): boolean {
	return JSON_EXTENSION.test(fileName)
}

export function isJsonlFile(fileName: string): boolean {
	return JSONL_EXTENSION.test(fileName)
}

export function isStructuredArtifactFile(fileName: string): boolean {
	return isJsonFile(fileName) || isJsonlFile(fileName)
}

export function isRenderedArtifactFile(fileName: string): boolean {
	return isMarkdownFile(fileName) || isStructuredArtifactFile(fileName)
}

export function clampArtifactViewMode(fileName: string, mode: ArtifactFileViewMode): ArtifactFileViewMode {
	return isRenderedArtifactFile(fileName) ? mode : 'raw'
}

export function getDefaultArtifactViewMode(fileName: string): ArtifactFileViewMode {
	return isRenderedArtifactFile(fileName) ? 'rendered' : 'raw'
}

export function getArtifactRendererKind(
	fileName: string,
	mode: ArtifactFileViewMode,
): ArtifactRendererKind {
	if (mode === 'raw') return 'raw'
	if (isMarkdownFile(fileName)) return 'markdown'
	if (isStructuredArtifactFile(fileName)) return 'json-tree'
	return 'raw'
}

export function isPreviewableFile(fileName: string): boolean {
	return isImageFile(fileName) || isPdfFile(fileName) || isHtmlFile(fileName)
}
