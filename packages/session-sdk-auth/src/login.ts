// Device login and logout: a WorkOS device code, the org pick, then a daemon token, saved as the
// channel's creds in the client's folder. client.ts reads and refreshes what this writes.

import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'

import {
	type Channel,
	type ChannelConfig,
	getChannelConfig,
	requireClientId,
	jwtClaim,
	timeout,
	withFileLock,
	writeJsonFileAtomic,
} from '@humanlayer/session-sdk-base'

import type { Creds, SessionClient } from './client.ts'

export interface OrgChoice {
	organizationId: string
	organizationName: string
}

export interface LoginUI {
	hasUI: boolean
	showCode: (url: string, code: string) => void
	/** Resolves to the chosen org, or undefined if the user closes the picker. */
	pickOrg: (orgs: OrgChoice[], current: OrgChoice | undefined) => Promise<OrgChoice | undefined>
}

// The poller below is copied, with a small change (timers are unref'd so print mode can still
// exit while a login is pending), from pi-mono's OAuth device-code flow:
//   packages/ai/src/auth/oauth/device-code.ts
// Copyright (c) 2025 Mario Zechner. MIT License. See https://github.com/badlogic/pi-mono/blob/main/LICENSE
// The messages follow "HumanLayer: login failed: ", so they do not name HumanLayer again.
const CANCEL_MESSAGE = 'login cancelled'
const TIMEOUT_MESSAGE = 'the code expired'
const SLOW_DOWN_TIMEOUT_MESSAGE =
	'timed out after one or more slow_down responses. This is often caused by clock drift ' +
	'in WSL or VM environments. Please sync or restart the VM clock and try again.'
const MINIMUM_INTERVAL_MS = 1000
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000

type PollResult<T> =
	| { status: 'pending' }
	| { status: 'slow_down'; intervalSeconds?: number }
	| { status: 'failed'; message: string }
	| { status: 'complete'; value: T }

interface PollOptions<T> {
	intervalSeconds?: number
	expiresInSeconds?: number
	waitBeforeFirstPoll?: boolean
	poll: () => Promise<PollResult<T>>
	signal: AbortSignal
}

function abortableSleep(ms: number, signal: AbortSignal, cancelMessage: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error(cancelMessage))
			return
		}
		const onAbort = () => {
			clearTimeout(timeout)
			reject(new Error(cancelMessage))
		}
		const timeout = setTimeout(() => {
			signal.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		timeout.unref()
		signal.addEventListener('abort', onAbort, { once: true })
	})
}

async function pollDeviceCodeFlow<T>(options: PollOptions<T>): Promise<T> {
	const deadline =
		typeof options.expiresInSeconds === 'number'
			? Date.now() + options.expiresInSeconds * 1000
			: Number.POSITIVE_INFINITY
	let intervalMs = Math.max(
		MINIMUM_INTERVAL_MS,
		Math.floor((options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
	)
	let slowDownResponses = 0

	if (options.waitBeforeFirstPoll) {
		const remainingMs = deadline - Date.now()
		if (remainingMs > 0) await abortableSleep(Math.min(intervalMs, remainingMs), options.signal, CANCEL_MESSAGE)
	}

	while (Date.now() < deadline) {
		if (options.signal.aborted) throw new Error(CANCEL_MESSAGE)
		const result = await options.poll()
		if (result.status === 'complete') return result.value
		if (result.status === 'failed') throw new Error(result.message)
		if (result.status === 'slow_down') {
			slowDownResponses += 1
			intervalMs =
				typeof result.intervalSeconds === 'number' &&
				Number.isFinite(result.intervalSeconds) &&
				result.intervalSeconds > 0
					? Math.max(MINIMUM_INTERVAL_MS, Math.floor(result.intervalSeconds * 1000))
					: Math.max(MINIMUM_INTERVAL_MS, intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_MS)
		}
		const remainingMs = deadline - Date.now()
		if (remainingMs <= 0) break
		await abortableSleep(Math.min(intervalMs, remainingMs), options.signal, CANCEL_MESSAGE)
	}
	throw new Error(slowDownResponses > 0 ? SLOW_DOWN_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE)
}
// End of code copied from pi-mono.

// ---- WorkOS ----

interface WorkosDeviceCode {
	device_code: string
	user_code: string
	verification_uri_complete: string
	interval: number
	expires_in: number
}

/** A WorkOS login: its tokens, and the email it signed in. */
interface Tokens {
	accessToken: string
	refreshToken: string
	email: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function workosForm(cfg: ChannelConfig, path: string, form: Record<string, string>, signal: AbortSignal) {
	return fetch(`${cfg.workos}/user_management/${path}`, {
		method: 'POST',
		headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
		body: new URLSearchParams({ ...form, client_id: requireClientId(cfg) }),
		signal: timeout(15_000, signal),
	})
}

async function startDeviceAuthorize(cfg: ChannelConfig, signal: AbortSignal): Promise<WorkosDeviceCode> {
	const res = await workosForm(cfg, 'authorize/device', {}, signal)
	if (!res.ok) throw new Error(`could not start: HTTP ${res.status}`)
	return (await res.json()) as WorkosDeviceCode
}

async function pollWorkosToken(
	cfg: ChannelConfig,
	deviceCode: string,
	signal: AbortSignal,
): Promise<PollResult<Tokens>> {
	const res = await workosForm(
		cfg,
		'authenticate',
		{ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode },
		signal,
	)
	const json: unknown = await res.json().catch(() => null)
	if (
		res.ok &&
		isRecord(json) &&
		typeof json.access_token === 'string' &&
		typeof json.refresh_token === 'string' &&
		isRecord(json.user) &&
		typeof json.user.email === 'string'
	) {
		return {
			status: 'complete',
			value: { accessToken: json.access_token, refreshToken: json.refresh_token, email: json.user.email },
		}
	}
	const error = isRecord(json) && typeof json.error === 'string' ? json.error : undefined
	if (error === 'authorization_pending') return { status: 'pending' }
	if (error === 'slow_down') return { status: 'slow_down' }
	return { status: 'failed', message: error ?? `HTTP ${res.status}` }
}

/** Opens the url in the default browser, on macOS and Linux. Best effort: never throws. */
export function openBrowser(url: string): void {
	const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : undefined
	if (!cmd) return
	try {
		const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' })
		child.unref()
		child.on('error', () => {})
	} catch {
		// best effort only
	}
}

// ---- the login ----

interface PendingLogin {
	controller: AbortController
	url?: string
	code?: string
}

export interface DeviceLoginOptions {
	/** When true, the login only shows its link and never opens a browser. */
	noBrowser?: () => boolean
}

export type DeviceLogin = ReturnType<typeof createDeviceLogin>

/** Device login and logout for a client. At most one login waits per channel. */
export function createDeviceLogin(client: SessionClient, opts: DeviceLoginOptions = {}) {
	const logins = new Map<Channel, PendingLogin>()

	/** The login waiting on this channel, if any, with its url and code once shown. */
	function pendingLogin(channel: Channel): Omit<PendingLogin, 'controller'> | undefined {
		return logins.get(channel)
	}

	/** Stops a pending login for this channel, if any: its calls end and it writes nothing. */
	function abortLogin(channel: Channel): void {
		logins.get(channel)?.controller.abort()
		logins.delete(channel)
	}

	/** Resolves to undefined if abortLogin (logout) stops it or the user closes the org picker. */
	async function startDeviceLogin(channel: Channel, ui: LoginUI): Promise<Creds | undefined> {
		abortLogin(channel)
		const login: PendingLogin = { controller: new AbortController() }
		logins.set(channel, login)
		const signal = login.controller.signal
		const paths = client.paths()
		try {
			const approved = await approve(channel, login, ui)
			const org = await pickOrg(channel, approved, ui, signal)
			if (!org) return undefined
			const tokens = await scopeTo(channel, approved, org, signal)
			const creds = await credsFor(channel, tokens, org, signal)
			// logout removes the creds under this lock, so it either stops this write or undoes it.
			await withFileLock(paths.lock(channel), async () => {
				signal.throwIfAborted()
				await writeJsonFileAtomic(paths.session(channel), creds)
			})
			await client.saveChannel(channel)
			signal.throwIfAborted()
			return creds
		} catch (err) {
			if (signal.aborted) return undefined
			throw err
		} finally {
			if (logins.get(channel) === login) logins.delete(channel)
		}
	}

	/** Shows a device code and waits for the user to approve it in the browser. */
	async function approve(channel: Channel, login: PendingLogin, ui: LoginUI): Promise<Tokens> {
		const cfg = getChannelConfig(channel)
		const signal = login.controller.signal
		const dc = await startDeviceAuthorize(cfg, signal)
		signal.throwIfAborted()
		login.url = dc.verification_uri_complete
		login.code = dc.user_code
		ui.showCode(dc.verification_uri_complete, dc.user_code)
		if (!opts.noBrowser?.()) openBrowser(dc.verification_uri_complete)
		return pollDeviceCodeFlow<Tokens>({
			intervalSeconds: dc.interval,
			expiresInSeconds: dc.expires_in,
			waitBeforeFirstPoll: true,
			signal,
			poll: () => pollWorkosToken(cfg, dc.device_code, signal),
		})
	}

	/**
	 * The org to sign in to: the picker's choice when there are several and a UI, else the current
	 * one, else the first. Undefined when the user closes the picker.
	 */
	async function pickOrg(
		channel: Channel,
		tokens: Tokens,
		ui: LoginUI,
		signal: AbortSignal,
	): Promise<OrgChoice | undefined> {
		const { organizations: orgs } = await client.rpc<{ organizations: OrgChoice[] }>(
			channel,
			'api',
			'auth/user/organizations/list',
			{},
			tokens.accessToken,
			signal,
		)
		if (orgs.length === 0) throw new Error('you have no organization. Create or join one in the web app.')
		// The current org: the one signed in now, else the one the token is scoped to. The token's
		// org_id is a WorkOS "org_..." id like organizations[].organizationId; the response's own
		// activeOrganizationId is the internal uuid, so it can't be compared with them.
		const savedOrgId = (await client.readCreds(channel))?.workosOrgId
		const byId = (id: string | undefined) => orgs.find((o) => o.organizationId === id)
		const current = byId(savedOrgId) ?? byId(jwtClaim(tokens.accessToken, 'org_id'))
		return orgs.length > 1 && ui.hasUI ? ui.pickOrg(orgs, current) : (current ?? orgs[0])
	}

	/** Tokens scoped to the org: a refresh pins them to it, unless they are already. */
	async function scopeTo(channel: Channel, tokens: Tokens, org: OrgChoice, signal: AbortSignal): Promise<Tokens> {
		if (jwtClaim(tokens.accessToken, 'org_id') === org.organizationId) return tokens
		const refreshed = await client.rpc<{ accessToken: string; refreshToken: string }>(
			channel,
			'api',
			'auth/token/refresh',
			{ refreshToken: tokens.refreshToken, organizationId: org.organizationId },
			undefined,
			signal,
		)
		return { email: tokens.email, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken }
	}

	/** The creds to save: the ids from the access token, and a daemon token for this host. */
	async function credsFor(channel: Channel, tokens: Tokens, org: OrgChoice, signal: AbortSignal): Promise<Creds> {
		const claim = (key: string) => {
			const value = jwtClaim(tokens.accessToken, key)
			if (!value) throw new Error(`the token is missing claim "${key}"`)
			return value
		}
		const userId = claim('sub')
		const orgId = claim('internal_org_id')
		const workosOrgId = claim('org_id')
		const daemonHostId = await client.hostId(channel)
		const daemon = await client.rpc<{ token: string }>(
			channel,
			'api',
			'auth/daemon/token/create',
			{ hostId: daemonHostId },
			tokens.accessToken,
			signal,
		)
		return {
			version: 1,
			channel,
			email: tokens.email,
			userId,
			orgId,
			workosOrgId,
			orgName: org.organizationName,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			daemonToken: daemon.token,
			daemonHostId,
		}
	}

	async function logout(channel: Channel): Promise<void> {
		abortLogin(channel)
		const paths = client.paths()
		await withFileLock(paths.lock(channel), () => unlink(paths.session(channel)).catch(() => {}))
	}

	return { pendingLogin, abortLogin, startDeviceLogin, logout }
}
