/** @jsxImportSource @opentui/solid */
// The TUI half of the plugin: the footer, the `/humanlayer` command, notices, and the login's code
// and org picker. It holds no HumanLayer state of its own: it asks the server half (index.ts)
// through the RPC in rpc.ts, and redraws when the server says a session changed.

import { Plugin } from '@opencode/plugin/tui'
import { createSignal } from 'solid-js'

import { copy, errorMessage, openBrowser } from './browser.ts'
import { type Events, HumanLayerRpc, type LoginEvent, type Reply, type StatusOutput } from './rpc.ts'
import { footer, statusText } from './status.ts'

/** An event's data, as the server half sent it. */
function eventData<E extends keyof Events>(data: Readonly<Record<string, unknown>>): Events[E] {
	return data as Events[E]
}

const ACTIONS = [
	{ value: 'status', title: 'Status', description: 'Sign-in, task and session link' },
	{ value: 'session', title: 'Copy session link', description: 'Show the HumanLayer link and copy it' },
	{ value: 'open-session', title: 'Open session', description: 'Open the HumanLayer session in the browser' },
	{ value: 'attach', title: 'Attach to a task', description: 'The next prompt joins a task, or a new one' },
	{ value: 'off', title: 'Turn mirroring off', description: 'Stop sending this session' },
	{ value: 'on', title: 'Turn mirroring on', description: 'Send this session again' },
	{ value: 'login', title: 'Sign in', description: 'Sign in to HumanLayer in the browser' },
	{ value: 'logout', title: 'Sign out', description: 'Sign out of this channel' },
] as const

const USAGE = `Use /humanlayer ${ACTIONS.map((a) => a.value).join(', ')}.`

export default Plugin.define({
	id: 'humanlayer',
	setup(ctx) {
		const hl = ctx.client.rpc(HumanLayerRpc)
		const [status, setStatus] = createSignal<StatusOutput>()

		const toast = (message: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info') =>
			ctx.ui.toast.show({ title: 'HumanLayer', message, variant })
		const reply = (r: unknown) => {
			const { message, variant } = r as Reply
			toast(message, variant)
		}

		const current = (): string | undefined => {
			const route = ctx.ui.router.current()
			return route.type === 'session' ? route.sessionID : undefined
		}
		const refresh = async () => {
			try {
				setStatus((await hl.status({ sessionID: current() })) as StatusOutput)
			} catch {
				// The server half may still be loading; the next change asks again.
			}
		}
		void refresh()
		const poll = setInterval(() => void refresh(), 2000)

		/** The events carry JSON objects; rpc.ts says what each holds, and the server half is its only sender. */
		const unload = new AbortController()
		const on = <E extends keyof Events>(name: E, fn: (data: Events[E]) => void) =>
			hl.events.on(name, (e) => fn(eventData<E>(e.data)), { signal: unload.signal })

		on('changed', ({ sessionID }) => {
			if (!sessionID || sessionID === current()) void refresh()
		})
		on('notice', (n) => {
			if (!n.sessionID || n.sessionID === current()) toast(n.message, n.variant)
		})
		on('compact', ({ sessionID }) => {
			ctx.client.session
				.compact({ sessionID, delivery: 'queue' })
				.catch((err) => toast(`Could not compact the session: ${errorMessage(err)}`, 'error'))
		})
		on('login', (e) => void onLogin(e))

		async function onLogin(e: LoginEvent) {
			if (e.kind === 'code') {
				await ctx.ui.dialog.alert({
					title: `Sign in to HumanLayer (${e.channel})`,
					message: `Approve the code ${e.code} in your browser.\n\n${e.url}`,
				})
			} else if (e.kind === 'orgs') {
				const id = await ctx.ui.dialog.select({
					title: 'Choose a HumanLayer organization',
					options: e.orgs.map((o) => ({ title: o.name, value: o.id })),
					current: e.current,
				})
				await hl.chooseOrg({ id })
			} else {
				ctx.ui.dialog.clear()
				toast(e.message, e.ok ? 'success' : 'warning')
			}
			void refresh()
		}

		const needSession = (): string | undefined => {
			const id = current()
			if (!id) toast('Open a session first.', 'warning')
			return id
		}

		async function sessionLink(open: boolean) {
			const id = needSession()
			if (!id) return
			const url = ((await hl.status({ sessionID: id })) as StatusOutput).session?.url
			if (!url) return toast('This session is not linked yet. Send a prompt first.', 'warning')
			if (open) {
				openBrowser(url)
				return toast('Opened the session in your browser.')
			}
			const copied = await copy(url)
			await ctx.ui.dialog.alert({
				title: copied ? 'HumanLayer session (link copied)' : 'HumanLayer session',
				message: url,
			})
		}

		async function run(input: string | undefined) {
			const [action = '', ...rest] = input?.trim().split(/\s+/).filter(Boolean) ?? []
			const arg = rest.join(' ')
			const chosen =
				action ||
				(await ctx.ui.dialog.select({
					title: 'HumanLayer',
					options: ACTIONS.map((a) => ({ title: a.title, value: a.value, description: a.description })),
				}))
			switch (chosen) {
				case undefined:
					return
				case 'status': {
					const s = (await hl.status({ sessionID: current() })) as StatusOutput
					return ctx.ui.dialog.alert({ title: 'HumanLayer', message: statusText(s) })
				}
				case 'session':
				case 'open-session':
					return sessionLink(chosen === 'open-session')
				case 'login':
				case 'logout': {
					// The server half checks the channel name.
					const channel = arg || undefined
					return reply(chosen === 'login' ? await hl.login({ channel }) : await hl.logout({ channel }))
				}
				case 'attach': {
					// With no session open, the next new session joins the task.
					const id = current()
					const target =
						arg ||
						(await ctx.ui.dialog.prompt({
							title: 'Attach to a HumanLayer task',
							description: id
								? 'A task id or slug, or new for a new task. The next prompt joins it.'
								: 'A task id or slug, or new for a new task. Your next new session joins it.',
							placeholder: 'new',
						}))
					if (!target?.trim()) return
					return reply(await hl.attach({ sessionID: id, target: target.trim() }))
				}
				case 'off':
				case 'on': {
					const id = needSession()
					if (id) reply(await (chosen === 'off' ? hl.off({ sessionID: id }) : hl.on({ sessionID: id })))
					return
				}
				default:
					return toast(USAGE, 'warning')
			}
		}

		ctx.ui.slot({
			append: 'prompt.footer.status',
			render: () => <text>{footer(status())}</text>,
		})

		// A keymap layer needs a rendered scope: the app slot gives one, and renders nothing.
		ctx.ui.slot({
			append: 'app',
			render: () => {
				ctx.keymap.layer(() => ({
					mode: 'global',
					commands: [
						{
							id: 'humanlayer',
							title: 'HumanLayer',
							description: 'Status, session link, attach, off and on, sign in and out',
							palette: true,
							slash: { name: 'humanlayer', arguments: true },
							run: (input) =>
								run(input).catch((err) => toast(`/humanlayer: ${errorMessage(err)}`, 'error')),
						},
					],
				}))
				return null
			},
		})

		return () => {
			clearInterval(poll)
			unload.abort()
		}
	},
})
