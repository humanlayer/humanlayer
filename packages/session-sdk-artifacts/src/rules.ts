// Which task files a host syncs, and how it labels them.

/** Files that sync as text through artifacts/upsert. Anything else uploads as bytes. */
const TEXT_EXTENSIONS = /\.(md|mdx|txt|json|jsonl)$/i

const MIME_TYPES = new Map([
	['png', 'image/png'],
	['jpg', 'image/jpeg'],
	['jpeg', 'image/jpeg'],
	['gif', 'image/gif'],
	['webp', 'image/webp'],
	['svg', 'image/svg+xml'],
	['pdf', 'application/pdf'],
	['html', 'text/html'],
	['htm', 'text/html'],
	['json', 'application/json'],
	['css', 'text/css'],
	['js', 'text/javascript'],
	['mjs', 'text/javascript'],
])

/** The server's cap on text content. */
export const MAX_ARTIFACT_TEXT_BYTES = 10 * 1024 * 1024

export function isTextFile(fileName: string): boolean {
	return TEXT_EXTENSIONS.test(fileName)
}

/** By the last extension, else application/octet-stream. */
export function getMimeType(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
	return MIME_TYPES.get(ext) ?? 'application/octet-stream'
}

/** A task folder's trash. Files the web app moved there stay local and never sync. */
export const ARTIFACT_TRASH_DIRECTORY = '.trash'

export function isReservedArtifactTrashSubpath(subpath: string): boolean {
	return subpath.replaceAll('\\', '/').split('/')[0] === ARTIFACT_TRASH_DIRECTORY
}

function decoded(name: string): string {
	try {
		return decodeURIComponent(name)
	} catch {
		return name // a bad encoding passes
	}
}

/** riptide-api's safeSubpathSchema (lib/filename-validation.ts): true for names the server refuses. */
export function isRefusedSubpath(name: string): boolean {
	const risky = (s: string) =>
		s.includes('\\') ||
		s.includes('..') ||
		s.includes('\0') ||
		s.startsWith('/') ||
		s.endsWith('/') ||
		s.split('/').some((part) => part === '' || part === '.')
	const d = decoded(name)
	return (
		name.length < 1 ||
		name.length > 1024 ||
		risky(name) ||
		risky(d) ||
		d.split('/').length !== name.split('/').length
	)
}

/** A task folder subpath worth sending: outside the trash, and one the server takes. */
export function isSyncableSubpath(subpath: string): boolean {
	return !isReservedArtifactTrashSubpath(subpath) && !isRefusedSubpath(subpath)
}
