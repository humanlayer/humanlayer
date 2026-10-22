import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { createMemoryAuthStore, ensureFileAuthStore } from '@humanlayer/agentlayer-provider-auth'
import { type CodexFetchLike, startDeviceOAuth } from '@humanlayer/agentlayer-provider-openai-codex'
import { CodexAuthStore, CodexTokenData, layerCodexAuthStore } from '@humanlayer/fold-codex'
import { Data, Effect, Layer } from 'effect'

import type {
	ProviderLoginDriver,
	ProviderLoginDriverContext,
	ProviderLoginDriverResult,
} from '../provider-login.types'
import { ProviderLoginAborted } from '../provider-login.types'
import { untilAborted } from './until-aborted'

// ChatGPT device sign-in failing is user-facing control flow (network, denied approval), not a defect;
// the controller reads `.message`, so this stays instanceof Error.
class CodexLoginError extends Data.TaggedError('CodexLoginError')<{ readonly message: string }> {}

const toLoginError = (error: unknown): ProviderLoginAborted | CodexLoginError =>
	error instanceof ProviderLoginAborted
		? error
		: new CodexLoginError({ message: error instanceof Error ? error.message : 'Could not sign in to ChatGPT.' })

// The device-code SDK drives its own request loop through this fetch. Throwing on an aborted signal
// is what stops that loop mid-flight, since a raced Effect cannot interrupt a promise already in flight.
const abortableFetch =
	(signal: AbortSignal, fetch: CodexFetchLike): CodexFetchLike =>
	async (input, init) => {
		if (signal.aborted) throw new ProviderLoginAborted(signal.reason ?? 'cancelled')
		const response = await fetch(input, { ...init, signal })
		if (signal.aborted) throw new ProviderLoginAborted(signal.reason ?? 'cancelled')
		return response
	}

export const authorizeCodexDevice = (context: ProviderLoginDriverContext, fetch: CodexFetchLike = globalThis.fetch) =>
	Effect.gen(function* () {
		const flow = yield* Effect.tryPromise({
			try: () =>
				startDeviceOAuth({
					store: createMemoryAuthStore(),
					providerId: 'codex',
					fetch: abortableFetch(context.signal, fetch),
				}),
			catch: toLoginError,
		})
		yield* Effect.promise(() =>
			context.update({ status: 'awaiting_approval', url: flow.url, userCode: flow.userCode }),
		)
		const result = yield* Effect.tryPromise({ try: () => flow.complete(), catch: toLoginError })
		return result.auth
	}).pipe(Effect.raceFirst(untilAborted(context)))

/** Device-code sign-in with ChatGPT; the token lands in both the CodeLayer and the Fold Codex stores. */
export function makeCodexDeviceLoginDriver(): ProviderLoginDriver {
	return {
		start(context: ProviderLoginDriverContext): Promise<ProviderLoginDriverResult> {
			return Effect.runPromise(
				Effect.gen(function* () {
					const auth = yield* authorizeCodexDevice(context)
					if (auth?.kind !== 'oauth' || !auth.refreshToken || auth.expiresAt === undefined) {
						return yield* Effect.fail(
							new CodexLoginError({
								message:
									'Could not sign in to ChatGPT. The login finished without a usable credential.',
							}),
						)
					}
					const tokenData: {
						type: 'oauth'
						access: string
						refresh: string
						expires: number
						accountId?: string
					} = {
						type: 'oauth',
						access: auth.accessToken,
						refresh: auth.refreshToken,
						expires: auth.expiresAt,
					}
					if (auth.accountId !== undefined) tokenData.accountId = auth.accountId
					// A credential in hand: persist to both stores as one step so a late abort cannot half-save it.
					yield* Effect.gen(function* () {
						const store = yield* Effect.promise(() => ensureFileAuthStore())
						yield* Effect.promise(() => store.set('codex', auth))
						const foldStore = yield* CodexAuthStore
						yield* foldStore.save(new CodexTokenData(tokenData))
					}).pipe(Effect.uninterruptible)
					return { accountLabel: 'Signed in with ChatGPT' } satisfies ProviderLoginDriverResult
				}).pipe(
					Effect.raceFirst(untilAborted(context)),
					Effect.provide(layerCodexAuthStore().pipe(Layer.provide(NodeFileSystem.layer))),
				),
			)
		},
	}
}
