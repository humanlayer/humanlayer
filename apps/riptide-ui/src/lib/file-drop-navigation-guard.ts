import { activeViewportFileDropHandler } from '@/lib/viewport-file-drop'

// A file dropped on a page that does not handle the drop is navigated to, which
// replaces the whole app with the file. This guards DOM-based drop transports.
//
// Every drop zone stops propagation, so a drag that reaches the window is by
// definition unhandled: cancel it when it carries something the webview would
// navigate to. Plain text keeps its default, so text can still be dragged into
// inputs and the editor.
//
// The payload is named differently per engine. A file dragged from Finder
// reports `Files`, while the same drag into WebKitGTK reports only
// `text/uri-list` — measured in the Linux dev app, where a `Files`-only check
// never fired once. `text/uri-list` also covers a link dragged in from another
// window, which replaces the app just as a file does.
const NAVIGATING_DRAG_TYPES = ['Files', 'text/uri-list', 'application/x-moz-file']

let guardInstalled = false

function isNavigatingDrag(event: DragEvent): boolean {
	const types = event.dataTransfer?.types
	if (!types) return false
	return NAVIGATING_DRAG_TYPES.some((type) => types.includes(type))
}

function blockUnhandledNavigatingDrag(event: DragEvent): void {
	if (!isNavigatingDrag(event)) return
	// A surface that can take the file owns the whole viewport while it is
	// mounted, and accepts the drop itself.
	if (activeViewportFileDropHandler()) return
	// `dragover` must be cancelled too: without it the browser never fires
	// `drop` on the window and navigates instead.
	event.preventDefault()
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

export function installFileDropNavigationGuard(): void {
	if (guardInstalled) return
	guardInstalled = true
	window.addEventListener('dragover', blockUnhandledNavigatingDrag)
	window.addEventListener('drop', blockUnhandledNavigatingDrag)
}

export function uninstallFileDropNavigationGuard(): void {
	if (!guardInstalled) return
	guardInstalled = false
	window.removeEventListener('dragover', blockUnhandledNavigatingDrag)
	window.removeEventListener('drop', blockUnhandledNavigatingDrag)
}
