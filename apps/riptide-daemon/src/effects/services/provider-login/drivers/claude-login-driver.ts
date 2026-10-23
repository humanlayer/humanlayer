import * as BunServices from '@effect/platform-bun/BunServices'
import { type Cause, Data, Effect, Queue, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import type {
	ProviderLoginDriver,
	ProviderLoginDriverContext,
	ProviderLoginDriverResult,
} from '../provider-login.types'
import { untilAborted } from './until-aborted'

// `claude auth login` prints "If the browser didn't open, visit: <url>"; other lines may carry unrelated URLs.
export const AUTHORIZE_URL_PATTERN = /visit:\s*(https?:\/\/\S+)/
// Fallback for a reworded prompt: any URL whose path is an OAuth authorize request.
const AUTHORIZE_URL_FALLBACK = /(https?:\/\/\S*authorize\S*)/

// claude wraps the URL in an OSC 8 terminal hyperlink (ESC ]8;;<uri> BEL <text> ESC ]8;; BEL)
// and colours output with CSI/SGR codes; strip both so the URL sits right after "visit:".
export const stripTerminalEscapes = (text: string): string =>
	text
		// eslint-disable-next-line no-control-regex
		.replace(/\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
		// eslint-disable-next-line no-control-regex
		.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0007\u001b]/g, '')

export const parseClaudeAuthorizeUrl = (output: string): string | undefined => {
	const completeLines = stripTerminalEscapes(output.slice(0, output.lastIndexOf('\n') + 1))
	return completeLines.match(AUTHORIZE_URL_PATTERN)?.[1] ?? completeLines.match(AUTHORIZE_URL_FALLBACK)?.[1]
}

// The `claude` CLI surface this driver depends on; keep these together so a CLI change is one edit.
const AUTH_LOGIN_ARGS = ['auth', 'login']
const AUTH_STATUS_ARGS = ['auth', 'status']

const INVALID_CODE_MARKER = 'Invalid code'
const INVALID_CODE_MESSAGE = 'Could not sign in to Claude. The code was incomplete. Copy the full code and try again.'
const REJECTED_CODE_MESSAGE =
	'Could not sign in to Claude. The code was not accepted. Start again and paste a new code.'

const STDIN_ENCODER = new TextEncoder()

// `claude auth login` failing is user-facing control flow (bad code, network, closed browser),
// not a defect: it carries the message the app shows and is logged, never sent to Sentry. The
// controller reads `.message`, so this stays instanceof Error.
class ClaudeLoginError extends Data.TaggedError('ClaudeLoginError')<{ readonly message: string }> {}

export interface ClaudeLoginCommand {
	readonly executable: string
	readonly prefixArguments: readonly string[]
	readonly env: Record<string, string>
}

const readAccountLabel = Effect.fn('provider_login.claude_account_label')(
	function* (command: ClaudeLoginCommand) {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const handle = yield* spawner.spawn(
			ChildProcess.make(command.executable, [...command.prefixArguments, ...AUTH_STATUS_ARGS], {
				env: command.env,
			}),
		)
		const [text] = yield* Effect.all([Stream.decodeText(handle.stdout).pipe(Stream.mkString), handle.exitCode], {
			concurrency: 'unbounded',
		})
		const parsed = yield* Effect.try(() => JSON.parse(text) as { email?: string; subscriptionType?: string })
		const parts = [parsed.email, parsed.subscriptionType ? `${parsed.subscriptionType} plan` : null].filter(Boolean)
		return parts.length > 0 ? `Signed in as ${parts.join(' · ')}` : 'Signed in'
	},
	Effect.scoped,
	(effect) => effect.pipe(Effect.orElseSucceed(() => 'Signed in')),
)

export function makeClaudeLoginDriver(command: ClaudeLoginCommand): ProviderLoginDriver {
	const codes = Effect.runSync(Queue.unbounded<Uint8Array, Cause.Done>())
	let codeSubmitted = false

	const runLogin = Effect.fn('provider_login.claude_login')(function* (context: ProviderLoginDriverContext) {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
		const handle = yield* spawner
			.spawn(
				ChildProcess.make(command.executable, [...command.prefixArguments, ...AUTH_LOGIN_ARGS], {
					env: command.env,
					stdin: Stream.fromQueue(codes),
					killSignal: 'SIGTERM',
					forceKillAfter: '5 seconds',
				}),
			)
			.pipe(
				Effect.mapError(
					() =>
						new ClaudeLoginError({
							message: 'Could not sign in to Claude. The claude command could not start.',
						}),
				),
			)

		const stdoutDecoder = new TextDecoder()
		const stderrDecoder = new TextDecoder()
		let stdout = ''
		let stderr = ''
		let announcedUrl = false

		// claude prints "Invalid code" on stderr; scan both streams so a reworded CLI still matches.
		const makeInvalidCodeScan = () => {
			let scannedUpTo = 0
			return (cleaned: string) => {
				const invalidAt = cleaned.indexOf(INVALID_CODE_MARKER, scannedUpTo)
				if (invalidAt === -1 || !codeSubmitted) return Effect.void
				scannedUpTo = invalidAt + INVALID_CODE_MARKER.length
				codeSubmitted = false
				return Effect.promise(() => context.update({ error: INVALID_CODE_MESSAGE, clearSubmittedCode: true }))
			}
		}
		const scanStdoutForInvalidCode = makeInvalidCodeScan()
		const scanStderrForInvalidCode = makeInvalidCodeScan()

		const scanStdout = Stream.runForEach(handle.stdout, (chunk) =>
			Effect.suspend(() => {
				stdout += stdoutDecoder.decode(chunk, { stream: true })
				let step = Effect.void
				if (!announcedUrl) {
					const url = parseClaudeAuthorizeUrl(stdout)
					if (url) {
						announcedUrl = true
						step = Effect.andThen(
							step,
							Effect.promise(() => context.update({ status: 'awaiting_approval', url })),
						)
					}
				}
				return Effect.andThen(step, scanStdoutForInvalidCode(stripTerminalEscapes(stdout)))
			}),
		)
		const scanStderr = Stream.runForEach(handle.stderr, (chunk) =>
			Effect.suspend(() => {
				stderr += stderrDecoder.decode(chunk, { stream: true })
				return scanStderrForInvalidCode(stripTerminalEscapes(stderr))
			}),
		)

		const [, , exitCode] = yield* Effect.all([scanStdout, scanStderr, handle.exitCode], {
			concurrency: 'unbounded',
		}).pipe(
			Effect.onInterrupt(() =>
				announcedUrl
					? Effect.void
					: Effect.logWarning(
							'claude auth login stopped before printing a sign-in link; the CLI output may have changed',
						).pipe(
							Effect.annotateLogs({
								requestId: context.requestId,
								outputTail: stripTerminalEscapes(stdout).slice(-200),
							}),
						),
			),
		)
		if (Number(exitCode) !== 0) {
			const detail = stderr.trim() || stdout.trim().split('\n').at(-1) || `exit code ${Number(exitCode)}`
			yield* Effect.logWarning('claude auth login failed').pipe(
				Effect.annotateLogs({ requestId: context.requestId, exitCode: Number(exitCode), detail }),
			)
			return yield* new ClaudeLoginError({
				message: codeSubmitted ? REJECTED_CODE_MESSAGE : `Could not sign in to Claude. ${detail}`,
			})
		}
		const accountLabel = yield* readAccountLabel(command)
		return { accountLabel } satisfies ProviderLoginDriverResult
	}, Effect.scoped)

	return {
		submitCode(code) {
			codeSubmitted = true
			Queue.offerUnsafe(codes, STDIN_ENCODER.encode(`${code}\n`))
		},
		start(context: ProviderLoginDriverContext): Promise<ProviderLoginDriverResult> {
			return Effect.runPromise(
				runLogin(context).pipe(Effect.raceFirst(untilAborted(context)), Effect.provide(BunServices.layer)),
			)
		},
	}
}
