import { it } from '@effect/vitest'
import { Command } from 'commander'
import { Console, Effect, Logger } from 'effect'
import { describe, expect, test } from 'vitest'

import {
	displayXaiBrowserInstructions,
	displayXaiDeviceInstructions,
	registerFoldAuthCommands,
} from '../src/commands/agents-auth'

describe('Fold authentication commands', () => {
	it.effect('writes exact xAI instructions to stdout even with diagnostic logging disabled', () =>
		Effect.gen(function* () {
			const output: Array<ReadonlyArray<unknown>> = []
			const unexpected = () => {
				throw new Error('Unexpected console operation')
			}
			const console: Console.Console = {
				log: (...args) => {
					output.push(args)
				},
				assert: unexpected,
				clear: unexpected,
				count: unexpected,
				countReset: unexpected,
				debug: unexpected,
				dir: unexpected,
				dirxml: unexpected,
				error: unexpected,
				group: unexpected,
				groupCollapsed: unexpected,
				groupEnd: unexpected,
				info: unexpected,
				table: unexpected,
				time: unexpected,
				timeEnd: unexpected,
				timeLog: unexpected,
				trace: unexpected,
				warn: unexpected,
			}
			yield* displayXaiBrowserInstructions('https://example.test/browser').pipe(
				Effect.andThen(
					displayXaiDeviceInstructions({
						verificationUri: 'https://example.test/device',
						userCode: 'TEST-CODE',
					}),
				),
				Effect.provideService(Console.Console, console),
				Effect.provide(Logger.layer([])),
			)
			expect(output).toEqual([
				['  If the browser does not open, visit: https://example.test/browser'],
				['  Open https://example.test/device and enter code: TEST-CODE'],
				['  Waiting for authentication...'],
			])
		}),
	)

	test('registers the xAI subscription OAuth login path', () => {
		const program = new Command()
		registerFoldAuthCommands(program)

		const fold = program.commands.find((command) => command.name() === 'fold')
		const auth = fold?.commands.find((command) => command.name() === 'auth')
		const xai = auth?.commands.find((command) => command.name() === 'xai')

		expect(xai?.commands.map((command) => command.name())).toEqual(['login', 'status', 'logout'])
	})
})
