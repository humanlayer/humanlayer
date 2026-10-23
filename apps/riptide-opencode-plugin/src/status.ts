// What the TUI shows: the footer and `/humanlayer status`, from the server half's status.

import type { StatusOutput } from './rpc.ts'

function shorten(text: string, max: number): string {
	const chars = Array.from(text.split('\n')[0] ?? '')
	return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

/** The footer text, as the pi extension's. */
export function footer(s: StatusOutput | undefined): string {
	if (!s) return ''
	if (s.disabled) return 'HumanLayer: disabled'
	if (s.pending) return 'HumanLayer: signing in…'
	if (!s.signedIn) return 'HumanLayer: /humanlayer login'
	if (s.loginRequired) return 'HumanLayer: ⚠ login required'
	const m = s.session
	if (!m) return 'HumanLayer: ready'
	if (m.problem && m.state === 'stopped') return `HumanLayer: ⚠ ${shorten(m.problem, 40)}`
	if (m.state === 'off') return 'HumanLayer: off'
	if (m.attach) return `HumanLayer: next prompt → ${m.attach === 'new' ? 'new task' : m.attach}`
	if (!m.task) return 'HumanLayer: ready'
	const line = m.queued > 0 ? `HumanLayer: ${m.task} ↑${m.queued}` : `HumanLayer: ${m.task}`
	return m.synced ? `${line} · ${shorten(m.synced, 30)}` : line
}

/** `/humanlayer status`: every fact on one screen. */
export function statusText(s: StatusOutput): string {
	const lines = [`Channel: ${s.channel}`]
	if (s.disabled) lines.push('Turned off by HUMANLAYER_OPENCODE_DISABLE')
	if (s.signedIn?.source === 'pat') lines.push('Signed in with HUMANLAYER_PAT')
	else if (s.signedIn) lines.push(`Signed in as ${s.signedIn.email}`, `Organization: ${s.signedIn.org}`)
	else lines.push('Not signed in. Run /humanlayer login.')
	if (s.pending?.url) lines.push(`Login waiting: open ${s.pending.url}, code ${s.pending.code ?? '…'}`)
	if (s.loginRequired) lines.push('HumanLayer turned down the login; updates wait for /humanlayer login.')
	const m = s.session
	if (m) {
		const state = {
			unbound: 'the next prompt links it',
			binding: 'linking',
			mirroring: 'on',
			off: 'off',
			stopped: 'stopped',
		}
		lines.push(`Mirroring: ${state[m.state]}`)
		if (m.attach) lines.push(`Next prompt joins: ${m.attach === 'new' ? 'a new task' : m.attach}`)
		if (m.task) lines.push(`Task: ${m.task}`)
		if (m.url) lines.push(`Session: ${m.url}`)
		if (m.queued) lines.push(`Waiting to send: ${m.queued}`)
		if (m.synced) lines.push(`Last task file: ${m.synced}`)
		if (m.problem) lines.push(`Problem: ${m.problem}`)
	}
	return lines.join('\n')
}
