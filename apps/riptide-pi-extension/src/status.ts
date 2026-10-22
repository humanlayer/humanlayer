// What the user sees: the footer (plan.md §5.4) and notices. A session with no UI (print and
// json modes) has no footer, and its notices go to stderr.

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

export interface StatusFacts {
	signedIn: boolean
	problem?: string
	off: boolean
	task?: string
	queued: number
	/** The last task file synced. */
	synced?: string
}

/** The footer text. */
export function statusLine(s: StatusFacts): string {
	if (!s.signedIn) return 'HumanLayer: /humanlayer login'
	if (s.problem) return `HumanLayer: ⚠ ${shorten(s.problem, 40)}`
	if (s.off) return 'HumanLayer: off'
	if (!s.task) return 'HumanLayer: ready'
	const line = s.queued > 0 ? `HumanLayer: ${s.task} ↑${s.queued}` : `HumanLayer: ${s.task}`
	return s.synced ? `${line} · ${shorten(s.synced, 30)}` : line
}

function shorten(text: string, max: number): string {
	const chars = Array.from(text.split('\n')[0] ?? '')
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

type Kind = 'info' | 'error'

/** One session's footer and notices. Keeps only the UI of the ctx, which goes stale when the session ends. */
export class Display {
	private readonly ui: ExtensionContext['ui']
	private readonly hasUI: boolean
	private readonly seen = new Set<string>()
	private shown: string | undefined
	private closed = false

	constructor(ctx: Pick<ExtensionContext, 'ui' | 'hasUI'>) {
		this.ui = ctx.ui
		this.hasUI = ctx.hasUI
	}

	/** Sets the footer, when the text changed. */
	status(facts: StatusFacts): void {
		const text = statusLine(facts)
		if (this.closed || text === this.shown) return
		this.shown = text
		this.ui.setStatus('humanlayer', text)
	}

	/** A notice in the UI, else on stderr. */
	notify(message: string, kind: Kind = 'info'): void {
		if (this.closed) return
		if (this.hasUI) this.ui.notify(message, kind)
		else console.error(message)
	}

	/** A notice only a UI shows: news that would be noise on stderr. */
	toast(message: string): void {
		if (!this.closed && this.hasUI) this.ui.notify(message, 'info')
	}

	/** notify, once per key. `seen` defaults to this display's own keys. */
	notifyOnce(key: string, message: string, kind: Kind = 'info', seen = this.seen): void {
		if (this.closed || seen.has(key)) return
		seen.add(key)
		this.notify(message, kind)
	}

	/** The session ended: later calls do nothing. */
	close(): void {
		this.closed = true
	}
}
