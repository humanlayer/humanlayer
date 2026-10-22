const ASSET_TAG_PATTERN = /<(link|script|img|source|video|audio|iframe|embed|object)\b([^>]*?)>/gi
const ASSET_ATTRIBUTE_PATTERN = /\s(href|src|data)\s*=\s*(["'])([^"']+)\2/i
const STYLESHEET_REL_PATTERN = /\srel\s*=\s*(["'])[^"']*\bstylesheet\b[^"']*\1/i
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

export type RelativeAssetUrlResolver = (reference: string) => Promise<string | null>
export type AssetTextFetcher = (url: string) => Promise<string | null>

export interface RewrittenHtmlDocument {
	html: string
	rewrittenCount: number
	unresolved: string[]
}

interface AssetReference {
	tag: string
	attributes: string
	attributeName: string
	quote: string
	reference: string
}

export function isRelativeAssetReference(value: string): boolean {
	const reference = value.trim()
	if (!reference || reference.startsWith('#') || reference.startsWith('/')) return false
	return !URL_SCHEME_PATTERN.test(reference)
}

export function collectRelativeAssetReferences(html: string): string[] {
	const references = new Set<string>()
	for (const match of html.matchAll(ASSET_TAG_PATTERN)) {
		const parsed = parseAssetTag(match[1] ?? '', match[2] ?? '')
		if (parsed) references.add(parsed.reference)
	}
	return [...references]
}

export function resolveArtifactSubpath(sourceFileName: string, reference: string): string | null {
	const [pathPart = ''] = reference.trim().split(/[?#]/)
	const segments = sourceFileName.split('/').slice(0, -1)
	for (const rawSegment of pathPart.split('/')) {
		if (rawSegment === '' || rawSegment === '.') continue
		if (rawSegment === '..') {
			if (segments.length === 0) return null
			segments.pop()
			continue
		}
		segments.push(safeDecode(rawSegment))
	}
	return segments.length > 0 ? segments.join('/') : null
}

export const fetchAssetText: AssetTextFetcher = async (url) => {
	const response = await fetch(url)
	return response.ok ? response.text() : null
}

// Stylesheets and scripts are inlined rather than re-linked: S3 serves sibling
// artifacts without a text/css or JavaScript content type, and browsers refuse
// stylesheets and module scripts whose MIME type does not match.
export async function rewriteRelativeAssets(
	html: string,
	resolve: RelativeAssetUrlResolver,
	fetchText: AssetTextFetcher = fetchAssetText,
): Promise<RewrittenHtmlDocument> {
	const references = collectRelativeAssetReferences(html)
	const resolved = new Map<string, string>()
	const unresolved: string[] = []

	await Promise.all(
		references.map(async (reference) => {
			const url = await resolve(reference).catch(() => null)
			if (url) resolved.set(reference, url)
			else unresolved.push(reference)
		}),
	)

	if (resolved.size === 0) return { html, rewrittenCount: 0, unresolved }

	const inlineText = new Map<string, string | null>()
	const inlineCandidates = new Set<string>()
	for (const match of html.matchAll(ASSET_TAG_PATTERN)) {
		const parsed = parseAssetTag(match[1] ?? '', match[2] ?? '')
		if (parsed && resolved.has(parsed.reference) && inlineKind(parsed)) inlineCandidates.add(parsed.reference)
	}
	await Promise.all(
		[...inlineCandidates].map(async (reference) => {
			const text = await fetchText(resolved.get(reference) ?? '').catch(() => null)
			inlineText.set(reference, text)
		}),
	)

	let rewrittenCount = 0
	const rewritten = html.replace(ASSET_TAG_PATTERN, (match, tag: string, attributes: string) => {
		const parsed = parseAssetTag(tag, attributes)
		if (!parsed) return match
		const url = resolved.get(parsed.reference)
		if (!url) return match
		rewrittenCount += 1

		const kind = inlineKind(parsed)
		const text = kind ? inlineText.get(parsed.reference) : null
		if (kind === 'stylesheet' && text != null) {
			return `<style>${text.replaceAll(/<\/style/gi, '<\\/style')}</style>`
		}
		if (kind === 'script' && text != null) {
			const remainingAttributes = attributes.replace(ASSET_ATTRIBUTE_PATTERN, '').replace(/\s+$/, '')
			return `<script${remainingAttributes}>${text.replaceAll(/<\/script/gi, '<\\/script')}`
		}

		const swapped = attributes.replace(
			ASSET_ATTRIBUTE_PATTERN,
			` ${parsed.attributeName}=${parsed.quote}${escapeAttributeValue(url)}${parsed.quote}`,
		)
		return `<${tag}${swapped}>`
	})

	return { html: rewritten, rewrittenCount, unresolved }
}

function parseAssetTag(tag: string, attributes: string): AssetReference | null {
	const attribute = ASSET_ATTRIBUTE_PATTERN.exec(attributes)
	if (!attribute) return null
	const [, attributeName = '', quote = '"', reference = ''] = attribute
	if (!isRelativeAssetReference(reference)) return null
	return { tag: tag.toLowerCase(), attributes, attributeName, quote, reference }
}

function inlineKind(asset: AssetReference): 'stylesheet' | 'script' | null {
	if (asset.tag === 'link' && asset.attributeName === 'href' && STYLESHEET_REL_PATTERN.test(asset.attributes)) {
		return 'stylesheet'
	}
	if (asset.tag === 'script' && asset.attributeName === 'src') return 'script'
	return null
}

function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

function escapeAttributeValue(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
