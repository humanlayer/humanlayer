import { env } from '@/env'

/**
 * Links from this app (riptide-cloud) to the riptide-ui web app.
 *
 * A task's real page — sessions, the composer, the whole working view — lives
 * in riptide-ui, not here. What riptide-cloud hosts at `/tasks/$taskId` is a
 * LAYOUT route whose only child is `/artifacts`, so linking there lands a
 * reader on an artifact table rather than on the task.
 *
 * Deliberately NOT the `/deep/tasks/$taskId` route: that one fires the desktop
 * protocol, shows an "Opening in HumanLayer…" card for two seconds, and then
 * falls back to the artifacts page anyway. That is the right behaviour for a
 * link pasted into Slack and the wrong one for a click inside a web app.
 */

/**
 * The riptide-ui origin, or null when it was not built in (local dev, mock
 * builds) or is not a usable absolute origin.
 *
 * The absolute check is not defensive padding. A scheme-less value —
 * `localhost:3000`, which is easy to hand-set because riptide-ui reads a
 * variable of the same name — produces `href="localhost:3000/tasks/<id>"`,
 * which a browser resolves RELATIVE to the current page and navigates to
 * `/admin/localhost:3000/tasks/<id>` inside this app. That is a silently wrong
 * link, exactly what `taskAppUrl` promises not to emit.
 */
export function appOrigin(): string | null {
	const raw = env.VITE_PUBLIC_APP_ORIGIN?.trim()
	if (!raw) return null
	try {
		const parsed = new URL(raw)
		// http(s) only: a `javascript:` or `data:` value parses fine and must
		// never reach an href.
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
		return raw.replace(/\/+$/, '')
	} catch {
		return null
	}
}

/**
 * Absolute URL of a task in riptide-ui, or null when there is no app origin to
 * build it from.
 *
 * Null rather than a guess: an app that silently linked to a wrong host would
 * be worse than one that keeps the reader here. Callers fall back to the
 * in-app artifacts route, which always exists.
 */
export function taskAppUrl(taskId: string): string | null {
	const origin = appOrigin()
	return origin ? `${origin}/tasks/${encodeURIComponent(taskId)}` : null
}
