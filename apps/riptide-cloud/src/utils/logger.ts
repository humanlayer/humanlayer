import { ConsoleTransport, Logger } from '@humanlayer/logger/browser'

export const logger = new Logger({
	transports: [new ConsoleTransport('debug')],
	properties: {},
})
