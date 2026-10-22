import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	ChevronsLeft,
	ChevronsRight,
	MessageSquare,
	SquareCheck,
	Trash2,
	type LucideIcon,
} from 'lucide-react'
import type { PointerEvent } from 'react'

/**
 * One legend entry: the keycap letter plus either a glyph icon or a short text
 * label describing what the key does at the keyboard-focused block.
 */
interface FocusHotkeyItem {
	key: string
	Icon?: LucideIcon
	label?: string
}

// Order mirrors the reviewer's hand position: navigation, document jumps, then
// review verdicts, comment, and undo.
const FOCUS_HOTKEYS: readonly FocusHotkeyItem[] = [
	{ key: 'j', Icon: ArrowUp },
	{ key: 'k', Icon: ArrowDown },
	{ key: 'l', Icon: ArrowRight },
	{ key: 'h', Icon: ArrowLeft },
	{ key: 'gg', label: 'top' },
	{ key: 'G', label: 'bottom' },
	{ key: 'a', Icon: SquareCheck },
	{ key: 'd', Icon: Trash2 },
	{ key: 'c', Icon: MessageSquare },
	{ key: 'z', label: 'undo' },
]

const stopPointerEvent = (event: PointerEvent<HTMLElement>) => event.stopPropagation()

/**
 * A small legend that rides the reading column's right margin,
 * vertically centred on the keyboard-focused block, to remind the reader what the
 * review keys do without ever covering the text they are on. Rendered inside the
 * `.artifact-viewer-v2-markdown` wrapper so it can anchor to the focused block via
 * the same CSS anchor the focus rail uses. The shortcut list is decorative, while
 * the toggle remains available to pointer and keyboard users.
 */
export function ArtifactFocusHotkeyLegend({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
	const toggleLabel = collapsed ? 'Show artifact review shortcuts (x)' : 'Collapse artifact review shortcuts (x)'

	return (
		<div
			data-artifact-focus-hotkey-rail
			className="artifact-viewer-v2-focus-hotkeys"
			onPointerMove={stopPointerEvent}
			onPointerDown={stopPointerEvent}
			onClick={(event) => event.stopPropagation()}
		>
			{collapsed ? (
				<button
					type="button"
					className="artifact-viewer-v2-focus-hotkey-toggle artifact-viewer-v2-focus-hotkey-toggle-collapsed"
					aria-label={toggleLabel}
					title={toggleLabel}
					onClick={onToggle}
				>
					<ChevronsLeft aria-hidden="true" className="artifact-viewer-v2-focus-hotkey-icon" />
				</button>
			) : (
				<>
					<div aria-hidden="true" className="contents">
						{FOCUS_HOTKEYS.map((item) => (
							<div key={item.key} className="artifact-viewer-v2-focus-hotkey">
								<kbd className="artifact-viewer-v2-focus-hotkey-key">{item.key}</kbd>
								{item.Icon ? (
									<item.Icon className="artifact-viewer-v2-focus-hotkey-icon" />
								) : (
									<span className="artifact-viewer-v2-focus-hotkey-label">{item.label}</span>
								)}
							</div>
						))}
					</div>
					<button
						type="button"
						className="artifact-viewer-v2-focus-hotkey artifact-viewer-v2-focus-hotkey-toggle"
						aria-label={toggleLabel}
						title={toggleLabel}
						onClick={onToggle}
					>
						<kbd aria-hidden="true" className="artifact-viewer-v2-focus-hotkey-key">x</kbd>
						<ChevronsRight aria-hidden="true" className="artifact-viewer-v2-focus-hotkey-icon" />
					</button>
				</>
			)}
		</div>
	)
}
