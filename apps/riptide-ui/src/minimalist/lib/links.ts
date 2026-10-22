/** Where a link in a message or document leads. */
export type LinkTarget =
	/** A document's page in the cloud app, or its share link: it opens in its task's side panel, on the comment it names. */
	| { kind: 'document'; artifactId: string; commentId?: string; href: string }
	/** A page of this app: it opens here, not in a new tab. */
	| { kind: 'app'; path: string }
	| { kind: 'external'; href: string }
	/** A place in the same page, like a footnote. */
	| { kind: 'anchor'; href: string }
	/** A bare path like `src/app.ts`, which leads nowhere in a browser. */
	| { kind: 'none' }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CLOUD_DOCUMENT = new RegExp(`^/artifacts/(${UUID})/?$`, 'i')
const SHARED_DOCUMENT = new RegExp(`^/shared/artifacts/(${UUID})/?$`, 'i')

/**
 * `app` lists every origin this app answers on (the window's, and the public one links are made with).
 * `cloud` is undefined in a build without a cloud origin; no link is then a cloud document.
 */
export function linkTarget(href: string, origins: { app: readonly string[]; cloud: string | undefined }): LinkTarget {
	if (href.startsWith('#')) return { kind: 'anchor', href }
	if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('/')) return { kind: 'none' }
	let url: URL
	try {
		url = new URL(href, origins.app[0])
	} catch {
		return { kind: 'none' }
	}
	// `URL.origin` is "null" for custom schemes like tauri://, so compare scheme and host.
	const origin = `${url.protocol}//${url.host}`
	const inApp = origins.app.includes(origin)
	const artifactId = ((origin === origins.cloud && CLOUD_DOCUMENT.exec(url.pathname)) ||
		(inApp && SHARED_DOCUMENT.exec(url.pathname)) ||
		undefined)?.[1]
	if (artifactId) {
		const target: Extract<LinkTarget, { kind: 'document' }> = {
			kind: 'document',
			artifactId: artifactId.toLowerCase(),
			href: url.href,
		}
		const commentId = url.searchParams.get('commentId') ?? url.searchParams.get('comment')
		if (commentId) target.commentId = commentId
		return target
	}
	if (inApp) return { kind: 'app', path: url.pathname + url.search + url.hash }
	if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
		return { kind: 'external', href: url.href }
	return { kind: 'none' }
}
