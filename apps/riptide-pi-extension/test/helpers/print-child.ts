// One print-mode pi run in a process of its own, for tests of what happens as Node exits: a
// prompt, then session_shutdown and dispose, then nothing, so the process ends when its event loop
// drains, as real print mode does. The parent owns the mock cloud and passes the env (its URL, a
// temp riptide home). argv: cwd, prompt, reply. The session lives in <cwd>/sessions, so a second
// run in the same cwd continues it, as pi -c does. Optional mode/scenario args use pi's real
// print runner with an active model or tool; IPC tells the parent when it can send a signal.

import { join } from 'node:path'

import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { runPrintMode, SessionManager } from '@earendil-works/pi-coding-agent'

import { createHumanlayer } from '../../src/index.ts'
import { createTestSession } from './harness.ts'
import { createTestRuntime } from './runtime.ts'

async function main(cwd = '', prompt = '', reply = '', mode = '', scenario = 'model'): Promise<void> {
	// Backoffs long enough that retries are still waiting when the session shuts down.
	const humanlayer = createHumanlayer({ initialBackoffMs: 100, maxBackoffMs: 200 })
	if (mode === 'text' || mode === 'json') {
		const { runtime, faux } = await createTestRuntime((pi) => {
			humanlayer(pi)
			pi.registerCommand('later-command', {
				handler: async () => {
					process.send?.('later-command')
				},
			})
		}, cwd)
		const hold = setInterval(() => {}, 1000)
		faux.setResponses(
			scenario === 'tool'
				? [
						fauxAssistantMessage(
							fauxToolCall('bash', {
								command: `echo ready > '${join(cwd, 'tool.ready')}'; exec sleep 30`,
							}),
							{ stopReason: 'toolUse' },
						),
						(_context, options) =>
							new Promise((resolve) => {
								options?.signal?.addEventListener(
									'abort',
									() => resolve(fauxAssistantMessage('', { stopReason: 'aborted' })),
									{ once: true },
								)
							}),
					]
				: [
						(_context, options) =>
							new Promise((resolve) => {
								process.send?.('model')
								options?.signal?.addEventListener(
									'abort',
									() => {
										process.send?.('aborted')
										if (scenario !== 'stuck')
											resolve(fauxAssistantMessage('', { stopReason: 'aborted' }))
									},
									{ once: true },
								)
							}),
					],
		)
		if (scenario === 'multiple') {
			faux.appendResponses([
				() => {
					process.send?.('later-model')
					return fauxAssistantMessage(
						fauxToolCall('write', { path: 'later-tool.txt', content: 'must not run' }),
						{ stopReason: 'toolUse' },
					)
				},
				fauxAssistantMessage('later reply'),
			])
		}
		process.exitCode = await runPrintMode(runtime, {
			mode,
			initialMessage: prompt,
			messages: scenario === 'multiple' ? ['second prompt', '/later-command', 'third prompt'] : [],
		})
		clearInterval(hold)
		process.disconnect?.()
		return
	}
	const listeners = process.listenerCount('SIGINT')
	const sessionManager = SessionManager.continueRecent(cwd, join(cwd, 'sessions'))
	const s = await createTestSession(humanlayer, { cwd, sessionManager })
	s.faux.setResponses([fauxAssistantMessage(reply)])
	await s.session.prompt(prompt)
	await s.shutdown()
	if (process.listenerCount('SIGINT') !== listeners) throw new Error('SIGINT listener leaked after shutdown')
}

// Not awaited, as pi's cli.js calls its main: an early drain exits 0, with nothing said.
void main(...process.argv.slice(2))
