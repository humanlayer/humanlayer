import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const AppVersion = Schema.String
export type AppVersion = typeof AppVersion.Type

export class GetAppVersion extends Rpc.make('GetAppVersion', {
	success: AppVersion,
}) {}
