// Test-only harness: a print-mode pi session with one inline extension bound. Mirrors the
// verified pattern in research-02 §5 ("Verified out-of-tree unit test"): a faux model provider
// plus DefaultResourceLoader + createAgentSession + bindExtensions({mode: "print"}), which is
// what real print-mode pi does to emit session_start. capture.test.ts and artifacts.test.ts
// script the faux provider and call session.prompt() in setUp()'s environment; extension.test.ts
// only runs commands.
//
// ctx.ui calls land on pi's internal no-op UI context here (no uiContext is passed to
// bindExtensions, matching real print mode), so they cannot be asserted on directly. Assert
// instead on what the extension itself does: files it writes, requests the mock cloud recorded,
// and text it prints via console.error (which it uses whenever ctx.hasUI is false, as here).

import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { type FauxProviderHandle, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type InlineExtension,
	ModelRuntime,
	SessionManager,
	type SessionShutdownEvent,
	type SessionStartEvent,
	SettingsManager,
} from '@earendil-works/pi-coding-agent'

import { createHumanlayer } from '../../src/index.ts'
import { MOCK_PAT, type MockCloud, startMockCloud } from './mock-cloud.ts'

export interface TestSessionOptions {
	/** A cwd the caller owns and removes, e.g. one shared by a session and its reload. */
	cwd?: string
	/** Share one SessionManager across sessions, as /reload does. */
	sessionManager?: SessionManager
	/** session_start's payload; startup by default. */
	sessionStartEvent?: SessionStartEvent
	/** Settings for the in-memory SettingsManager, e.g. compaction.keepRecentTokens. */
	settings?: Parameters<typeof SettingsManager.inMemory>[0]
	/** Other extensions, loaded (and so run) before the one under test. */
	extensions?: InlineExtension[]
	/** The mode extensions are bound in; print by default. rpc is a long-lived session that takes web messages. */
	mode?: 'print' | 'rpc'
}

export interface TestSession {
	/** pi's own working directory for this session, as a realpath (like ctx.cwd). */
	cwd: string
	session: AgentSession
	faux: FauxProviderHandle
	sessionManager: SessionManager
	/** Dispatches "name args" (a leading "/" is allowed) through pi's real command lookup. */
	runCommand(invocation: string): Promise<void>
	/** Emits session_shutdown, disposes the session, then removes cwd unless the caller owns it. Call once, last. */
	shutdown(reason?: SessionShutdownEvent['reason']): Promise<void>
}

// Riptide homes live in one temp root per test process, removed at exit, not as each test ends: a
// request cut short at shutdown can still log a line into its test's home after that. The process
// gets a home too, so nothing, not even a log line written after a test put its env back, lands in
// the real ~/.humanlayer.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-')))
process.on('exit', () => rmSync(root, { recursive: true, force: true }))
process.env.HUMANLAYER_RIPTIDE_HOME ??= mkdtempSync(join(root, 'home-'))
// pi's agent dir holds settings.json, where the extension keeps its default; never the real one.
process.env.PI_CODING_AGENT_DIR ??= mkdtempSync(join(root, 'agent-'))

/** A print-mode session with `factory` (after opts.extensions) as its only extensions. The model is a faux provider. */
export async function createTestSession(factory: InlineExtension, opts: TestSessionOptions = {}): Promise<TestSession> {
	const cwd = opts.cwd ?? realpathSync(mkdtempSync(join(tmpdir(), 'pi-hl-test-')))
	const agentDir = join(cwd, 'agent')

	const faux = fauxProvider()
	const credentials = new InMemoryCredentialStore()
	await credentials.modify(faux.provider.id, async () => ({ type: 'api_key', key: 'faux' }))
	const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null })
	modelRuntime.registerNativeProvider(faux.provider)

	const settingsManager = SettingsManager.inMemory(opts.settings)
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [...(opts.extensions ?? []), factory],
	})
	await resourceLoader.reload()

	const sessionManager = opts.sessionManager ?? SessionManager.inMemory(cwd)
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		model: faux.getModel(),
		resourceLoader,
		settingsManager,
		sessionManager,
		...(opts.sessionStartEvent ? { sessionStartEvent: opts.sessionStartEvent } : {}),
	})
	await session.bindExtensions({ mode: opts.mode ?? 'print' }) // emits session_start, like pi's own modes do

	return {
		cwd,
		session,
		faux,
		sessionManager,
		async runCommand(invocation: string): Promise<void> {
			const rest = invocation.startsWith('/') ? invocation.slice(1) : invocation
			const spaceIndex = rest.indexOf(' ')
			const name = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex)
			const args = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1)
			const resolved = session.extensionRunner.getCommand(name)
			if (!resolved) throw new Error(`HumanLayer test harness: no such command "${name}"`)
			await resolved.handler(args, session.extensionRunner.createCommandContext())
		},
		async shutdown(reason = 'quit'): Promise<void> {
			await session.extensionRunner.emit({ type: 'session_shutdown', reason })
			session.dispose()
			if (!opts.cwd) rmSync(cwd, { recursive: true, force: true })
		},
	}
}

const STASH_KEY = Symbol.for('humanlayer.pi.v1')

/** auth.ts's PAT/daemon-token stash lives on globalThis, so tests must clear it by hand. */
export function resetGlobalStash(): void {
	delete (globalThis as Record<symbol, unknown>)[STASH_KEY]
}

/** Collects console.error output for the duration of test t, where print mode sends notices. */
export function captureConsoleError(t: TestContext): string[] {
	const lines: string[] = []
	const original = console.error
	console.error = (...args: unknown[]) => {
		lines.push(args.map(String).join(' '))
	}
	t.after(() => {
		console.error = original
	})
	return lines
}

/** Sets process.env vars for the duration of test t, restoring the previous values afterwards. */
export function withEnv(t: TestContext, vars: Record<string, string | undefined>): void {
	const prev = new Map<string, string | undefined>()
	for (const key of Object.keys(vars)) prev.set(key, process.env[key])
	applyEnv(vars)
	t.after(() => applyEnv(Object.fromEntries(prev)))
}

function applyEnv(vars: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
}

/** A short outbox backoff, so retries take milliseconds. */
const humanlayer = createHumanlayer({ initialBackoffMs: 1, maxBackoffMs: 5 })

export interface Env {
	cloud: MockCloud
	/** The temp HUMANLAYER_RIPTIDE_HOME. */
	home: string
	/** console.error output: print-mode notices and /humanlayer replies. */
	lines: string[]
	/** A session with the extension loaded. The test's end shuts it down, unless the test did. */
	open(opts?: TestSessionOptions): Promise<TestSession>
}

/** A mock cloud, a temp riptide home, and HUMANLAYER_PAT unless auth is "none". env adds to or overrides the vars. */
export async function setUp(
	t: TestContext,
	auth: 'pat' | 'none' = 'pat',
	env: Record<string, string | undefined> = {},
): Promise<Env> {
	resetGlobalStash()
	const cloud = await startMockCloud()
	const live = new Set<TestSession>()
	// t.after hooks run in the order they were added, so this one runs while the env below still
	// points at this mock: the sessions' shutdown flush must reach it, not the real URLs.
	t.after(async () => {
		for (const s of [...live]) await s.shutdown()
		await cloud.close()
		resetGlobalStash()
	})
	const home = mkdtempSync(join(root, 'capture-'))
	withEnv(t, {
		HUMANLAYER_RIPTIDE_HOME: home,
		PI_CODING_AGENT_DIR: join(home, 'agent'),
		HUMANLAYER_CHANNEL: 'local',
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_WORKOS_CLIENT_ID: 'client_test',
		HUMANLAYER_SYNC_URL: cloud.url,
		HUMANLAYER_APP_URL: 'http://app.test',
		HUMANLAYER_PAT: auth === 'pat' ? MOCK_PAT : undefined,
		HUMANLAYER_TASK: undefined,
		HUMANLAYER_PI_DISABLE: undefined,
		HUMANLAYER_PI_CODING_AGENT: undefined,
		HUMANLAYER_PI_FLUSH_MS: '2000',
		...env,
	})
	const lines = captureConsoleError(t)
	return {
		cloud,
		home,
		lines,
		async open(opts) {
			const inner = await createTestSession(humanlayer, opts)
			const s: TestSession = {
				...inner,
				async shutdown(reason) {
					live.delete(s)
					await inner.shutdown(reason)
				},
			}
			live.add(s)
			return s
		},
	}
}

/** Polls check every 10 ms until it holds; fails the test after ms. */
export async function waitFor(what: string, check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
	const deadline = Date.now() + ms
	while (!(await check())) {
		if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}
