export interface TaskArtifactReference {
	fileName: string
	taskSlug?: string
	taskId?: string
}

const TASK_SLUG_PATH = /(?:^|\/)\.humanlayer\/tasks\/([^/]+)\/(.+)$/
const TASK_STORAGE_PATH = /(?:^|\/)\.humanlayer\/riptide\/artifacts\/([^/]+)\/(.+)$/

const ARTIFACT_ROOT = String.raw`(?:[^\s@]*\/)?\.humanlayer\/(?:tasks|riptide\/artifacts)\/[^\s/]+\/`
const FILE_EXTENSION = String.raw`\.[A-Za-z][A-Za-z0-9]{0,7}`
const MENTION_END = String.raw`(?=$|[\s)\]},;:!?'"]|\.(?:\s|$))`

/**
 * `@`-prefixed artifact path as written by the composer. File names may contain spaces
 * (macOS screenshots), so the path runs lazily up to the first file extension that ends a word.
 */
export const TASK_ARTIFACT_MENTION_PATTERN = new RegExp(
	String.raw`@(${ARTIFACT_ROOT}[^\n@]*?${FILE_EXTENSION})${MENTION_END}`,
	'g',
)

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'])

export function isImageFileName(fileName: string): boolean {
	const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'))
	return IMAGE_EXTENSIONS.has(ext)
}

const BROWSER_LOADABLE_IMAGE_URL = /^(https?:|blob:|data:image\/|\/\/)/i

/** Anything else, such as `/tmp/shot.png`, is a file on the agent's host. */
export function isBrowserLoadableImageUrl(url: string): boolean {
	return BROWSER_LOADABLE_IMAGE_URL.test(url.trim())
}

export function getArtifactDisplayName(fileName: string): string {
	return fileName.slice(fileName.lastIndexOf('/') + 1)
}

export function parseTaskArtifactPath(path: string): TaskArtifactReference | null {
	const trimmed = path.trim().replace(/^@/, '')

	const slugMatch = TASK_SLUG_PATH.exec(trimmed)
	if (slugMatch?.[1] && slugMatch[2]) return { taskSlug: slugMatch[1], fileName: slugMatch[2] }

	const storageMatch = TASK_STORAGE_PATH.exec(trimmed)
	if (storageMatch?.[1] && storageMatch[2]) return { taskId: storageMatch[1], fileName: storageMatch[2] }

	return null
}

export type TaskArtifactScope = { column: 'task_slug'; value: string } | { column: 'task_id'; value: string }

/**
 * A path that names a task is looked up in that task only, never in the route task, so a
 * missing file in another task does not resolve to a same-named file in this one.
 */
export function getTaskArtifactScope(
	reference: TaskArtifactReference,
	routeTaskId: string | undefined,
): TaskArtifactScope | null {
	if (reference.taskSlug) return { column: 'task_slug', value: reference.taskSlug }
	const taskId = reference.taskId ?? routeTaskId
	return taskId ? { column: 'task_id', value: taskId } : null
}

/** Paths outside a task artifact directory are treated as file names in the current task. */
export function toTaskArtifactReference(path: string): TaskArtifactReference {
	return parseTaskArtifactPath(path) ?? { fileName: path.trim() }
}
