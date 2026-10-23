// The /humanlayer command: login, logout, status, open-session, attach, off, on, default. See plan.md §8.

import type { ExtensionCommandContext, ExtensionContext, ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { openBrowser } from '@humanlayer/session-sdk-auth'

import { type Creds, identity } from './auth.ts'
import type { Mirror } from './capture.ts'
import { ALL_CHANNELS, type Channel, isChannel, isDisabled, log, resolveChannel } from './config.ts'
import { type LoginUI, logout, pendingLogin, startDeviceLogin } from './login.ts'
import { resumeAll } from './outbox.ts'
import { isMirroring, loadSettings, saveSettings, settingsStatusLine } from './settings.ts'
import { errorMessage } from './util.ts'

const SUBCOMMANDS = ['login', 'logout', 'status', 'open-session', 'attach', 'off', 'on', 'default'] as const
const LOGIN_WIDGET = 'humanlayer-login'

/** Per-factory-call state. Set alive=false in session_shutdown so late UI writes are dropped. */
export interface Instance {
	alive: boolean
	/** From session_start, and only with a UI: ctx getters throw once pi replaces the session. */
	ui?: ExtensionUIContext
	/** Unset when HUMANLAYER_PI_DISABLE=1, and before session_start. */
	mirror?: Mirror
}

// A login outlives the session that started it (/new, /resume), so it shows its code, picker
// and result in the latest session instead, or on stderr when that has no UI.
let live: Instance | undefined
const liveUI = (): ExtensionUIContext | undefined => (live?.alive ? live.ui : undefined)

/** Call first in session_start. pi clears widgets when it switches sessions, so a waiting login shows its code again. */
export function setLive(instance: Instance, ctx: ExtensionContext): void {
	instance.ui = ctx.hasUI ? ctx.ui : undefined
	live = instance
	for (const channel of ALL_CHANNELS) {
		const waiting = pendingLogin(channel)
		if (instance.ui && waiting?.url && waiting.code) showLogin(instance.ui, channel, waiting.url, waiting.code)
	}
}

function showLogin(ui: ExtensionUIContext, channel: Channel, url: string, code: string): void {
	ui.setWidget(LOGIN_WIDGET, [
		`HumanLayer login (${channel})`,
		`Open: ${url}`,
		`Code: ${code}`,
		'Run /humanlayer logout to cancel',
	])
}

function say(message: string, kind: 'info' | 'error' = 'info'): void {
	const ui = liveUI()
	if (ui) ui.notify(message, kind)
	else console.error(message)
}

function output(ctx: ExtensionCommandContext, message: string, kind: 'info' | 'warning' | 'error' = 'info'): void {
	if (ctx.hasUI) ctx.ui.notify(message, kind)
	else console.error(message)
}

function loginUI(channel: Channel): LoginUI {
	return {
		get hasUI() {
			return liveUI() !== undefined
		},
		showCode(url, code) {
			const ui = liveUI()
			if (ui) showLogin(ui, channel, url, code)
			say(
				ui
					? `HumanLayer: open ${url} and enter code ${code}`
					: `HumanLayer login (${channel}): open ${url} and enter code ${code}`,
			)
		},
		async pickOrg(orgs, current) {
			// Names; an id only where two orgs share a name.
			const labels = orgs.map((o) => {
				const twin = orgs.some((x) => x !== o && x.organizationName === o.organizationName)
				const label = twin ? `${o.organizationName} (${o.organizationId})` : o.organizationName
				return o === current ? `${label} (current)` : label
			})
			const picked = await liveUI()?.select('Choose a HumanLayer organization', labels)
			return picked === undefined ? undefined : orgs[labels.indexOf(picked)]
		},
	}
}

async function handleLogin(channelArg: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
	let channel: Channel
	if (channelArg === undefined) {
		channel = await resolveChannel()
	} else if (isChannel(channelArg)) {
		channel = channelArg
	} else {
		output(ctx, `HumanLayer: unknown channel "${channelArg}". Use prod, beta, dev or local.`, 'error')
		return
	}
	const waiting = pendingLogin(channel)
	if (waiting) {
		const code = waiting.code ? `: open ${waiting.url} and enter code ${waiting.code}` : ''
		return output(
			ctx,
			`HumanLayer: a login to ${channel} is already waiting${code}. Run /humanlayer logout to cancel it.`,
		)
	}

	const run = async (): Promise<void> => {
		let creds: Creds | undefined
		try {
			creds = await startDeviceLogin(channel, loginUI(channel))
		} catch (err) {
			return say(`HumanLayer: login failed: ${errorMessage(err)}`, 'error')
		} finally {
			liveUI()?.setWidget(LOGIN_WIDGET, undefined)
		}
		if (!creds) return say('HumanLayer: login cancelled')
		resumeAll() // outboxes paused for login, in this session or any other
		say(`HumanLayer: signed in to ${channel} as ${creds.email} (${creds.orgName})`)
		await live?.mirror?.authChanged().catch((err) => log(`login: ${errorMessage(err)}`))
	}

	// TUI: run in the background so the editor stays usable while the user visits the URL.
	// Print mode: await it, so `pi -p "/humanlayer login dev" < /dev/null` works as a terminal login.
	if (ctx.hasUI) run().catch(() => {})
	else await run()
}

async function handleLogout(instance: Instance, ctx: ExtensionCommandContext): Promise<void> {
	const channel = await resolveChannel()
	await logout(channel)
	await instance.mirror?.authChanged()
	output(ctx, `HumanLayer: signed out of ${channel}`)
}

async function handleStatus(instance: Instance, ctx: ExtensionCommandContext): Promise<void> {
	const channel = await resolveChannel()
	const id = await identity(channel)
	const lines = [`channel: ${channel}`, await settingsLine()]
	if (!id) {
		lines.push('user: not signed in')
		lines.push('auth: none. Run /humanlayer login.')
	} else if (id.source === 'pat') {
		lines.push('user: (PAT)')
		lines.push('auth: PAT (HUMANLAYER_PAT)')
	} else {
		lines.push(`user: ${id.email ?? '?'}`)
		lines.push(`org: ${id.orgName ?? '?'}`)
		lines.push('auth: device login')
	}
	const m = instance.mirror?.info()
	if (!m) lines.push(`mirroring: ${isDisabled() ? 'disabled (HUMANLAYER_PI_DISABLE=1)' : 'not running'}`)
	else {
		lines.push(`mirroring: ${m.state}`)
		lines.push(`task: ${m.task ?? 'none'}`)
		if (m.url) lines.push(`session: ${m.url}`)
		lines.push(`queue: ${m.queue}`)
		lines.push(`last error: ${m.lastError ?? 'none'}`)
	}
	output(ctx, `HumanLayer status\n${lines.map((line) => `  ${line}`).join('\n')}`)
}

/** The status line for the saved default, or why it can't be read. */
async function settingsLine(): Promise<string> {
	try {
		return settingsStatusLine(await loadSettings())
	} catch (err) {
		return `default mirroring: unreadable (${errorMessage(err)}); new sessions start off`
	}
}

/** /humanlayer default [on|off]: shows or saves the default for new sessions. This session keeps its state. */
async function handleDefault(parts: string[], ctx: ExtensionCommandContext): Promise<void> {
	const [, arg] = parts
	if (parts.length > 2 || (arg !== undefined && !isMirroring(arg)))
		return output(ctx, 'HumanLayer: usage: /humanlayer default [on|off]', 'warning')
	if (arg === undefined) return output(ctx, `HumanLayer: ${await settingsLine()}`)
	try {
		await saveSettings({ defaultMirroring: arg })
	} catch (err) {
		return output(ctx, `HumanLayer: could not save the default: ${errorMessage(err)}`, 'error')
	}
	output(ctx, `HumanLayer: default mirroring set to ${arg} for new sessions; this session is unchanged`)
}

/** attach, off and on act on this session's Mirror, which does not exist when mirroring is disabled. */
function withMirror(instance: Instance, ctx: ExtensionCommandContext, act: (m: Mirror) => string): void {
	const m = instance.mirror
	if (!m) {
		output(
			ctx,
			`HumanLayer: mirroring is ${isDisabled() ? 'disabled (HUMANLAYER_PI_DISABLE=1)' : 'not running'}`,
			'warning',
		)
		return
	}
	output(ctx, act(m))
}

/** Builds the /humanlayer command handler, closing over this factory call's Instance. */
export function createHumanlayerCommand(
	instance: Instance,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
	return async (args, ctx) => {
		const parts = args.trim().length > 0 ? args.trim().split(/\s+/) : []
		const [sub, arg] = parts
		switch (sub) {
			case undefined:
			case 'status':
				return handleStatus(instance, ctx)
			case 'login':
				return handleLogin(arg, ctx)
			case 'logout':
				return handleLogout(instance, ctx)
			case 'open-session':
				return withMirror(instance, ctx, (m) => {
					const url = m.info().url
					if (!url) return 'HumanLayer: this session is not linked yet. Send a prompt first.'
					if (process.env.HUMANLAYER_PI_NO_BROWSER !== '1') openBrowser(url)
					return `HumanLayer: opened ${url}`
				})
			case 'attach':
				if (!arg)
					return output(ctx, 'HumanLayer: usage: /humanlayer attach <task id or slug, or new>', 'warning')
				return withMirror(instance, ctx, (m) => {
					m.attach(arg)
					return arg === 'new'
						? 'HumanLayer: the next prompt starts a new task'
						: `HumanLayer: the next prompt attaches to task ${arg}`
				})
			case 'off':
			case 'on':
				if (parts.length > 1) return output(ctx, `HumanLayer: usage: /humanlayer ${sub}`, 'warning')
				return withMirror(instance, ctx, (m) => {
					if (sub === 'off') m.setOff()
					else m.setOn()
					return `HumanLayer: mirroring ${sub} for this session`
				})
			case 'default':
				return handleDefault(parts, ctx)
			default:
				output(
					ctx,
					`HumanLayer: unknown subcommand "${sub}". Try login, logout, status, open-session, attach, off, on or default.`,
					'warning',
				)
		}
	}
}

/** None once typed is a whole choice: pi's Enter would only accept the completion, not run the command. */
function complete(choices: readonly string[], typed: string, before = ''): { value: string; label: string }[] | null {
	const matches = choices.filter((c) => c.startsWith(typed))
	return matches.length > 0 && !choices.includes(typed) ? matches.map((c) => ({ value: before + c, label: c })) : null
}

export function humanlayerArgumentCompletions(argumentPrefix: string): { value: string; label: string }[] | null {
	const [sub = '', channel, ...more] = argumentPrefix.split(' ')
	if (channel === undefined) return complete(SUBCOMMANDS, sub)
	if (more.length > 0) return null
	if (sub === 'login') return complete(ALL_CHANNELS, channel, 'login ')
	return sub === 'default' ? complete(['on', 'off'], channel, 'default ') : null
}
