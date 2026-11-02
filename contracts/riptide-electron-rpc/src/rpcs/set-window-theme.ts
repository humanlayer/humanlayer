import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

// 'system' hands the choice back to the OS, so the renderer's prefers-color-scheme follows it again.
export const WindowTheme = Schema.Union([Schema.Literal('light'), Schema.Literal('dark'), Schema.Literal('system')])
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
