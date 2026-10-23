// auth.ts and login.ts against a mock WorkOS + riptide-api. Covers plan.md §9's auth.test.ts bullet list:
// device login end to end (pending, slow_down, success), org pick, org switch refresh, daemon
// mint, creds file mode 0600 and atomic writes, refresh on 401 once, two processes refreshing
// under the lock, PAT path scrubs process.env.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { apiRpc, type Creds, daemonToken, getPat, identity, remintDaemonToken, withDaemonToken } from '../src/auth.ts'
import type { Channel } from '../src/config.ts'
import { sessionFilePath, sessionLockPath } from '../src/config.ts'
import { abortLogin, type LoginUI, logout, type OrgChoice, pendingLogin, startDeviceLogin } from '../src/login.ts'
import { LoginRequiredError, RpcError } from '../src/rpc.ts'
import { decodeJwtPayload } from '../src/util.ts'
import { waitFor, withEnv } from './helpers/harness.ts'
import { type MockCloud, type MockOrg, startMockCloud } from './helpers/mock-cloud.ts'

const CHANNEL: Channel = 'local'
const STASH_KEY = Symbol.for('humanlayer.pi.v1')

/** auth.ts's PAT/daemon-token stash is meant to survive /reload, so tests must clear it by hand. */
function resetGlobalStash(): void {
	delete (globalThis as Record<symbol, unknown>)[STASH_KEY]
}

/** Fresh mock cloud, fresh HUMANLAYER_RIPTIDE_HOME, no leftover PAT or stash from an earlier test. */
async function setUpChannel(t: TestContext): Promise<{ channel: Channel; cloud: MockCloud }> {
	resetGlobalStash()
	delete process.env.HUMANLAYER_PAT
	const home = await mkdtemp(join(tmpdir(), 'pi-hl-auth-'))
	const cloud = await startMockCloud()
	t.after(() => cloud.close())
	withEnv(t, {
		HUMANLAYER_RIPTIDE_HOME: home,
		HUMANLAYER_API_URL: cloud.url,
		HUMANLAYER_WORKOS_URL: cloud.url,
		HUMANLAYER_WORKOS_CLIENT_ID: 'client_test',
	})
	return { channel: CHANNEL, cloud }
}

type Pick = (orgs: OrgChoice[], current: OrgChoice | undefined) => OrgChoice | undefined

/** A LoginUI that records shown codes and either rejects pickOrg or answers with pick. */
function fakeUI(opts?: { hasUI?: boolean; pick?: Pick }): { ui: LoginUI; codes: { url: string; code: string }[] } {
	const codes: { url: string; code: string }[] = []
	const ui: LoginUI = {
		hasUI: opts?.hasUI ?? true,
		showCode(url, code) {
			codes.push({ url, code })
		},
		async pickOrg(orgs, current) {
			if (!opts?.pick) throw new Error('pickOrg should not have been called')
			return opts.pick(orgs, current)
		},
	}
	return { ui, codes }
}

test('startDeviceLogin: pending, then slow_down, then success; saves 0600 creds with no leftover tmp files', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.nextDeviceScript = ['pending', 'slow_down']
	const { ui, codes } = fakeUI()

	const creds = await startDeviceLogin(channel, ui)

	assert.ok(creds)
	assert.equal(creds.channel, channel)
	assert.equal(creds.email, cloud.state.email)
	assert.equal(creds.orgName, cloud.state.orgs[0]?.organizationName)
	assert.equal(codes.length, 1)
	assert.match(codes[0]!.url, /^https:\/\/example\.invalid\/device\?code=/)

	const authenticateCalls = cloud.requests.filter((r) => r.path === '/user_management/authenticate')
	assert.equal(authenticateCalls.length, 3) // pending, slow_down, success

	const path = sessionFilePath(channel)
	const fileStat = statSync(path)
	assert.equal(fileStat.mode & 0o777, 0o600)
	const saved = JSON.parse(readFileSync(path, 'utf8')) as Creds
	assert.deepEqual(saved, creds)
	const leftoverTmp = readdirSync(dirname(path)).filter((name) => name.endsWith('.tmp'))
	assert.deepEqual(leftoverTmp, [])

	const daemonClaims = decodeJwtPayload(creds.daemonToken)
	assert.equal(daemonClaims.hostId, creds.daemonHostId)
})

test('startDeviceLogin: picks the org via ui.select and refreshes when the pick differs from active', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	const second: MockOrg = {
		organizationId: 'org_second',
		organizationName: 'Second Co',
		role: 'member',
		signInUrl: 'https://example.invalid/sign-in/org_second',
		domains: [],
		internalOrgId: randomUUID(),
	}
	cloud.state.orgs.push(second) // activeOrganizationId stays the first (seeded) org

	const offered: { ids: string[]; current?: string }[] = []
	const pickSecond: Pick = (orgs, current) => {
		offered.push({ ids: orgs.map((o) => o.organizationId), current: current?.organizationId })
		return orgs.find((o) => o.organizationId === second.organizationId)
	}
	const creds = await startDeviceLogin(channel, fakeUI({ pick: pickSecond }).ui)

	assert.ok(creds)
	assert.equal(creds.orgName, second.organizationName)
	assert.equal(creds.workosOrgId, second.organizationId)
	const refreshCalls = cloud.requests.filter((r) => r.path === '/rpc/api/v1/auth/token/refresh')
	assert.equal(refreshCalls.length, 1)
	assert.equal((refreshCalls[0]!.body as { organizationId?: string }).organizationId, second.organizationId)

	// Signed in to the second org now, so the next login marks it current, though its token is the first's.
	// Closing the picker ends that login and keeps the saved creds.
	assert.equal(
		await startDeviceLogin(channel, fakeUI({ pick: (orgs, current) => void pickSecond(orgs, current) }).ui),
		undefined,
	)
	const first = cloud.state.orgs[0]!.organizationId
	assert.deepEqual(offered, [
		{ ids: [first, second.organizationId], current: first },
		{ ids: [first, second.organizationId], current: second.organizationId },
	])
	assert.deepEqual(JSON.parse(readFileSync(sessionFilePath(channel), 'utf8')), creds)
	assert.equal(pendingLogin(channel), undefined)
})

test('logout ends a login at each step: the call is dropped, and no code or creds follow', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.deviceTokenHasOrgClaims = false // so the flow also calls token/refresh
	for (const route of [
		'authorize/device',
		'authenticate',
		'organizations/list',
		'token/refresh',
		'daemon/token/create',
	]) {
		cloud.fail({ route, hang: true })
		const { ui, codes } = fakeUI()
		const login = startDeviceLogin(channel, ui)
		await waitFor(`${route} to hang`, () => cloud.hung() === 1)
		await logout(channel)
		assert.equal(await login, undefined, route)
		await waitFor(`${route} to be dropped`, () => cloud.hung() === 0)
		assert.equal(codes.length, route === 'authorize/device' ? 0 : 1, route)
		assert.equal(existsSync(sessionFilePath(channel)), false, route)
		assert.equal(pendingLogin(channel), undefined, route)
	}
})

test('a login stopped while it waits on the creds lock writes nothing', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	mkdirSync(dirname(sessionLockPath(channel)), { recursive: true })
	writeFileSync(sessionLockPath(channel), '') // another process holds the lock
	const login = startDeviceLogin(channel, fakeUI().ui)
	await waitFor('the daemon token', () => cloud.requests.some((r) => r.path.endsWith('/daemon/token/create')))
	await new Promise((resolve) => setTimeout(resolve, 300)) // its reply lands; the login now waits on the lock
	abortLogin(channel)
	rmSync(sessionLockPath(channel))
	assert.equal(await login, undefined)
	assert.equal(existsSync(sessionFilePath(channel)), false)
})

test('logout while the org picker waits prevents a late choice from saving creds', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	await fetch(`${cloud.url}/__mock/config`, { method: 'POST', body: JSON.stringify({ orgs: 2 }) })
	let choose: ((org: OrgChoice) => void) | undefined
	const login = startDeviceLogin(channel, {
		...fakeUI().ui,
		pickOrg: () =>
			new Promise<OrgChoice>((resolve) => {
				choose = resolve
			}),
	})
	await waitFor('the org picker', () => choose !== undefined)
	await logout(channel)
	choose!(cloud.state.orgs[1]!)
	assert.equal(await login, undefined)
	assert.equal(existsSync(sessionFilePath(channel)), false)
	assert.equal(pendingLogin(channel), undefined)
	assert.equal(
		cloud.requests.some((r) => r.path.endsWith('/token/refresh') || r.path.endsWith('/daemon/token/create')),
		false,
	)
})

test('a user with no org gets the join-org error, not a device authentication error', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	await fetch(`${cloud.url}/__mock/config`, { method: 'POST', body: JSON.stringify({ orgs: 0 }) })
	await assert.rejects(startDeviceLogin(channel, fakeUI().ui), /you have no organization\. Create or join one/)
	assert.equal(existsSync(sessionFilePath(channel)), false)
	assert.equal(pendingLogin(channel), undefined)
})

test('startDeviceLogin: single org, device token already carries org claims -> no refresh call', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	// defaultState() is a single org with deviceTokenHasOrgClaims: true.
	const { ui } = fakeUI()

	const creds = await startDeviceLogin(channel, ui)

	assert.equal(creds?.workosOrgId, cloud.state.orgs[0]!.organizationId)
	const refreshCalls = cloud.requests.filter((r) => r.path === '/rpc/api/v1/auth/token/refresh')
	assert.equal(refreshCalls.length, 0)
})

test('startDeviceLogin: single org, device token has no org claims -> exactly one refresh call with the org_... id', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.deviceTokenHasOrgClaims = false
	const { ui } = fakeUI()

	const creds = await startDeviceLogin(channel, ui)

	assert.equal(creds?.workosOrgId, cloud.state.orgs[0]!.organizationId)
	const refreshCalls = cloud.requests.filter((r) => r.path === '/rpc/api/v1/auth/token/refresh')
	assert.equal(refreshCalls.length, 1)
	assert.equal(
		(refreshCalls[0]!.body as { organizationId?: string }).organizationId,
		cloud.state.orgs[0]!.organizationId,
	)
})

test('remintDaemonToken mints a fresh daemon token and updates the creds file', async (t) => {
	const { channel } = await setUpChannel(t)
	const { ui } = fakeUI()
	await startDeviceLogin(channel, ui)

	const newToken = await remintDaemonToken(channel)
	const saved = JSON.parse(readFileSync(sessionFilePath(channel), 'utf8')) as Creds
	assert.equal(saved.daemonToken, newToken)
	const claims = decodeJwtPayload(newToken)
	assert.equal(claims.hostId, saved.daemonHostId)
	assert.equal(await daemonToken(channel), newToken)
})

test('remintDaemonToken keeps the access token its own mint refreshed, and a token another remint saved first', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.accessTokenTtlSeconds = 30 // the mint's apiRpc refreshes and saves the access token
	const creds = await startDeviceLogin(channel, fakeUI().ui)
	assert.ok(creds)
	cloud.state.accessTokenTtlSeconds = 3600

	await remintDaemonToken(channel)
	const saved = JSON.parse(readFileSync(sessionFilePath(channel), 'utf8')) as Creds
	assert.notEqual(saved.accessToken, creds.accessToken, 'the refreshed access token is not written over')
	// The saved refresh token is the live one, so the next refresh works.
	cloud.state.force401Once.add(saved.accessToken)
	await apiRpc(channel, 'auth/user/organizations/list', {})

	const [a, b] = await Promise.all([remintDaemonToken(channel), remintDaemonToken(channel)])
	assert.equal(a, b, 'the later remint takes the token the first one saved')
	assert.equal(await daemonToken(channel), a)
})

test('withDaemonToken re-mints once when the cloud refuses the token, then retries with the new one', async (t) => {
	const { channel } = await setUpChannel(t)
	await startDeviceLogin(channel, fakeUI().ui)
	const first = await daemonToken(channel)
	const seen: string[] = []
	const out = await withDaemonToken(channel, undefined, async (token) => {
		seen.push(token)
		if (seen.length === 1) throw new RpcError('unauthorized', 401, undefined)
		return 'ok'
	})
	assert.equal(out, 'ok')
	assert.equal(seen[0], first)
	assert.notEqual(seen[1], first)
	assert.equal(await daemonToken(channel), seen[1])
})

test('withDaemonToken passes a second refusal and other errors through', async (t) => {
	const { channel } = await setUpChannel(t)
	await startDeviceLogin(channel, fakeUI().ui)
	let calls = 0
	const refused = withDaemonToken(channel, undefined, async () => {
		calls++
		throw new RpcError('forbidden', 403, 'UNAUTHORIZED')
	})
	await assert.rejects(refused, (err) => err instanceof RpcError && err.status === 403)
	assert.equal(calls, 2)

	calls = 0
	const failed = withDaemonToken(channel, undefined, async () => {
		calls++
		throw new RpcError('boom', 503, undefined)
	})
	await assert.rejects(failed, (err) => err instanceof RpcError && err.status === 503)
	assert.equal(calls, 1, 'no re-mint for an error that is not about the token')
})

test('apiRpc refreshes once and retries after a live 401 on an already-fresh token', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	const { ui } = fakeUI()
	const creds = await startDeviceLogin(channel, ui)
	assert.ok(creds)

	cloud.state.force401Once.add(creds.accessToken)
	const result = await apiRpc<{ organizations: OrgChoice[] }>(channel, 'auth/user/organizations/list', {})
	assert.equal(result.organizations.length, cloud.state.orgs.length)

	const refreshCalls = cloud.requests.filter((r) => r.path === '/rpc/api/v1/auth/token/refresh')
	assert.equal(refreshCalls.length, 1)

	const saved = JSON.parse(readFileSync(sessionFilePath(channel), 'utf8')) as Creds
	assert.notEqual(saved.accessToken, creds.accessToken)
})

test('two concurrent apiRpc calls share one token refresh under the file lock', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.accessTokenTtlSeconds = 30 // login mints a token already within the 60s threshold
	const { ui } = fakeUI()
	await startDeviceLogin(channel, ui)
	cloud.state.accessTokenTtlSeconds = 3600 // the refresh that follows mints a normal-lived token

	const [a, b] = await Promise.all([
		apiRpc<{ organizations: OrgChoice[] }>(channel, 'auth/user/organizations/list', {}),
		apiRpc<{ organizations: OrgChoice[] }>(channel, 'auth/user/organizations/list', {}),
	])
	assert.equal(a.organizations.length, 1)
	assert.equal(b.organizations.length, 1)

	// If the lock did not serialize the two refreshes, the loser would reuse an already-consumed
	// (single-use) refresh token and the mock would reject it with 400, failing this test.
	const refreshCalls = cloud.requests.filter((r) => r.path === '/rpc/api/v1/auth/token/refresh')
	assert.equal(refreshCalls.length, 1)
})

test('getPat reads HUMANLAYER_PAT once, then deletes it from process.env', (t) => {
	resetGlobalStash()
	t.after(resetGlobalStash)
	process.env.HUMANLAYER_PAT = 'hl-pat-test-value'
	t.after(() => {
		delete process.env.HUMANLAYER_PAT
	})

	assert.equal(getPat(), 'hl-pat-test-value')
	assert.equal(process.env.HUMANLAYER_PAT, undefined)
	assert.equal(getPat(), 'hl-pat-test-value') // still cached, env var already gone
})

test('identity reports the PAT source without touching the creds file', async (t) => {
	resetGlobalStash()
	t.after(resetGlobalStash)
	const home = await mkdtemp(join(tmpdir(), 'pi-hl-auth-'))
	withEnv(t, { HUMANLAYER_RIPTIDE_HOME: home })
	process.env.HUMANLAYER_PAT = 'hl-pat-test-value-2'
	t.after(() => {
		delete process.env.HUMANLAYER_PAT
	})

	assert.deepEqual(await identity(CHANNEL), { channel: CHANNEL, source: 'pat' })
})

test('daemonToken, remintDaemonToken and apiRpc throw LoginRequiredError when there are no creds and no PAT', async (t) => {
	const { channel } = await setUpChannel(t)
	await assert.rejects(() => daemonToken(channel), LoginRequiredError)
	await assert.rejects(() => remintDaemonToken(channel), LoginRequiredError)
	await assert.rejects(() => apiRpc(channel, 'auth/user/organizations/list', {}), LoginRequiredError)
})

test('a token refresh that fails with 400 raises LoginRequiredError, not a raw RpcError', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	cloud.state.accessTokenTtlSeconds = 30 // mints a token already within the 60s refresh threshold
	const { ui } = fakeUI()
	await startDeviceLogin(channel, ui)

	// auth/token/refresh is public and returns 400 BAD_REQUEST "Failed to refresh token" on any
	// failure (verified server facts); the mock's failure injection models that shape.
	await fetch(`${cloud.url}/__mock/fail`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ route: 'token/refresh', status: 400, times: 1 }),
	})

	await assert.rejects(() => apiRpc(channel, 'auth/user/organizations/list', {}), LoginRequiredError)
})

test('apiRpc in PAT mode raises LoginRequiredError, not a raw 401, when the API rejects the PAT', async (t) => {
	const { channel, cloud } = await setUpChannel(t)
	process.env.HUMANLAYER_PAT = 'hl-pat-rejected'
	t.after(() => {
		delete process.env.HUMANLAYER_PAT
	})
	cloud.state.force401Once.add('hl-pat-rejected')

	await assert.rejects(() => apiRpc(channel, 'auth/user/organizations/list', {}), LoginRequiredError)
})
