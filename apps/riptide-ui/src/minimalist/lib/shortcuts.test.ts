import { describe, expect, it } from 'vitest'

import { matchShortcut, shortcutHint } from '@/minimalist/lib/shortcuts'

const press = (key: string, code: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) =>
	matchShortcut({
		key,
		code,
		metaKey: !mods.ctrl,
		ctrlKey: !!mods.ctrl,
		shiftKey: !!mods.shift,
		altKey: !!mods.alt,
	})

describe('matchShortcut', () => {
	it('tells shortcuts on the same key apart by their modifiers', () => {
		expect(press('b', 'KeyB')?.id).toBe('sidebar')
		expect(press('∫', 'KeyB', { alt: true })?.id).toBe('panel')
		expect(press('[', 'BracketLeft')?.id).toBe('back')
		expect(press('{', 'BracketLeft', { shift: true })?.id).toBe('previous-tab')
		expect(press('“', 'BracketLeft', { alt: true })?.id).toBe('previous-task')
		expect(press('}', 'BracketRight', { shift: true })?.id).toBe('next-tab')
		expect(press('‘', 'BracketRight', { alt: true })?.id).toBe('next-task')
		expect(press(']', 'BracketRight')?.id).toBe('forward')
		expect(press('A', 'KeyA', { shift: true })?.id).toBe('archive')
		expect(press('å', 'KeyA', { alt: true })?.id).toBe('next-attention')
		expect(press('k', 'KeyK', { ctrl: true })?.id).toBe('search')
		expect(press('j', 'KeyJ')?.id).toBe('terminal')
	})

	it('keeps tab digits separate from recent-task digits', () => {
		expect(press('£', 'Digit3', { alt: true })).toEqual({ id: 'recent', digit: 3 })
		expect(press('ª', 'Digit9', { alt: true })).toBeNull()
		expect(press('3', 'Digit3')).toEqual({ id: 'tab', digit: 3 })
		expect(press('0', 'Digit0')).toBeNull()
		expect(press('3', 'Numpad3')).toBeNull()
		expect(press('#', 'Digit3', { shift: true })).toBeNull()
	})

	it.each(Array.from({ length: 9 }, (_, index) => index + 1))('matches tab %i with either app modifier', (digit) => {
		expect(press(String(digit), `Digit${digit}`)).toEqual({ id: 'tab', digit })
		expect(press(String(digit), `Digit${digit}`, { ctrl: true })).toEqual({ id: 'tab', digit })
	})

	it.each([false, true])('matches create and close tab with Ctrl=%s', (ctrl) => {
		expect(press('t', 'KeyT', { ctrl })).toEqual({ id: 'new-tab', digit: 0 })
		expect(press('w', 'KeyW', { ctrl })).toEqual({ id: 'close-tab', digit: 0 })
		expect(press('T', 'KeyT', { ctrl, shift: true })).toBeNull()
		expect(press('†', 'KeyT', { ctrl, alt: true })).toBeNull()
	})

	it('matches Ctrl+Tab and Ctrl+Shift+Tab, but not plain, Meta, or Alt+Tab', () => {
		expect(press('Tab', 'Tab', { ctrl: true })).toEqual({ id: 'next-tab', digit: 0 })
		expect(press('Tab', 'Tab', { ctrl: true, shift: true })).toEqual({ id: 'previous-tab', digit: 0 })
		expect(press('Tab', 'Tab')).toBeNull()
		expect(press('Tab', 'Tab', { ctrl: true, alt: true })).toBeNull()
		expect(
			matchShortcut({ key: 'Tab', code: 'Tab', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
		).toBeNull()
	})

	it('ignores keys without ⌘ or Ctrl, and unbound keys', () => {
		expect(
			matchShortcut({ key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }),
		).toBeNull()
		expect(press('n', 'KeyN', { shift: true })).toBeNull()
		expect(press('q', 'KeyQ')).toBeNull()
	})
})

describe('shortcutHint', () => {
	it('drops the spaces', () => {
		expect(shortcutHint('archive')).toBe('⇧⌘A')
		expect(shortcutHint('settings')).toBe('⌘,')
	})

	it('lists the tab bindings and the separate task-navigation bindings', () => {
		expect(shortcutHint('new-tab')).toBe('⌘T')
		expect(shortcutHint('close-tab')).toBe('⌘W')
		expect(shortcutHint('tab')).toBe('⌘1–9')
		expect(shortcutHint('previous-tab')).toBe('⇧⌘[')
		expect(shortcutHint('next-tab')).toBe('⇧⌘]')
		expect(shortcutHint('previous-task')).toBe('⌥⌘[')
		expect(shortcutHint('next-task')).toBe('⌥⌘]')
	})
})
