// Credentials for a session-side client that runs inside a coding agent (pi, opencode): the
// HUMANLAYER_PAT or the saved device login, the access token kept fresh, and the daemon token.
// Each agent keeps its own folder, so its logins, host ids and saved channel stay apart.
// login.ts writes the saved login; this module reads and refreshes it.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
	type ApiRequest,
	type ApiResponse,
	type Channel,
	type DaemonPath,
	type DaemonRequest,
	type DaemonResponse,
	decodeJwtPayload,
	getChannelConfig,
	isChannel,
	isTokenRefused,
	jwtClaim,
	LoginRequiredError,
	type Plane,
	readJsonFile,
	rpcCall,
	RpcError,
	withFileLock,
	writeJsonFileAtomic,
} from '@humanlayer/session-sdk-base'

export interface Creds {
	version: 1
	channel: Channel
	email: string
	userId: string
	orgId: string // internal org uuid (access JWT's internal_org_id); the daemon token carries this one
	workosOrgId: string // WorkOS org id ("org_..."; access JWT's org_id); pins auth/token/refresh
	orgName: string
	accessToken: string
	refreshToken: string
	daemonToken: string
	daemonHostId: string
}

export interface Identity {
	channel: Channel
	source: 'device' | 'pat'
	email?: string
	orgName?: string
	orgId?: string
	userId?: string
}

export type PrepareBody = ApiRequest<'automation/run/prepare'>
export type Prepared = ApiResponse<'automation/run/prepare'>

export interface SessionClientOptions {
	/** The agent's folder for logins, host ids and the saved channel. Read on each use, so tests can move it. */
	dir: () => string
	/** Gets one line per call and per token change. Never a token or a body. */
	log: (line: string) => void
	/** Ends the messages that ask for a login, e.g. "Run /humanlayer login". */
	loginHint: string
	/** The globalThis key that keeps the scrubbed HUMANLAYER_PAT, and its daemon tokens, across module reloads. */
	stashKey: string
}

/** Where a client keeps its files, inside its folder. */
export function authPaths(dir: string) {
	return {
		config: join(dir, 'config.json'),
		host: (channel: Channel) => join(dir, `host-${channel}.json`),
		session: (channel: Channel) => join(dir, `session-${channel}.json`),
		lock: (channel: Channel) => join(dir, `session-${channel}.json.lock`),
	}
}

interface GlobalStash {
	pat?: string
	patDaemonTokens?: Partial<Record<Channel, string>>
}

export type SessionClient = ReturnType<typeof createSessionClient>

export function createSessionClient(opts: SessionClientOptions) {
	const paths = () => authPaths(opts.dir())
	const notSignedIn = `Not signed in to HumanLayer. ${opts.loginHint}`
	const stashKey = Symbol.for(opts.stashKey)

	/**
	 * POST {api}/rpc/{plane}/v1/{path}. `cred` is a bearer (api plane) or raw daemon token (daemon
	 * plane). Logs one line per call: the outcome, time and request size, never the body or cred.
	 */
	function rpc<T>(
		channel: Channel,
		plane: Plane,
		path: string,
		body: unknown,
		cred?: string,
		signal?: AbortSignal,
	): Promise<T> {
		return rpcCall<T>({
			api: getChannelConfig(channel).api,
			plane,
			path,
			body,
			cred,
			signal,
			onDone: (outcome, ms, bytes) => opts.log(`${plane} ${path} ${outcome} ${ms}ms ${bytes}B`),
		})
	}

	/** HUMANLAYER_CHANNEL, then the saved channel, then prod. */
	async function resolveChannel(): Promise<Channel> {
		const envChannel = process.env.HUMANLAYER_CHANNEL
		if (isChannel(envChannel)) return envChannel
		const saved = await readJsonFile<{ channel?: string }>(paths().config)
		if (isChannel(saved?.channel)) return saved.channel
		return 'prod'
	}

	async function saveChannel(channel: Channel): Promise<void> {
		await writeJsonFileAtomic(paths().config, { channel })
	}

	/** Host id reads in flight, by host file: callers at once share one read, or one creation. */
	const hostIds = new Map<string, Promise<string>>()

	/**
	 * This machine's host id for the channel, made once and kept across logout. The first callers
	 * race to make it; the file lock and the shared promise make them agree on one id.
	 */
	function hostId(channel: Channel): Promise<string> {
		const file = paths().host(channel)
		let id = hostIds.get(file)
		if (!id) {
			id = withFileLock(`${file}.lock`, async () => {
				const existing = await readJsonFile<{ hostId: string }>(file)
				if (existing && typeof existing.hostId === 'string' && existing.hostId.length > 0)
					return existing.hostId
				const made = randomUUID()
				await writeJsonFileAtomic(file, { hostId: made })
				return made
			}).finally(() => hostIds.delete(file))
			hostIds.set(file, id)
		}
		return id
	}

	function stash(): GlobalStash {
		const saved: GlobalStash | undefined = Reflect.get(globalThis, stashKey)
		if (saved) return saved
		const fresh: GlobalStash = {}
		Reflect.set(globalThis, stashKey, fresh)
		return fresh
	}

	/** Reads HUMANLAYER_PAT once, then deletes it from process.env so children never see it. */
	function getPat(): string | undefined {
		const s = stash()
		if (s.pat === undefined) {
			const fromEnv = process.env.HUMANLAYER_PAT
			if (fromEnv !== undefined) {
				s.pat = fromEnv
				delete process.env.HUMANLAYER_PAT
			}
		}
		return s.pat
	}

	function readCreds(channel: Channel): Promise<Creds | null> {
		return readJsonFile<Creds>(paths().session(channel))
	}

	async function identity(channel: Channel): Promise<Identity | null> {
		if (getPat()) return { channel, source: 'pat' }
		const creds = await readCreds(channel)
		if (!creds) return null
		return {
			channel,
			source: 'device',
			email: creds.email,
			orgName: creds.orgName,
			orgId: creds.orgId,
			userId: creds.userId,
		}
	}

	function isFresh(creds: Creds): boolean {
		const claims = decodeJwtPayload(creds.accessToken)
		const exp = typeof claims.exp === 'number' ? claims.exp : 0
		return exp * 1000 - Date.now() > 60_000 // refresh within 60s of exp
	}

	async function refreshAndSave(channel: Channel, current: Creds): Promise<string> {
		let refreshed: { accessToken: string; refreshToken: string }
		try {
			refreshed = await rpc<{ accessToken: string; refreshToken: string }>(channel, 'api', 'auth/token/refresh', {
				refreshToken: current.refreshToken,
				organizationId: current.workosOrgId,
			})
		} catch (err) {
			// auth/token/refresh is public and returns 400 BAD_REQUEST "Failed to refresh token" on
			// any failure (expired, revoked, reused); treat a 401 the same way defensively.
			if (err instanceof RpcError && (err.status === 400 || err.status === 401)) {
				throw new LoginRequiredError(`HumanLayer sign-in expired. ${opts.loginHint}`)
			}
			throw err
		}
		const updated: Creds = { ...current, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken }
		await writeJsonFileAtomic(paths().session(channel), updated)
		return updated.accessToken
	}

	/** Refreshes only if within 60s of exp. Re-reads under the lock first. */
	async function refreshAccessToken(channel: Channel): Promise<string> {
		const first = await readCreds(channel)
		if (!first) throw new LoginRequiredError(notSignedIn)
		if (isFresh(first)) return first.accessToken
		return withFileLock(paths().lock(channel), async () => {
			const current = await readCreds(channel)
			if (!current) throw new LoginRequiredError(notSignedIn)
			if (isFresh(current)) return current.accessToken // another process refreshed first
			return refreshAndSave(channel, current)
		})
	}

	/** Unconditional refresh used after a live 401, skipped if another process already refreshed staleToken. */
	async function refreshAccessTokenFrom(channel: Channel, staleToken: string): Promise<string> {
		return withFileLock(paths().lock(channel), async () => {
			const current = await readCreds(channel)
			if (!current) throw new LoginRequiredError(notSignedIn)
			if (current.accessToken !== staleToken) return current.accessToken // another process refreshed first
			return refreshAndSave(channel, current)
		})
	}

	/**
	 * Calls an API-plane route with the PAT or the device access token. On a 401 from an
	 * already-"fresh" token, refreshes once and retries once. A PAT cannot be refreshed, so a 401
	 * on it means the PAT itself is invalid or revoked: login required.
	 */
	async function apiRpc<T>(channel: Channel, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
		const pat = getPat()
		// A refresh is never aborted: the server may have spent the refresh token already.
		const bearer = pat ?? (await refreshAccessToken(channel))
		try {
			return await rpc<T>(channel, 'api', path, body, bearer, signal)
		} catch (err) {
			if (pat) {
				if (err instanceof RpcError && err.status === 401) {
					throw new LoginRequiredError('HUMANLAYER_PAT was rejected (401). Set a valid HUMANLAYER_PAT.')
				}
				throw err
			}
			if (!(err instanceof RpcError) || err.status !== 401) throw err
			const retried = await refreshAccessTokenFrom(channel, bearer)
			return rpc<T>(channel, 'api', path, body, retried, signal)
		}
	}

	async function mintDaemonToken(channel: Channel, host: string, signal?: AbortSignal): Promise<string> {
		const minted = await apiRpc<{ token: string }>(channel, 'auth/daemon/token/create', { hostId: host }, signal)
		return minted.token
	}

	async function remintPatDaemonToken(channel: Channel, signal?: AbortSignal): Promise<string> {
		if (!getPat()) throw new LoginRequiredError('HUMANLAYER_PAT not set')
		const token = await mintDaemonToken(channel, await hostId(channel), signal)
		const s = stash()
		if (!s.patDaemonTokens) s.patDaemonTokens = {}
		s.patDaemonTokens[channel] = token
		return token
	}

	async function daemonToken(channel: Channel, signal?: AbortSignal): Promise<string> {
		if (getPat()) return stash().patDaemonTokens?.[channel] ?? remintPatDaemonToken(channel, signal)
		const creds = await readCreds(channel)
		if (!creds) throw new LoginRequiredError(notSignedIn)
		return creds.daemonToken
	}

	/** The internal org uuid the daemon token carries, if it has one. */
	async function daemonOrgId(channel: Channel, signal?: AbortSignal): Promise<string | undefined> {
		return jwtClaim(await daemonToken(channel, signal), 'organizationId')
	}

	/**
	 * Mints a new daemon token and saves it. The mint may refresh and save the access token, and
	 * another process may refresh, remint, log in or log out meanwhile, so the save re-reads under
	 * the lock and keeps a token someone else saved. The lock is not held across the mint: a
	 * refresh takes the same lock.
	 */
	async function remintDaemonToken(channel: Channel, signal?: AbortSignal): Promise<string> {
		if (getPat()) return remintPatDaemonToken(channel, signal)
		const before = await readCreds(channel)
		if (!before) throw new LoginRequiredError(notSignedIn)
		const token = await mintDaemonToken(channel, before.daemonHostId, signal)
		return withFileLock(paths().lock(channel), async () => {
			const current = await readCreds(channel)
			if (!current) throw new LoginRequiredError(notSignedIn)
			if (current.daemonToken !== before.daemonToken) return current.daemonToken
			await writeJsonFileAtomic(paths().session(channel), { ...current, daemonToken: token })
			return token
		})
	}

	/**
	 * Runs a daemon-plane request with the daemon token, and once more with a fresh token when the
	 * cloud refuses the first. A second refusal is thrown: classifyRpcError reads it as login required.
	 */
	async function withDaemonToken<T>(
		channel: Channel,
		signal: AbortSignal | undefined,
		request: (token: string) => Promise<T>,
	): Promise<T> {
		try {
			return await request(await daemonToken(channel, signal))
		} catch (err) {
			if (!isTokenRefused(err)) throw err
			return request(await remintDaemonToken(channel, signal))
		}
	}

	/** One daemon-plane call with this host's daemon token, re-minted once if the cloud refuses it. */
	function daemonCall<P extends DaemonPath>(
		channel: Channel,
		path: P,
		body: DaemonRequest<P>,
		signal?: AbortSignal,
	): Promise<DaemonResponse<P>> {
		return withDaemonToken(channel, signal, (token) =>
			rpc<DaemonResponse<P>>(channel, 'daemon', path, body, token, signal),
		)
	}

	/** automation/run/prepare, with the signed-in user's bearer. */
	function prepare(channel: Channel, body: PrepareBody, signal?: AbortSignal): Promise<Prepared> {
		return apiRpc<Prepared>(channel, 'automation/run/prepare', body, signal)
	}

	return {
		paths,
		loginHint: opts.loginHint,
		log: opts.log,
		rpc,
		resolveChannel,
		saveChannel,
		hostId,
		getPat,
		readCreds,
		identity,
		apiRpc,
		daemonToken,
		daemonOrgId,
		remintDaemonToken,
		withDaemonToken,
		daemonCall,
		prepare,
	}
}
