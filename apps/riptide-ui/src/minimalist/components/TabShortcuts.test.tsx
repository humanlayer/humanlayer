import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { actions, tabState } = vi.hoisted(() => {
	const actions = {
		createTab: vi.fn(),
		closeTab: vi.fn(),
		selectTab: vi.fn(),
		selectAdjacentTab: vi.fn(),
	}
	return {
		actions,
		tabState: {
			isAvailable: true,
			selectedTabId: 'tab-3' as string | null,
			tabs: Array.from({ length: 9 }, (_, index) => ({ id: `tab-${index + 1}`, href: '/' })),
		},
	}
})

// Mock only tab actions. Keyboard registration, platform resolution, scopes, and event guards are real.
vi.mock('@/minimalist/lib/tabs', () => ({ useMinimalistTabs: () => ({ ...actions, ...tabState }) }))
vi.mock('./TabStrip', () => ({ TabStrip: () => <div data-testid="tab-strip" /> }))
vi.mock('./UpdateNotices', () => ({ WiredUpdateNotices: () => null }))
vi.mock('./BetaBanner', () => ({ BetaBanner: () => null }))

let HotkeysProvider: typeof import('@humanlayer/react-hotkeys-hook').HotkeysProvider

function Wrapper({ children }: { children: ReactNode }) {
	// Match AuthenticatedProviders, which keeps the global and root scopes active for minimalist routes.
	return <HotkeysProvider initiallyActiveScopes={['*', '.']}>{children}</HotkeysProvider>
}

function press(target: HTMLElement, init: KeyboardEventInit) {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
	fireEvent(target, event)
	fireEvent.keyUp(target, init)
	return event
}

function expectNoActions() {
	for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled()
}

describe.each(['MacIntel', 'Win32'])('TabShortcuts on %s', (platform) => {
	let TabShortcuts: ComponentType
	const mod = platform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true }
	const otherMod = platform === 'MacIntel' ? { ctrlKey: true } : { metaKey: true }

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
		// The catalog resolves its platform at import time, so reload it and its provider together.
		vi.resetModules()
		HotkeysProvider = (await import('@humanlayer/react-hotkeys-hook')).HotkeysProvider
		TabShortcuts = (await import('./TabShortcuts')).TabShortcuts
		tabState.isAvailable = true
		tabState.selectedTabId = 'tab-3'
		tabState.tabs = Array.from({ length: 9 }, (_, index) => ({ id: `tab-${index + 1}`, href: '/' }))
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		fireEvent.blur(window)
	})

	it.each(['body', 'input', 'textarea', 'select', 'contenteditable', 'menuitem'])(
		'handles global app tab keys with %s focus outside the main pane',
		async (focus) => {
			const { useFocusStore } = await import('@/hooks/stores/focusStore')
			useFocusStore.setState({ focusedArea: 'RIGHT_PANE' })
			render(
				<>
					<TabShortcuts />
					<input data-testid="input" />
					<textarea data-testid="textarea" />
					<select data-testid="select">
						<option>Task</option>
					</select>
					<div contentEditable tabIndex={0} data-testid="contenteditable" />
					<button type="button" role="menuitem" data-testid="menuitem">
						Settings
					</button>
				</>,
				{ wrapper: Wrapper },
			)
			const target = focus === 'body' ? document.body : screen.getByTestId(focus)
			// JSDOM does not expose the browser's isContentEditable property.
			if (focus === 'contenteditable') Object.defineProperty(target, 'isContentEditable', { value: true })
			target.focus()
			expect(document.activeElement).toBe(target)
			for (const init of [
				{ key: 't', code: 'KeyT', ...mod },
				{ key: 'w', code: 'KeyW', ...mod },
				{ key: '3', code: 'Digit3', ...mod },
				{ key: 'Tab', code: 'Tab', ctrlKey: true },
				{ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true },
			])
				expect(press(target, init).defaultPrevented).toBe(true)
			// A global dispatch still works while an editor owns DOM focus.
			expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(true)
			expect(actions.createTab).toHaveBeenCalledTimes(2)
			expect(actions.closeTab).toHaveBeenCalledExactlyOnceWith('tab-3')
			expect(actions.selectTab).toHaveBeenCalledExactlyOnceWith('tab-3')
			expect(actions.selectAdjacentTab.mock.calls).toEqual([[1], [-1]])
		},
	)

	it.each(Array.from({ length: 9 }, (_, index) => index + 1))('selects tab %i by its current index', (digit) => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key: String(digit), code: `Digit${digit}`, ...mod }).defaultPrevented).toBe(true)
		expect(actions.selectTab).toHaveBeenCalledExactlyOnceWith(`tab-${digit}`)
	})

	it('uses the physical digit on keyboard layouts with symbols on the number row', () => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key: '&', code: 'Digit1', ...mod }).defaultPrevented).toBe(true)
		expect(actions.selectTab).toHaveBeenCalledExactlyOnceWith('tab-1')
	})

	it('does not select a missing tab or map 9 to the last tab', () => {
		tabState.tabs = tabState.tabs.slice(0, 2)
		render(<TabShortcuts />, { wrapper: Wrapper })
		for (const digit of [3, 9]) {
			expect(press(document.body, { key: String(digit), code: `Digit${digit}`, ...mod }).defaultPrevented).toBe(
				true,
			)
		}
		expect(actions.selectTab).not.toHaveBeenCalled()
	})

	it('uses the latest selected tab and order after rendering again', () => {
		const view = render(<TabShortcuts />, { wrapper: Wrapper })
		tabState.selectedTabId = 'tab-7'
		tabState.tabs = [...tabState.tabs].reverse()
		view.rerender(<TabShortcuts />)
		press(document.body, { key: 'w', code: 'KeyW', ...mod })
		press(document.body, { key: '1', code: 'Digit1', ...mod })
		expect(actions.closeTab).toHaveBeenCalledExactlyOnceWith('tab-7')
		expect(actions.selectTab).toHaveBeenCalledExactlyOnceWith('tab-9')
	})

	it('does not close anything without a selected tab', () => {
		tabState.selectedTabId = null
		render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key: 'w', code: 'KeyW', ...mod }).defaultPrevented).toBe(true)
		expectNoActions()
	})

	it.each([
		['[', 'BracketLeft', -1],
		[']', 'BracketRight', 1],
	] as const)('matches the catalog binding for mod+Shift+%s', (key, code, direction) => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key, code, shiftKey: true, ...mod }).defaultPrevented).toBe(true)
		expect(actions.selectAdjacentTab).toHaveBeenCalledExactlyOnceWith(direction)
	})

	it.each([
		['{', 'BracketLeft', -1],
		['}', 'BracketRight', 1],
	] as const)('handles the real shifted bracket event %s', (key, code, direction) => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key, code, shiftKey: true, ...mod }).defaultPrevented).toBe(true)
		expect(actions.selectAdjacentTab).toHaveBeenCalledExactlyOnceWith(direction)
	})

	it.each([{ repeat: true }, { isComposing: true }])('leaves ignored key events alone: %j', (ignored) => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		for (const init of [
			{ key: 't', code: 'KeyT', ...mod },
			{ key: 'w', code: 'KeyW', ...mod },
			{ key: '1', code: 'Digit1', ...mod },
			{ key: 'Tab', code: 'Tab', ctrlKey: true },
			{ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true },
			{ key: '[', code: 'BracketLeft', shiftKey: true, ...mod },
			{ key: ']', code: 'BracketRight', shiftKey: true, ...mod },
		])
			expect(press(document.body, { ...init, ...ignored }).defaultPrevented).toBe(false)
		expectNoActions()
	})

	it('ignores tab keys that another control has already prevented', () => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		for (const init of [
			{ key: 't', code: 'KeyT', ...mod },
			{ key: 'w', code: 'KeyW', ...mod },
			{ key: '1', code: 'Digit1', ...mod },
			{ key: 'Tab', code: 'Tab', ctrlKey: true },
			{ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true },
			{ key: '{', code: 'BracketLeft', shiftKey: true, ...mod },
			{ key: '}', code: 'BracketRight', shiftKey: true, ...mod },
		]) {
			const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
			event.preventDefault()
			fireEvent(document.body, event)
			fireEvent.keyUp(document.body, init)
			expect(event.defaultPrevented).toBe(true)
		}
		expectNoActions()
	})

	it('does not select a tab when the search palette consumes its digit shortcut', () => {
		const pickSearchResult = vi.fn()
		render(
			<>
				<TabShortcuts />
				<input
					aria-label="Search tasks"
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === '1') {
							event.preventDefault()
							pickSearchResult()
						}
					}}
				/>
			</>,
			{ wrapper: Wrapper },
		)
		const input = screen.getByRole('textbox', { name: 'Search tasks' })
		input.focus()
		expect(press(input, { key: '1', code: 'Digit1', ...mod }).defaultPrevented).toBe(true)
		expect(pickSearchResult).toHaveBeenCalledOnce()
		expectNoActions()
	})

	it('leaves browser shortcuts and defaults untouched when desktop tabs are unavailable', () => {
		tabState.isAvailable = false
		render(<TabShortcuts />, { wrapper: Wrapper })
		for (const init of [
			{ key: 't', code: 'KeyT', ...mod },
			{ key: 'w', code: 'KeyW', ...mod },
			{ key: '9', code: 'Digit9', ...mod },
			{ key: 'Tab', code: 'Tab', ctrlKey: true },
			{ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true },
			{ key: '[', code: 'BracketLeft', shiftKey: true, ...mod },
			{ key: ']', code: 'BracketRight', shiftKey: true, ...mod },
		])
			expect(press(document.body, init).defaultPrevented).toBe(false)
		expectNoActions()
	})

	it('updates availability without leaving a stale active registration', () => {
		tabState.isAvailable = false
		const view = render(<TabShortcuts />, { wrapper: Wrapper })
		expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(false)
		tabState.isAvailable = true
		view.rerender(<TabShortcuts />)
		expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(true)
		tabState.isAvailable = false
		view.rerender(<TabShortcuts />)
		expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(false)
		expect(actions.createTab).toHaveBeenCalledOnce()
	})

	it('leaves plain keys, the other platform modifier, and extra modifiers alone', () => {
		render(<TabShortcuts />, { wrapper: Wrapper })
		for (const init of [
			{ key: 't', code: 'KeyT' },
			{ key: 'w', code: 'KeyW', ...otherMod },
			{ key: '0', code: 'Digit0', ...mod },
			{ key: 'T', code: 'KeyT', shiftKey: true, ...mod },
			{ key: 't', code: 'KeyT', altKey: true, ...mod },
			{ key: 'Tab', code: 'Tab' },
			{ key: 'Tab', code: 'Tab', altKey: true, ctrlKey: true },
		])
			expect(press(document.body, init).defaultPrevented).toBe(false)
		expectNoActions()
	})

	it('keeps working after the standard UI swaps the wildcard scope for its own', async () => {
		// Standard pages enable named scopes, which drops '*'. Switching to the minimalist UI in the same window keeps that.
		const { useHotkeysContext } = await import('@humanlayer/react-hotkeys-hook')
		function EnableRootScope() {
			const { enableScope } = useHotkeysContext()
			return (
				<button type="button" onClick={() => enableScope('root')}>
					Enable root scope
				</button>
			)
		}
		render(
			<>
				<EnableRootScope />
				<TabShortcuts />
			</>,
			{ wrapper: Wrapper },
		)
		fireEvent.click(screen.getByRole('button', { name: 'Enable root scope' }))
		expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(true)
		expect(actions.createTab).toHaveBeenCalledOnce()
	})

	it('removes its key listeners on unmount', () => {
		const view = render(<TabShortcuts />, { wrapper: Wrapper })
		view.unmount()
		expect(press(document.body, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(false)
		expectNoActions()
	})

	it('mounts the strip and real shortcuts in the frame, including settings without AppShell', async () => {
		vi.stubGlobal('matchMedia', () => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}))
		const { default: MinimalistFrame } = await import('../MinimalistFrame')
		render(
			<MinimalistFrame>
				<main aria-label="Settings">
					<input aria-label="Search settings" />
				</main>
			</MinimalistFrame>,
			{ wrapper: Wrapper },
		)
		const strip = screen.getByTestId('tab-strip')
		const settings = screen.getByRole('main', { name: 'Settings' })
		expect(strip.closest('.minimalist-frame')).toBe(settings.closest('.minimalist-frame'))
		expect(strip.closest('.minimalist-content')).toBeNull()
		const input = screen.getByRole('textbox', { name: 'Search settings' })
		input.focus()
		expect(press(input, { key: 't', code: 'KeyT', ...mod }).defaultPrevented).toBe(true)
		expect(actions.createTab).toHaveBeenCalledOnce()
	})
})
