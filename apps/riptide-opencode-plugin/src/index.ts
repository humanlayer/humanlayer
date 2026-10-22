// The opencode (v2) plugin's server half: mirrors each top-level opencode session to a HumanLayer
// session, names the task folder in the system prompt, syncs its files and the task diff, gives
// the agent the HumanLayer tools and skills, and takes web replies and stops. The TUI half
// (tui.tsx) reaches it through the RPC in rpc.ts. Every hook catches and logs: a throw would break
// the user's prompt.

import { hostname } from 'node:os'

import type { Identity, OrgChoice } from '@humanlayer/session-sdk-auth'
import { ALL_CHANNELS, type Channel, errorMessage, isChannel, resumeAll } from '@humanlayer/session-sdk-base'
import {
	claim,
	type Follower,
	followApprovals,
	followSessions,
	pickTask,
	pruneClaims,
} from '@humanlayer/session-sdk-sessions'
import { HUMANLAYER_TOOLS, runTool, TOOLS, toJsonSchema } from '@humanlayer/session-sdk-tools'
import { Plugin } from '@opencode/plugin'

import {
	bundledSkillsDir,
	claimsDir,
	client,
	guard,
	HEARTBEAT_MS,
	isDisabled,
	linksPath,
	log,
	login,
	taskFromEnv,
} from './config.ts'
import { promptText } from './mapper.ts'
import { Mirror, type MirrorHost, type Model } from './mirror.ts'
import {
	type AttachInput,
	type ChannelInput,
	type ChooseOrgInput,
	type Events,
	HumanLayerRpc,
	type NoticeEvent,
	type Reply,
	type SessionInput,
	type StatusInput,
	type StatusOutput,
} from './rpc.ts'
import { loadSkills, skillsReport, slashCommand } from './skills.ts'

/** Marks a prompt the plugin sent for a web message: the cloud wrote its user event already. */
const WEB_PROMPT = 'humanlayer'

/** The footer asks again at most this often per session. */
const CHANGED_MS = 250

export default Plugin.define({
	id: 'humanlayer',
	async setup(ctx) {
		// Read HUMANLAYER_PAT, and delete it from the environment, before anything else runs, so the
		// agent's shell commands never see it.
		client.getPat()
		const directory = ctx.location.directory
		const disabled = isDisabled()
		log(`loaded for ${directory}${disabled ? ' (disabled)' : ''}`)
		/** Mirrors by opencode session id. null: a session this plugin leaves alone, such as a subagent's. */
		const mirrors = new Map<string, Mirror | null>()
		/** /humanlayer off before the first prompt: the session does not bind until on. */
		const offBeforeBind = new Set<string>()
		/** /humanlayer attach: the task the next prompt binds to. */
		const attachTargets = new Map<string, string>()
		/** /humanlayer attach before any session is open: the task the next new session binds to. */
		let nextAttach: string | undefined
		/** Per channel: the heartbeat, the inbox, and whether skills went up. */
		const channels = new Map<Channel, { beat: NodeJS.Timeout; inbox: Follower; approvals: Follower }>()
		const limits = new Map<string, Promise<number | undefined>>()
		const stop = new AbortController()
		let warnedSignedOut = false

		const rpc = await ctx.rpc.register(HumanLayerRpc, {
			status: async (input) => status(input as StatusInput),
			login: async (input) => startLogin((input as ChannelInput).channel),
			chooseOrg: async (input) => {
				chooseOrg?.((input as ChooseOrgInput).id)
				return {}
			},
			logout: async (input) => logout((input as ChannelInput).channel),
			attach: async (input) => attach(input as AttachInput),
			off: async (input) => setOff((input as SessionInput).sessionID, true),
			on: async (input) => setOff((input as SessionInput).sessionID, false),
		})
		const emit = <E extends keyof Events>(name: E, data: Events[E]) =>
			void rpc.events.emit(name, { ...data }).catch((err) => log(`emit ${name}: ${errorMessage(err)}`))

		const pendingChanged = new Map<string, NodeJS.Timeout>()
		const changed = (sessionID: string) => {
			if (pendingChanged.has(sessionID)) return
			const timer = setTimeout(() => {
				pendingChanged.delete(sessionID)
				emit('changed', { sessionID })
			}, CHANGED_MS)
			timer.unref()
			pendingChanged.set(sessionID, timer)
		}
		const notify = (sessionID: string | undefined, message: string, variant: NoticeEvent['variant']) => {
			log(`notice: ${message}`)
			emit('notice', { sessionID, message, variant })
		}

		// ---- skills ----

		const bundled = await loadSkills(bundledSkillsDir())
		const bundledPaths = new Set(bundled.map((s) => s.path))
		if (bundled.length > 0)
			await ctx.skill.transform((editor) => {
				for (const s of bundled) if (!editor.get(s.id)) editor.add(s as Parameters<typeof editor.add>[0])
			})

		const reportSkills = async (channel: Channel, hostId: string) => {
			const [skills, commands] = await Promise.all([ctx.skill.list(), ctx.command.list()])
			const body = skillsReport({
				hostId,
				workspace: directory,
				skills: skills.data,
				commands: commands.data,
				bundled: bundledPaths,
			})
			await client.daemonCall(channel, 'agentCommands/report', body, stop.signal)
			log(`reported ${body.skills.length} skills and ${body.commands.length} commands`)
		}

		/** A web message, as opencode would take it typed: `/compact`, a skill, a command, or text. */
		const deliver = async (sessionID: string, text: string) => {
			const slash = slashCommand(text)
			if (slash?.name === 'compact') {
				// Only the TUI's client can compact.
				emit('compact', { sessionID })
				return
			}
			if (slash) {
				const skill = (await ctx.skill.list()).data.find((s) => s.id === slash.name || s.name === slash.name)
				if (skill) {
					const body = slash.args || `Use the ${skill.name} skill.`
					await ctx.session.prompt({
						sessionID,
						text: body,
						skills: [{ id: skill.id }],
						delivery: 'queue',
						metadata: { [WEB_PROMPT]: 'web' },
					})
					return
				}
				const command = (await ctx.command.list()).data.find((c) => c.name === slash.name)
				if (command) {
					webEchoes.add(sessionID)
					await ctx.session.command({ sessionID, name: command.name, text: slash.args, delivery: 'queue' })
					return
				}
			}
			await ctx.session.prompt({ sessionID, text, delivery: 'queue', metadata: { [WEB_PROMPT]: 'web' } })
		}
		/** Sessions whose next prompt is a web command's: opencode's prompt carries no metadata for those. */
		const webEchoes = new Set<string>()

		// ---- the channel: heartbeat, inbox, skills ----

		const loadLimit = async (model: Model): Promise<number | undefined> => {
			const { data } = await ctx.model.list()
			const info = data.find(
				(m) => m.providerID === model.providerID && (m.modelID === model.id || m.id === model.id),
			)
			return info?.limit.context || undefined
		}

		const host: MirrorHost = {
			notify,
			changed,
			contextLimit: (model) => {
				const key = `${model.providerID}/${model.id}`
				let limit = limits.get(key)
				if (!limit) {
					limit = loadLimit(model).catch(() => undefined)
					limits.set(key, limit)
				}
				return limit
			},
			bound: (b) => startChannel(b.channel, b.hostId),
			deliver,
			interrupt: async (sessionID) => {
				await ctx.session.interrupt({ sessionID })
			},
			reply: async (sessionID, requestID, approved, message) => {
				const decision = approved ? 'once' : 'reject'
				// A denial's comment tells the agent why; opencode takes no empty message.
				if (message) await ctx.permission.reply({ sessionID, requestID, decision, message })
				else await ctx.permission.reply({ sessionID, requestID, decision })
			},
		}

		/**
		 * The heartbeat, the inbox and the skills report for a channel, from load while signed in.
		 * The web app shows a host offline, and turns its composer off, unless it beats as
		 * riptide-daemon does. Never hosts/shutdown: that fails every active session on the host.
		 */
		function startChannel(channel: Channel, hostId: string): void {
			if (disabled || stop.signal.aborted) return
			const running = channels.get(channel)
			if (running) {
				if (running.inbox.isStopped) running.inbox = followInbox(channel, hostId)
				if (running.approvals.isStopped) running.approvals = followAnswers(channel)
				return
			}
			const beat = {
				hostId,
				hostName: hostname(),
				// This host only runs sessions a user started on it, so the web app offers no launches there.
				capabilities: ['attachedSessionsOnly', 'agent:opencode'],
				canSelfUpdate: false,
			}
			const once = () => guard('heartbeat', () => client.daemonCall(channel, 'hosts/heartbeat', beat))
			void once()
			const timer = setInterval(once, HEARTBEAT_MS)
			timer.unref()
			channels.set(channel, {
				beat: timer,
				inbox: followInbox(channel, hostId),
				approvals: followAnswers(channel),
			})
			void guard('skills report', () => reportSkills(channel, hostId))
		}

		/** Web messages and stops to this host's sessions. */
		function followInbox(channel: Channel, hostId: string): Follower {
			return followSessions({
				client,
				channel,
				hostId,
				target: (cloudSessionId) => webTarget(channel, cloudSessionId),
				claim: (key) => claim(claimsDir(), key),
				log,
				signal: stop.signal,
			})
		}

		/** The web app's answers to this process's approvals. */
		function followAnswers(channel: Channel): Follower {
			return followApprovals({
				client,
				channel,
				log,
				signal: stop.signal,
				answered: (id, approved, comment) => {
					for (const m of mirrors.values()) if (m?.answered(id, approved, comment)) return
				},
			})
		}

		/** Starts the channel when signed in: at load, and after a login. */
		const startSignedIn = () =>
			guard('start', async () => {
				const channel = await client.resolveChannel()
				const who = await client.identity(channel)
				if (!who) return
				startChannel(channel, await client.hostId(channel))
				// Runs a crashed opencode left going end now, not when someone opens their session.
				for (const sessionID of await Mirror.lostRuns(channel, directory)) await resumed(sessionID, who)
			})

		/**
		 * Where a web message for a cloud session goes: its mirror, resumed from the saved binding
		 * when this process has not seen the session since it loaded (a restart, or a plugin reload).
		 */
		async function webTarget(channel: Channel, cloudSessionId: string): Promise<Mirror | undefined> {
			for (const m of mirrors.values()) if (m?.cloudSessionId === cloudSessionId) return m
			const sessionID = await Mirror.find(channel, cloudSessionId, directory)
			if (!sessionID || mirrors.get(sessionID) === null) return undefined
			const who = await client.identity(channel)
			if (!who) return undefined
			return resumed(sessionID, who)
		}

		// ---- prompts and events ----

		const session = (sessionID: string) => ctx.session.get({ sessionID })

		/** Sessions the footer asked about that have no saved binding. A bind adds a mirror instead. */
		const unlinked = new Set<string>()

		/** The session's mirror from its saved binding. One resume per session, however many callers ask at once. */
		const resuming = new Map<string, Promise<Mirror | undefined>>()
		const resumed = (sessionID: string, who: Identity): Promise<Mirror | undefined> => {
			const known = mirrors.get(sessionID)
			if (known) return Promise.resolve(known)
			let p = resuming.get(sessionID)
			if (!p) {
				p = (async () => {
					const info = await session(sessionID)
					const model = info.model && { providerID: info.model.providerID, id: info.model.id }
					const m = await Mirror.resume(host, sessionID, who, model)
					if (m) {
						mirrors.set(sessionID, m)
						changed(sessionID)
					}
					return m
				})().finally(() => resuming.delete(sessionID))
				resuming.set(sessionID, p)
			}
			return p
		}

		const onPrompt = async (sessionID: string, messageID: string, content: string, fromWeb: boolean) => {
			const known = mirrors.get(sessionID)
			if (known) return fromWeb ? undefined : known.prompt(messageID, content)
			if (known === null || offBeforeBind.has(sessionID)) return
			const info = await session(sessionID)
			if (info.parentID) return void mirrors.set(sessionID, null)
			const who = await client.identity(await client.resolveChannel())
			if (!who) {
				if (!warnedSignedOut)
					notify(sessionID, `Not signed in to HumanLayer. Run /humanlayer login.`, 'warning')
				warnedSignedOut = true
				return
			}
			const model = info.model && { providerID: info.model.providerID, id: info.model.id }
			let attach = attachTargets.get(sessionID)
			const m = attach ? undefined : await resumed(sessionID, who)
			if (m) return fromWeb ? undefined : m.prompt(messageID, content)
			attachTargets.delete(sessionID)
			if (!attach && nextAttach) {
				attach = nextAttach
				nextAttach = undefined
			}
			const pick = await pickTask({
				prefix: 'opencode',
				sessionId: sessionID,
				cwd: directory,
				linksPath: linksPath(),
				attach,
				chosen: taskFromEnv(),
				freshId: () => crypto.randomUUID(),
			})
			mirrors.set(
				sessionID,
				await Mirror.bind(host, { sessionId: sessionID, cwd: directory, who, prompt: content, model, pick }),
			)
		}

		if (!disabled) {
			await ctx.session.hook('prompt', (p) => {
				const fromWeb = p.metadata?.[WEB_PROMPT] === 'web' || webEchoes.delete(p.sessionID)
				return guard('prompt', () => onPrompt(p.sessionID, p.messageID, promptText(p.prompt), fromWeb))
			})

			// Every model request of a mirrored session names the task folder, as riptide-daemon's agents see it.
			await ctx.session.hook('context', (c) => {
				const hint = mirrors.get(c.sessionID)?.hint()
				if (hint) c.system.push({ type: 'text', text: hint })
			})
		}

		// A reply reopens its thread, so a reply and a resolve in one turn must land in the order the
		// model made them. opencode may run them at once; this chain runs one per session at a time.
		const chains = new Map<string, Promise<unknown>>()
		const inOrder = <T>(sessionID: string, fn: () => Promise<T>): Promise<T> => {
			const run = (chains.get(sessionID) ?? Promise.resolve()).then(fn, fn)
			chains.set(
				sessionID,
				run.catch(() => undefined),
			)
			return run
		}

		if (!disabled)
			await ctx.tool.transform((editor) => {
				for (const name of HUMANLAYER_TOOLS) {
					const { description, params } = TOOLS[name]
					editor.add({
						name,
						description,
						input: toJsonSchema(params),
						// Called directly, not from code mode, so the conversation shows each call by its name.
						options: { codemode: false },
						execute: async (input, context) => {
							const target = () =>
								mirrors.get(context.sessionID)?.toolTarget() ?? {
									reason: 'This opencode session is not linked to a HumanLayer task.',
								}
							const text = await inOrder(context.sessionID, () =>
								runTool(name, input, target, client.daemonCall, context.signal),
							)
							return { content: text }
						},
					})
				}
			})

		/** Each session's parent, from opencode, asked once per session. */
		const parents = new Map<string, Promise<string | undefined>>()
		/** The mirror of the nearest session above a subagent's, if one mirrors. */
		const mirrorAbove = async (sessionID: string): Promise<Mirror | undefined> => {
			let id = sessionID
			for (let depth = 0; depth < 8; depth++) {
				let parent = parents.get(id)
				if (!parent) {
					parent = session(id).then(
						(info) => info.parentID,
						() => undefined,
					)
					parents.set(id, parent)
				}
				const up = await parent
				if (!up) return undefined
				const m = mirrors.get(up)
				if (m) return m
				id = up
			}
			return undefined
		}

		if (!disabled)
			void (async () => {
				for await (const event of ctx.event.subscribe({ signal: stop.signal })) {
					const sessionID =
						'data' in event && event.data && 'sessionID' in event.data ? event.data.sessionID : undefined
					if (typeof sessionID !== 'string') continue
					const m = mirrors.get(sessionID)
					if (m) await guard(event.type, () => m.event(event))
					else {
						const root = await guard('parent', () => mirrorAbove(sessionID))
						if (root) await guard(event.type, () => root.childEvent(sessionID, event))
					}
				}
			})().catch((err) => {
				if (!stop.signal.aborted) log(`events: ${errorMessage(err)}`)
			})

		// ---- the RPC: status, login, attach, off and on ----

		/** The channel a login or logout names, else the current one; undefined for a name that is none. */
		const channelOf = async (channel: string | undefined): Promise<Channel | undefined> => {
			if (channel === undefined) return client.resolveChannel()
			return isChannel(channel) ? channel : undefined
		}
		const unknownChannel: Reply = {
			message: `Unknown channel. Use ${ALL_CHANNELS.join(', ')}.`,
			variant: 'warning',
		}

		async function status(input: StatusInput): Promise<StatusOutput> {
			const channel = await client.resolveChannel()
			const out: StatusOutput = { channel }
			if (disabled) out.disabled = true
			const who = await client.identity(channel).catch(() => null)
			if (who) out.signedIn = { email: who.email, org: who.orgName, source: who.source }
			const pending = login.pendingLogin(channel)
			if (pending) {
				out.pending = {}
				if (pending.url) out.pending.url = pending.url
				if (pending.code) out.pending.code = pending.code
			}
			if ([...mirrors.values()].some((m) => m?.loginRequired)) out.loginRequired = true
			const id = input.sessionID
			if (!id) {
				if (nextAttach) out.session = { state: 'unbound', queued: 0, attach: nextAttach }
				return out
			}
			// A session opened in the TUI shows its link at once, not after its next prompt.
			if (who && !mirrors.has(id) && !unlinked.has(id) && !attachTargets.has(id)) {
				if (!(await resumed(id, who))) unlinked.add(id)
			}
			const m = mirrors.get(id)
			if (m) out.session = m.info()
			else if (m === null) out.session = { state: 'off', queued: 0, problem: 'a subagent session' }
			else out.session = { state: offBeforeBind.has(id) ? 'off' : 'unbound', queued: 0 }
			const attach = attachTargets.get(id)
			if (attach) out.session.attach = attach
			return out
		}

		/** The login's org picker waits here for the TUI's choice. */
		let chooseOrg: ((id: string | undefined) => void) | undefined

		async function startLogin(channel: string | undefined): Promise<Reply> {
			const ch = await channelOf(channel)
			if (!ch) return unknownChannel
			const waiting = login.pendingLogin(ch)
			if (waiting?.url && waiting.code) {
				emit('login', { kind: 'code', channel: ch, url: waiting.url, code: waiting.code })
				return { message: `A login is waiting: open ${waiting.url} and check the code is ${waiting.code}.` }
			}
			void login
				.startDeviceLogin(ch, {
					hasUI: true,
					showCode: (url, code) => emit('login', { kind: 'code', channel: ch, url, code }),
					pickOrg: (orgs, current) =>
						new Promise<OrgChoice | undefined>((resolve) => {
							chooseOrg = (id) => {
								chooseOrg = undefined
								resolve(id ? orgs.find((o) => o.organizationId === id) : undefined)
							}
							const options = orgs.map((o) => ({ id: o.organizationId, name: o.organizationName }))
							emit('login', {
								kind: 'orgs',
								channel: ch,
								orgs: options,
								current: current?.organizationId,
							})
						}),
				})
				.then((creds) => {
					if (!creds)
						return emit('login', { kind: 'done', channel: ch, ok: false, message: 'Login cancelled.' })
					warnedSignedOut = false
					resumeAll()
					void startSignedIn()
					emit('login', {
						kind: 'done',
						channel: ch,
						ok: true,
						message: `Signed in to HumanLayer (${ch}) as ${creds.email}, org ${creds.orgName}.`,
					})
				})
				.catch((err) =>
					emit('login', {
						kind: 'done',
						channel: ch,
						ok: false,
						message: `Login failed: ${errorMessage(err)}`,
					}),
				)
				.finally(() => {
					for (const id of mirrors.keys()) changed(id)
				})
			return { message: `Signing in to HumanLayer (${ch})…` }
		}

		async function logout(channel: string | undefined): Promise<Reply> {
			const ch = await channelOf(channel)
			if (!ch) return unknownChannel
			await login.logout(ch)
			for (const id of mirrors.keys()) changed(id)
			return { message: `Signed out of HumanLayer (${ch}).` }
		}

		async function attach({ sessionID, target }: AttachInput): Promise<Reply> {
			if (disabled)
				return { message: 'HumanLayer is turned off (HUMANLAYER_OPENCODE_DISABLE).', variant: 'warning' }
			const what = target === 'new' ? 'a new task' : `task ${target}`
			if (!sessionID) {
				nextAttach = target
				emit('changed', {})
				return { message: `Your next new session starts in ${what}.` }
			}
			const m = mirrors.get(sessionID)
			if (m === null) return { message: 'Subagent sessions show in their parent session.', variant: 'warning' }
			if (m) await m.detach()
			mirrors.delete(sessionID)
			offBeforeBind.delete(sessionID)
			attachTargets.set(sessionID, target)
			changed(sessionID)
			return { message: `The next prompt starts a HumanLayer session in ${what}.` }
		}

		async function setOff(sessionID: string, off: boolean): Promise<Reply> {
			if (disabled)
				return { message: 'HumanLayer is turned off (HUMANLAYER_OPENCODE_DISABLE).', variant: 'warning' }
			const m = mirrors.get(sessionID)
			if (m === null) return { message: 'Subagent sessions show in their parent session.', variant: 'warning' }
			if (m) m.setOff(off)
			else if (off) offBeforeBind.add(sessionID)
			else offBeforeBind.delete(sessionID)
			changed(sessionID)
			return { message: off ? 'Mirroring is off for this session.' : 'Mirroring is on for this session.' }
		}

		if (!disabled) {
			void pruneClaims(claimsDir())
			void startSignedIn()
		}

		return async () => {
			stop.abort()
			for (const { beat, inbox, approvals } of channels.values()) {
				clearInterval(beat)
				inbox.close()
				approvals.close()
			}
			channels.clear()
			for (const timer of pendingChanged.values()) clearTimeout(timer)
			await Promise.all([...mirrors.values()].flatMap((m) => (m ? [m.shutdown()] : [])))
			await rpc.dispose()
		}
	},
})
