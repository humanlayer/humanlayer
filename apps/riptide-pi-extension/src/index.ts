// Extension entry point. See plan.md §1: the factory only registers handlers; state that
// must survive a session lives on disk, everything else lives on this factory call's Instance.
// Every handler catches and logs, since a throw would block a tool call or crash pi, and none
// waits on the network except during shutdown: the Mirror queues work for its outbox instead.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { getPat } from './auth.ts'
import { Mirror, type MirrorOptions, type PiDriver } from './capture.ts'
import { createHumanlayerCommand, humanlayerArgumentCompletions, type Instance, setLive } from './command.ts'
import { flushMs, isDisabled, log } from './config.ts'
import { bundledSkillPaths } from './skills.ts'
import { registerHumanlayerTools, syncTools } from './tools.ts'
import { errorMessage } from './util.ts'

/** The extension factory. Tests pass a shorter outbox backoff. */
export function createHumanlayer(opts: MirrorOptions = {}): (pi: ExtensionAPI) => void {
	return (pi) => {
		// Scrub HUMANLAYER_PAT from process.env before anything else runs, including before pi's own
		// first tool call, so bash children and the model never see it (plan.md §2).
		getPat()

		const instance: Instance = { alive: true }
		let interrupt: (() => void) | undefined
		let interrupted = false
		let interruptExit: Promise<never> | undefined

		pi.registerFlag('humanlayer-task', {
			type: 'string',
			description: 'HumanLayer task id or slug to attach this pi session to',
		})

		pi.registerCommand('humanlayer', {
			description: 'HumanLayer cloud mirroring: login, logout, status, attach, off, on, default',
			getArgumentCompletions: humanlayerArgumentCompletions,
			handler: createHumanlayerCommand(instance),
		})

		// The comment and research tools riptide-daemon gives its agents. They stay off until this
		// session links to a task, and each call reads the task from the Mirror.
		registerHumanlayerTools(
			pi,
			() => instance.mirror?.toolTarget() ?? { reason: 'HumanLayer is off for this pi session.' },
		)
		const tools = () => {
			try {
				syncTools(pi, instance.mirror?.linked() ?? false)
			} catch (err) {
				log(`tools: ${errorMessage(err)}`)
			}
		}

		const flag = (): string | undefined => {
			const value = pi.getFlag('humanlayer-task')
			return typeof value === 'string' ? value : undefined
		}

		const run = async <T>(name: string, act: (m: Mirror) => T): Promise<Awaited<T> | undefined> => {
			const m = instance.mirror
			if (!m) return undefined
			try {
				return await act(m)
			} catch (err) {
				log(`${name}: ${errorMessage(err)}`)
				return undefined
			}
		}

		pi.on('session_start', async (_event, ctx) => {
			setLive(instance, ctx)
			if (isDisabled()) return
			try {
				// A print or json run ends after its prompt, so it takes no web messages.
				const oneShot = ctx.mode === 'print' || ctx.mode === 'json'
				const driver: PiDriver | undefined = oneShot
					? undefined
					: {
							// pi expands `/skill:name` as if typed; other text goes to the model as it is.
							send: (text) =>
								pi.sendUserMessage(text, {
									expandPromptTemplates: text.startsWith('/skill:'),
									deliverAs: ctx.isIdle() ? undefined : 'followUp',
								}),
							compact: () => ctx.compact(),
							abort: () => ctx.abort(),
							isIdle: () => ctx.isIdle(),
							skills: () => pi.getCommands().filter((c) => c.source === 'skill'),
						}
				const m = await Mirror.start(ctx, flag, opts, driver)
				if (instance.alive) instance.mirror = m
				else await m.shutdown()
				tools()
				if (instance.alive && oneShot) {
					interrupt = () => {
						if (interrupted) process.exit(130)
						interrupted = true
						// Even an uncooperative tool or a stuck local save cannot hold exit open.
						setTimeout(() => process.exit(130), flushMs() + 1000)
						ctx.abort()
						interruptExit = run('SIGINT', (mirror) => mirror.shutdown(true)).then(() => process.exit(130))
					}
					process.on('SIGINT', interrupt)
				}
			} catch (err) {
				log(`session_start: ${errorMessage(err)}`)
			}
		})

		pi.on('resources_discover', () => {
			try {
				return { skillPaths: bundledSkillPaths() }
			} catch (err) {
				log(`resources_discover: ${errorMessage(err)}`)
				return undefined
			}
		})

		pi.on('before_agent_start', async (event, ctx) => {
			const result = await run('before_agent_start', (m) => m.beforeAgentStart(event, ctx.model))
			// After the bind above, so the first prompt of a new session already has the tools.
			tools()
			return result
		})
		pi.on('agent_start', () => run('agent_start', (m) => m.agentStart()))
		pi.on('message_end', (event) => run('message_end', (m) => m.messageEnd(event)))
		pi.on('agent_end', (_event, ctx) => run('agent_end', (m) => m.agentEnd(ctx.signal?.aborted === true)))
		pi.on('agent_before_settle', (event) => run('agent_before_settle', (m) => m.beforeSettle(event.outcome)))
		pi.on('agent_settled', async () => {
			await run('agent_settled', (m) => m.agentSettled())
			// pi awaits this hook before returning from prompt() and starting the next CLI
			// prompt or deferred action. Keep it here until the SIGINT flush exits.
			await interruptExit
		})
		pi.on('session_before_compact', (event) =>
			run('session_before_compact', (m) => m.compacting(true, event.reason)),
		)
		pi.on('session_compact', () => run('session_compact', (m) => m.compacting(false)))
		pi.on('session_compact_failed', () => run('session_compact_failed', (m) => m.compacting(false)))
		pi.on('model_select', (event) => run('model_select', (m) => m.modelSelect(event.model)))
		pi.on('tool_call', (event) => run('tool_call', (m) => m.toolCall(event)))
		pi.on('tool_execution_end', (event) => run('tool_execution_end', (m) => m.nestedToolEnd(event)))

		// Entries with no event of their own wait for the next sweep; these make it come sooner.
		const sweep = () => run('sweep', (m) => m.sweep())
		pi.on('message_start', sweep)
		pi.on('turn_end', sweep)
		pi.on('input', sweep)
		pi.on('tool_execution_start', sweep)
		pi.on('session_tree', sweep)
		pi.on('thinking_level_select', sweep)
		pi.on('session_info_changed', sweep)

		pi.on('session_shutdown', async () => {
			await run('session_shutdown', (m) => m.shutdown())
			if (interrupt && !interrupted) process.off('SIGINT', interrupt)
			instance.alive = false
			instance.mirror = undefined
		})
	}
}

export default createHumanlayer()
