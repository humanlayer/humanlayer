import * as Data from 'effect/Data'

export class ElectronPlatformError extends Data.TaggedError('ElectronPlatformError')<{
	readonly operation:
		| 'configure_before_ready'
		| 'wait_until_ready'
		| 'set_application_icon'
		| 'request_single_instance_lock'
		| 'quit_application'
		| 'resolve_window_state'
		| 'open_window'
		| 'set_window_theme'
		| 'set_zoom'
		| 'show_and_focus_window'
		| 'destroy_window'
		| 'drag_window'
	readonly cause: unknown
}> {}
