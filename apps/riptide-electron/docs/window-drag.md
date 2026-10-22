# Electron tab window dragging

`DragWindow` is one cancellable unary RPC. The requester is bound to its actual
window by the message-port attachment; the renderer supplies neither window IDs
nor coordinates. Other window controls are unchanged.

## Native lifetime and timing

- Construct `makeWindowDrag` once per BrowserWindow, before serving RPCs. Its
  native `before-mouse-event` listener tracks primary-left presses independently
  of the renderer and RPC lifetime.
- Native mouseDown captures the cursor and window anchor in screen DIP. A delayed
  renderer pointerdown can use that anchor only while the native press is live.
  MouseUp before the RPC starts makes the request unavailable, not a late drag.
- An accepted request samples immediately, then every 16 ms. Movement starts at
  4 DIP; repeated positions are skipped. Native mouseUp applies one synchronous
  final sample before completing, including movement entirely between timer ticks.
- Cancellation, blur, navigation, renderer crash, maximization and fullscreen
  entry stop without a final movement. The same press cannot restart a cancelled
  gesture. A new native mouseDown is required.
- Tracking listeners survive individual requests and renderer reloads. Window
  close or WebContents destruction removes all of them and cancels any gesture.
  There is at most one active gesture per window.

The renderer still owns eligible-target filtering, pointer capture, and cleanup
on release/cancel/lost capture/blur/unmount. Native events here are page mouse
events, not an OS-wide input hook. Native Wayland remains unsupported.

## Verification

From `apps/riptide-electron`, run `bun run test` and `bun --bun run typecheck`.
The native adapter tests cover delayed starts, between-tick releases, cancellation,
and tracker destruction. The two-requester transport test exercises the real RPC
attachment path, including stale-start rejection and cancellation across ports.

Live UI verification remains necessary: test quick drags, delayed renderer events,
release outside the tab, interactive tab controls, multiple windows, and native
window/renderer teardown. The automated native seam uses recording SDK handles;
it does not simulate the operating system's input delivery.
