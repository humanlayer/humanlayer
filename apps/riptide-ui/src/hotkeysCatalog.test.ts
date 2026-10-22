import { describe, expect, it } from 'vitest'

import { resolvePlatformModifier } from '@/hooks/hotkeys/platform-hotkeys'
import {
	buildHotkeyHelpGroups,
	hotkeysCatalog,
	resolveKeybindingDisplays,
	type ShortcutDisplay,
	shortcutKeycaps,
} from '@/hotkeysCatalog'

const findShortcut = (
	groups: ReturnType<typeof buildHotkeyHelpGroups>,
	groupLabel: string,
	shortcutLabel: string,
): ShortcutDisplay => {
	const group = groups.find((candidate) => candidate.label === groupLabel)
	if (!group) throw new Error(`missing group ${groupLabel}`)
	const shortcut = group.shortcuts.find((candidate) => candidate.label === shortcutLabel)
	if (!shortcut) throw new Error(`missing shortcut ${shortcutLabel} in ${groupLabel}`)
	return shortcut.display
}

describe('resolveKeybindingDisplays', () => {
	it('shows plain keycaps on both platforms for the plain bindings', () => {
		const displays = resolveKeybindingDisplays({ archiveKeybinding: 'e', sendMessageKeybinding: 'enter' })
		expect(displays.archive).toEqual({ mac: { combination: ['E'] }, nonMac: { combination: ['E'] } })
		expect(displays.sendMessage).toEqual({
			mac: { combination: ['Enter'] },
			nonMac: { combination: ['Enter'] },
		})
	})

	it('shows the platform modifier for the mod bindings', () => {
		const displays = resolveKeybindingDisplays({
			archiveKeybinding: 'mod+e',
			sendMessageKeybinding: 'mod+enter',
		})
		expect(displays.archive).toEqual({
			mac: { combination: ['⌘', 'E'] },
			nonMac: { combination: ['Ctrl', 'E'] },
		})
		expect(displays.sendMessage).toEqual({
			mac: { combination: ['⌘', 'Enter'] },
			nonMac: { combination: ['Ctrl', 'Enter'] },
		})
	})
})

describe('horizontal tab shortcuts', () => {
	it.each([
		['previousHorizontalTab', '[', 'ctrl+shift+tab', ['Ctrl', '⇧', 'Tab']],
		['nextHorizontalTab', ']', 'ctrl+tab', ['Ctrl', 'Tab']],
	] as const)('adds a Control-Tab alias to %s', (name, bracket, alias, keycaps) => {
		const shortcut = hotkeysCatalog.global.shortcuts[name]
		expect(shortcut.reactHotkeys.split(',')).toEqual([resolvePlatformModifier(`mod+shift+${bracket}`), alias])
		expect(shortcut.desktopOnly).toBe(true)
		expect(shortcut.display.mac).toEqual({ alternatives: [['⌘', '⇧', bracket], keycaps] })
		expect(shortcut.display.nonMac).toEqual({ alternatives: [['Ctrl', '⇧', bracket], keycaps] })
	})
})

describe('shortcutKeycaps', () => {
	const displays = resolveKeybindingDisplays({
		archiveKeybinding: 'mod+e',
		sendMessageKeybinding: 'mod+enter',
	})

	it('returns the Apple combination for mac', () => {
		expect(shortcutKeycaps(displays.archive, 'mac')).toEqual(['⌘', 'E'])
	})

	it('returns the Ctrl combination for non-mac', () => {
		expect(shortcutKeycaps(displays.archive, 'nonMac')).toEqual(['Ctrl', 'E'])
	})
})

describe('buildHotkeyHelpGroups', () => {
	const modDisplays = resolveKeybindingDisplays({
		archiveKeybinding: 'mod+e',
		sendMessageKeybinding: 'mod+enter',
	})
	const plainDisplays = resolveKeybindingDisplays({
		archiveKeybinding: 'e',
		sendMessageKeybinding: 'enter',
	})

	it('substitutes every Archive keycap with the mod+e display on both platforms', () => {
		const groups = buildHotkeyHelpGroups(modDisplays, { desktop: true })
		for (const [groupLabel, shortcutLabel] of [
			['Global', 'Archive focused item'],
			['Session Detail', 'Archive or unarchive session'],
			['Task Detail', 'Archive or unarchive task'],
		] as const) {
			const display = findShortcut(groups, groupLabel, shortcutLabel)
			expect(display.mac).toEqual({ combination: ['⌘', 'E'] })
			expect(display.nonMac).toEqual({ combination: ['Ctrl', 'E'] })
		}
	})

	it('substitutes the composer submit hints with the Send-message display', () => {
		const groups = buildHotkeyHelpGroups(plainDisplays, { desktop: true })
		for (const shortcutLabel of ['Submit prompt or comment', 'Launch session draft']) {
			const display = findShortcut(groups, 'Text Editing', shortcutLabel)
			expect(display.mac).toEqual({ combination: ['Enter'] })
			expect(display.nonMac).toEqual({ combination: ['Enter'] })
		}
	})

	it('shows plain E for archive when the e binding is selected', () => {
		const groups = buildHotkeyHelpGroups(plainDisplays, { desktop: true })
		const display = findShortcut(groups, 'Global', 'Archive focused item')
		expect(display.mac).toEqual({ combination: ['E'] })
		expect(display.nonMac).toEqual({ combination: ['E'] })
	})

	it('leaves unrelated shortcuts untouched', () => {
		const groups = buildHotkeyHelpGroups(plainDisplays, { desktop: true })
		expect(findShortcut(groups, 'Global', 'Open command palette')).toEqual(
			hotkeysCatalog.global.shortcuts.commandPalette.display,
		)
	})

	it('does not mutate the module-level catalog', () => {
		buildHotkeyHelpGroups(plainDisplays, { desktop: true })
		expect(hotkeysCatalog.global.shortcuts.archiveFocused.display).toEqual({
			mac: { combination: ['E'] },
			nonMac: { combination: ['E'] },
		})
		expect(hotkeysCatalog.textEditing.shortcuts.submit.display).toEqual({
			mac: { combination: ['⌘', 'Enter'] },
			nonMac: { combination: ['Ctrl', 'Enter'] },
		})
	})

	it('drops desktop-only shortcuts outside the desktop build', () => {
		const groups = buildHotkeyHelpGroups(modDisplays, { desktop: false })
		expect(groups.find((group) => group.label === 'Desktop App')).toBeUndefined()
		const globalShortcuts = groups.find((group) => group.label === 'Global')?.shortcuts
		expect(globalShortcuts?.some((shortcut) => shortcut.label === 'Move one tab left')).toBe(false)
		expect(globalShortcuts?.some((shortcut) => shortcut.label === 'Move one tab right')).toBe(false)
	})
})
