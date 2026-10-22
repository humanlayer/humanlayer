import { spawn } from 'node:child_process'

import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { ensureFileAuthStore, removeAuth } from '@humanlayer/agentlayer-provider-auth'
import { CodexAuthStore, CodexTokenData, layerCodexAuthStore } from '@humanlayer/fold-codex'
import { XaiAuth, XaiAuthStore, layerXaiAuth, layerXaiAuthStore } from '@humanlayer/fold-xai'
import type { Command } from 'commander'
import { Console, Effect, Layer, Option } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

type Provider = 'codex' | 'xai'

const codexAuthStore = layerCodexAuthStore().pipe(Layer.provide(NodeFileSystem.layer))
const xaiAuthStore = layerXaiAuthStore().pipe(Layer.provide(NodeFileSystem.layer))

async function promptStdin(): Promise<string> {
	return new Promise<string>((resolve) => {
		process.stdin.once('data', (data) => {
			process.stdin.pause()
			resolve(data.toString().trim())
		})
	})
}

function openBrowser(url: string): void {
	const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
	spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

async function chooseLoginMethod(): Promise<'browser' | 'device'> {
	console.log('  Select authentication method:')
	console.log()
	console.log('    1. Browser - opens a browser for login')
	console.log('    2. Device code - enter a code at the displayed URL')
	console.log()
	process.stdout.write('  Enter number (1 or 2): ')
	const choice = await promptStdin()
	if (choice === '1') return 'browser'
	if (choice === '2') return 'device'
	throw new Error('Invalid selection. Enter 1 or 2.')
}

async function codexStatus(): Promise<boolean> {
	const agentLayerAuth = await (await ensureFileAuthStore()).get('codex')
	const foldAuth = await Effect.runPromise(
		Effect.gen(function* () {
			const store = yield* CodexAuthStore
			return yield* store.load
		}).pipe(Effect.provide(codexAuthStore)),
	)
	console.log(`  CodeLayer: ${agentLayerAuth ? 'authenticated' : 'not authenticated'}`)
	console.log(`  Fold: ${Option.isSome(foldAuth) ? 'authenticated' : 'not authenticated'}`)
	return agentLayerAuth !== undefined && Option.isSome(foldAuth)
}

async function xaiStatus(): Promise<boolean> {
	const auth = await Effect.runPromise(
		Effect.gen(function* () {
			const store = yield* XaiAuthStore
			return yield* store.load
		}).pipe(Effect.provide(xaiAuthStore)),
	)
	console.log(`  Fold: ${Option.isSome(auth) ? 'authenticated' : 'not authenticated'}`)
	return Option.isSome(auth)
}

async function showStatus(provider: Provider, includeLoginHint: boolean, commandPrefix = 'agents auth'): Promise<void> {
	const authenticated = provider === 'codex' ? await codexStatus() : await xaiStatus()
	if (!authenticated && includeLoginHint) {
		console.log()
		console.log(`  To log in, run: humanlayer ${commandPrefix} ${provider} login`)
	}
}

async function loginCodex(): Promise<void> {
	const method = await chooseLoginMethod()
	const store = await ensureFileAuthStore()
	if (method === 'browser') {
		const { startBrowserOAuth } = await import('@humanlayer/agentlayer-provider-openai-codex')
		const flow = await startBrowserOAuth({ store, providerId: 'codex' })
		console.log(`  If the browser does not open, visit: ${flow.url}`)
		openBrowser(flow.url)
		await flow.complete()
	} else {
		const { startDeviceOAuth } = await import('@humanlayer/agentlayer-provider-openai-codex')
		const flow = await startDeviceOAuth({ store, providerId: 'codex' })
		console.log(`  Open ${flow.url} and enter code: ${flow.userCode}`)
		console.log('  Waiting for authentication...')
		await flow.complete()
	}

	const auth = await store.get('codex')
	if (auth?.kind !== 'oauth' || !auth.refreshToken || auth.expiresAt === undefined) {
		throw new Error('Codex login completed without a usable OAuth credential.')
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
	await Effect.runPromise(
		Effect.gen(function* () {
			const foldStore = yield* CodexAuthStore
			yield* foldStore.save(new CodexTokenData(tokenData))
		}).pipe(Effect.provide(codexAuthStore)),
	)
	console.log('  Codex authenticated for CodeLayer and Fold.')
}

export const displayXaiBrowserInstructions = (url: string) =>
	Console.log(`  If the browser does not open, visit: ${url}`)

export const displayXaiDeviceInstructions = (prompt: { verificationUri: string; userCode: string }) =>
	Console.log(`  Open ${prompt.verificationUri} and enter code: ${prompt.userCode}`).pipe(
		Effect.andThen(Console.log('  Waiting for authentication...')),
	)

async function loginXai(): Promise<void> {
	const method = await chooseLoginMethod()
	const xaiAuth = layerXaiAuth({
		onBrowserUrl: (url) =>
			displayXaiBrowserInstructions(url).pipe(Effect.andThen(Effect.sync(() => openBrowser(url)))),
		onDeviceCode: displayXaiDeviceInstructions,
	}).pipe(Layer.provide([xaiAuthStore, FetchHttpClient.layer]))
	const program = Effect.gen(function* () {
		const auth = yield* XaiAuth
		return yield* method === 'browser' ? auth.authenticateBrowser : auth.authenticateDevice
	}).pipe(Effect.provide(xaiAuth))
	await Effect.runPromise(program)
	console.log('  xAI authenticated for the Fold coding agent.')
}

async function logout(provider: Provider): Promise<void> {
	if (provider === 'codex') {
		await removeAuth('codex')
		await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* CodexAuthStore
				yield* store.clear
			}).pipe(Effect.provide(codexAuthStore)),
		)
		console.log('  Removed Codex credentials for CodeLayer and Fold.')
		return
	}
	await Effect.runPromise(
		Effect.gen(function* () {
			const store = yield* XaiAuthStore
			yield* store.clear
		}).pipe(Effect.provide(xaiAuthStore)),
	)
	console.log('  Removed xAI credentials for Fold.')
}

function registerProvider(authCommand: Command, provider: Provider, commandPrefix: string): void {
	const description =
		provider === 'codex'
			? 'Authenticate Codex for CodeLayer and Fold'
			: 'Authenticate xAI for the Fold coding agent only; enable Fold in Settings > Experiments'
	const command = authCommand
		.command(provider)
		.description(description)
		.action(() => showStatus(provider, true, commandPrefix))
	command
		.command('login')
		.description(`Log in to ${provider === 'codex' ? 'Codex' : 'xAI'}`)
		.action(() => (provider === 'codex' ? loginCodex() : loginXai()))
	command
		.command('status')
		.description('Show current authentication status')
		.action(() => showStatus(provider, true, commandPrefix))
	command
		.command('logout')
		.description('Clear stored credentials')
		.action(() => logout(provider))
}

export function registerAgentsAuthCommands(agentsCommand: Command): void {
	const auth = agentsCommand.command('auth').description('Manage coding agent authentication')
	registerProvider(auth, 'codex', 'agents auth')
	registerProvider(auth, 'xai', 'agents auth')
}

export function registerFoldAuthCommands(program: Command): void {
	const fold = program.command('fold').description('Manage Fold coding agent providers')
	const auth = fold.command('auth').description('Manage Fold provider authentication')
	registerProvider(auth, 'codex', 'fold auth')
	registerProvider(auth, 'xai', 'fold auth')
}
