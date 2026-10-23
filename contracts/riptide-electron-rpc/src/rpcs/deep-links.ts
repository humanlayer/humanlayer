import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const DesktopDeepLink = Schema.Struct({ url: Schema.String })
export type DesktopDeepLink = typeof DesktopDeepLink.Type

export class TakePendingDeepLink extends Rpc.make('TakePendingDeepLink', {
	success: Schema.NullOr(DesktopDeepLink),
}) {}

export class DeepLinkEvents extends Rpc.make('DeepLinkEvents', {
	success: DesktopDeepLink,
	stream: true,
}) {}
