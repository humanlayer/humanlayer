import assert from 'node:assert/strict'
import { test } from 'node:test'

import { channelsDefine, getChannelConfig, parseChannels, requireClientId } from '@humanlayer/session-sdk-base'

const built = parseChannels(
	JSON.stringify({
		prod: {
			api: 'https://api.example',
			sync: 'https://sync.example',
			app: 'https://app.example',
			clientId: 'client_x',
		},
	}),
)

test('a build from source reaches no cloud', () => {
	assert.throws(() => getChannelConfig('prod', {}, {}), /prod channel isn't configured in this build/)
	assert.throws(() => requireClientId(getChannelConfig('local', {}, {})), /Set HUMANLAYER_WORKOS_CLIENT_ID\./)
})

test('the build table supplies origins and client id', () => {
	assert.deepEqual(getChannelConfig('prod', {}, built), {
		channel: 'prod',
		api: 'https://api.example',
		sync: 'https://sync.example',
		app: 'https://app.example',
		workos: 'https://api.workos.com',
		clientId: 'client_x',
	})
})

test('env overrides reach a self-hosted cloud', () => {
	const config = getChannelConfig(
		'prod',
		{
			HUMANLAYER_API_URL: 'https://api.self',
			HUMANLAYER_SYNC_URL: 'https://sync.self',
			HUMANLAYER_APP_URL: 'https://app.self',
			HUMANLAYER_WORKOS_CLIENT_ID: 'client_self',
		},
		{},
	)
	assert.equal(config.api, 'https://api.self')
	assert.equal(config.clientId, 'client_self')
})

test('channelsDefine bakes the table in and rejects bad ones', () => {
	assert.deepEqual(channelsDefine(undefined), { 'process.env.HUMANLAYER_CHANNELS': '""' })
	assert.throws(() => channelsDefine('{"staging":{}}'), /unknown channel "staging"/)
})
