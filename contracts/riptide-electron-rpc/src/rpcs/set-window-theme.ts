import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const WindowTheme = Schema.Union([Schema.Literal('light'), Schema.Literal('dark')])
export type WindowTheme = typeof WindowTheme.Type

export const SetWindowThemePayload = Schema.Struct({ theme: WindowTheme })
export type SetWindowThemePayload = typeof SetWindowThemePayload.Type

export class WindowThemeSetError extends Schema.TaggedError<WindowThemeSetError>()('WindowThemeSetError', {
	message: Schema.String,
}) {}

export class SetWindowTheme extends Rpc.make('SetWindowTheme', {
	payload: SetWindowThemePayload,
	success: Schema.Void,
	error: WindowThemeSetError,
}) {}
