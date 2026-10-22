import { ConsoleTransport, Logger, type LogTransport } from '@humanlayer/logger/browser'

import { NativeLogTransport } from './native-log-transport'
import { isDesktop } from './utils'

const transports: [LogTransport, ...LogTransport[]] = [new ConsoleTransport('debug')]

if (isDesktop()) {
	transports.push(new NativeLogTransport('debug'))
}

export const logger = new Logger({
	transports,
	properties: {},
})
