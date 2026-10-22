// Credentials: the PAT or the saved device login, the access token kept fresh, and the daemon
// token. @humanlayer/session-sdk-auth does the work; pi keeps its files in its own folder.

import { createDeviceLogin, createSessionClient } from '@humanlayer/session-sdk-auth'

import { log, piDir } from './config.ts'

export type { Creds, Identity } from '@humanlayer/session-sdk-auth'

// The scrubbed PAT (and its derived daemon tokens) survive /reload on globalThis, under this key.
export const client = createSessionClient({
	dir: piDir,
	log,
	loginHint: 'Run /humanlayer login',
	stashKey: 'humanlayer.pi.v1',
})

export const login = createDeviceLogin(client, { noBrowser: () => process.env.HUMANLAYER_PI_NO_BROWSER === '1' })

export const { apiRpc, daemonOrgId, daemonToken, getPat, hostId, identity, remintDaemonToken, withDaemonToken } = client
