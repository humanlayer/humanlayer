// The host heartbeat (plan-part-2.md phase 3): a bound session keeps its host online in the web
// app, marked so the app offers no launches there, and never shuts the host down.

import assert from 'node:assert/strict'
import test from 'node:test'

import { fauxAssistantMessage } from '@earendil-works/pi-ai'

import { setUp, waitFor } from './helpers/harness.ts'
import type { MockCloud, RecordedRequest } from './helpers/mock-cloud.ts'

function beats(cloud: MockCloud): RecordedRequest[] {
	return cloud.requests.filter((r) => r.path === '/rpc/daemon/v1/hosts/heartbeat')
}

test('a bound session beats as its host, marked attachedSessionsOnly, until /humanlayer off', async (t) => {
	const { cloud, open } = await setUp(t, 'pat', { HUMANLAYER_PI_HEARTBEAT_MS: '20' })
	const s = await open()
	s.faux.setResponses([fauxAssistantMessage('hi')])

	await s.session.prompt('hello')
	await waitFor('three beats', () => beats(cloud).length >= 3)

	const session = cloud.sessions()[0]
	for (const beat of beats(cloud)) {
		assert.equal(beat.status, 200)
		assert.deepEqual(beat.body, {
			hostId: session?.hostId,
			hostName: (beat.body as { hostName: string }).hostName,
			capabilities: ['attachedSessionsOnly', 'agent:pi'],
			canSelfUpdate: false,
		})
	}

	await s.runCommand('/humanlayer off')
	const after = beats(cloud).length
	await new Promise((r) => setTimeout(r, 100))
	assert.ok(beats(cloud).length <= after + 1, 'at most the beat in flight lands after off')

	await s.shutdown()
	assert.equal(cloud.requests.filter((r) => r.path.endsWith('/hosts/shutdown')).length, 0)
})

test('an unbound session does not beat', async (t) => {
	const { cloud, open } = await setUp(t, 'pat', { HUMANLAYER_PI_HEARTBEAT_MS: '20' })
	await open()
	await new Promise((r) => setTimeout(r, 100))
	assert.equal(beats(cloud).length, 0)
})

test('a 401 re-mints the daemon token and the next beat succeeds; a 5xx keeps beating', async (t) => {
	const { cloud, open } = await setUp(t, 'pat', { HUMANLAYER_PI_HEARTBEAT_MS: '20' })
	const s = await open()
	cloud.fail({ route: 'hosts/heartbeat', status: 401, code: 'UNAUTHORIZED' })
	s.faux.setResponses([fauxAssistantMessage('hi')])

	await s.session.prompt('hello')
	await waitFor('a good beat after the 401', () => beats(cloud).some((r) => r.status === 200))
	assert.deepEqual(
		beats(cloud)
			.slice(0, 2)
			.map((r) => r.status),
		[401, 200],
	)
	const mints = cloud.requests.filter((r) => r.path.endsWith('/auth/daemon/token/create'))
	assert.ok(mints.length >= 2, 'the 401 minted a new daemon token')

	cloud.fail({ route: 'hosts/heartbeat', status: 500, times: 2 })
	const before = beats(cloud).length
	await waitFor('beats past the 5xx', () =>
		beats(cloud)
			.slice(before)
			.some((r) => r.status === 200),
	)
	assert.deepEqual(
		beats(cloud)
			.slice(before, before + 3)
			.map((r) => r.status),
		[500, 500, 200],
	)
})
