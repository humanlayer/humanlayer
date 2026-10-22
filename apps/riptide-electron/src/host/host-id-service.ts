import { HostIdPersistenceError } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

export interface HostIdServiceShape {
	readonly get: Effect.Effect<string, HostIdPersistenceError>
}

export class HostIdService extends Context.Service<HostIdService, HostIdServiceShape>()('HostIdService') {}
