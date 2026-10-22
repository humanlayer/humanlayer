/**
 * Dev-only overlay that mimics the macOS traffic lights at the position they
 * occupy in the Tauri overlay-titlebar window. Rendered when the
 * `forceTauriChrome` dev flag is set in a plain browser (see lib/tauri-chrome),
 * so screenshots show how the layout clears the real window controls.
 *
 * Geometry mirrors what the `trafficLightPosition` pinned in tauri.conf.json
 * ({x: 16, y: 21}) produces in the real app: measured against native
 * screenshots, macOS renders the dot centers about 2.5px above the configured
 * y, so the dots (12px, 8px gaps) center on ~y=18 — the centerline of the
 * 36px breadcrumb row that hosts them when the sidebar is collapsed.
 */
export function FakeMacTrafficLights() {
	return (
		<div aria-hidden className="pointer-events-none fixed left-4 top-3 z-[9999] flex items-center gap-2">
			<span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
			<span className="h-3 w-3 rounded-full bg-[#febc2e]" />
			<span className="h-3 w-3 rounded-full bg-[#28c840]" />
		</div>
	)
}
