import { basename } from 'node:path'

import type * as ElectronSentry from '@sentry/electron/main'

import { resolveChannel } from './config/electron-channel'

// Set by tsup.config.ts at build time. Builds from source have none, so they report nowhere.
const dsn = process.env.RIPTIDE_ELECTRON_SENTRY_DSN || undefined
const forceEnable = process.env.SENTRY_FORCE_ENABLE_IN_LOCAL_ENV === 'true'
const sentryGlobal = globalThis as typeof globalThis & { __riptideElectronSentryInitialized?: boolean }
type SentryApi = Pick<typeof ElectronSentry, 'captureException' | 'close' | 'init' | 'setContext' | 'setUser'>
type ElectronApi = typeof import('electron')
const noOpSentry: SentryApi = {
	captureException: () => '',
	close: () => Promise.resolve(true),
	init: () => undefined,
	setContext: () => undefined,
	setUser: () => undefined,
}
const Sentry: SentryApi = process.versions.electron ? require('@sentry/electron/main') : noOpSentry
const electron: ElectronApi | undefined = process.versions.electron ? require('electron') : undefined
const productName = electron?.app.isPackaged ? basename(process.execPath) : (electron?.app.getName() ?? '')
const channel = resolveChannel({
	isPackaged: electron?.app.isPackaged ?? false,
	productName,
	environmentChannel: process.env.ELECTRON_CHANNEL,
})
const environment = process.env.SENTRY_ENVIRONMENT ?? channel

if (!sentryGlobal.__riptideElectronSentryInitialized) {
	Sentry.init({
		dsn,
		enabled: isSentryEnabled({ dsn, environment, forceEnable }),
		enableLogs: true,
		environment,
		release: process.env.SENTRY_RELEASE ?? electron?.app.getVersion(),
		sendDefaultPii: false,
		tracesSampleRate: environment === 'local' ? 1 : 0.01,
		beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === 'console' ? null : breadcrumb),
	})
	sentryGlobal.__riptideElectronSentryInitialized = true
}

export function isSentryEnabled(options: { dsn: string | undefined; environment: string; forceEnable: boolean }) {
	return options.dsn !== undefined && (options.environment !== 'local' || options.forceEnable)
}

export { Sentry }
