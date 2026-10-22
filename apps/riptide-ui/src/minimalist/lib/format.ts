/** Duration as the ui-copy rules want it: `45s`, `2m 14s`, `1h 3m`. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const seconds = total % 60
	if (hours > 0) return `${hours}h ${minutes}m`
	if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
	return `${seconds}s`
}

/** Compact age for list rows: `now`, `4m`, `3h`, `2d`, `5w`. */
export function formatAge(timestampMs: number, now = Date.now()): string {
	const seconds = Math.max(0, (now - timestampMs) / 1000)
	if (seconds < 60) return 'now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
	if (seconds < 86_400 * 7) return `${Math.floor(seconds / 86_400)}d`
	return `${Math.floor(seconds / (86_400 * 7))}w`
}

/** "5m ago", or "just now" inside the first minute, where formatAge alone would read "now ago". */
export function formatAgo(timestampMs: number, now = Date.now()): string {
	const age = formatAge(timestampMs, now)
	return age === 'now' ? 'just now' : `${age} ago`
}

export function formatClock(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function toMs(value: bigint | number | string | null | undefined): number {
	if (value === null || value === undefined) return 0
	return Number(value)
}

export function basename(path: string): string {
	const trimmed = path.replace(/\/+$/, '')
	return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

/** Shorten the middle of a path so the file name stays visible. */
export function shortPath(path: string, max = 56): string {
	const home = path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~')
	if (home.length <= max) return home
	const name = basename(home)
	return `${home.slice(0, Math.max(8, max - name.length - 2))}…/${name}`
}

/** Token counts as `850`, `45k`, `1.2M`; never `1000k`. */
export function formatTokens(count: number): string {
	if (count >= 999_500) {
		const millions = count / 1_000_000
		return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`
	}
	if (count >= 1000) return `${Math.round(count / 1000)}k`
	return String(count)
}

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`
}

/** A tool input field as display text; anything that isn't a string reads as empty. */
export function text(...values: unknown[]): string {
	for (const value of values) if (typeof value === 'string') return value
	return ''
}

/** The directory every path sits under, with its trailing slash; "" when they share none. */
export function commonDir(paths: string[]): string {
	const [first, ...rest] = paths.map((path) => path.slice(0, path.lastIndexOf('/') + 1))
	let root = first ?? ''
	for (const dir of rest)
		while (!dir.startsWith(root)) root = root.slice(0, root.lastIndexOf('/', root.length - 2) + 1)
	return root
}
