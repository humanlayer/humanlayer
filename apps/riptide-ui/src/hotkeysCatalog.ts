import type { HotkeyHelpGroup } from '@humanlayer/ui/components/hotkey-help-modal'

import { resolvePlatformModifier } from '@/hooks/hotkeys/platform-hotkeys'
import type { ArchiveKeybinding, SendMessageKeybinding } from '@/hooks/stores/settingsStore'

export type ShortcutKeys =
	| { readonly combination: readonly string[] }
	| { readonly alternatives: readonly (readonly string[])[] }
	| { readonly sequence: readonly string[] }

export type ShortcutDisplay = {
	readonly mac: ShortcutKeys
	readonly nonMac: ShortcutKeys
}

/** Which half of a `ShortcutDisplay` this machine should read. */
export const shortcutPlatform: 'mac' | 'nonMac' =
	typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'mac' : 'nonMac'

/**
 * A catalog shortcut as one string, for tooltips and labels that show keys
 * inline rather than as keycaps: `⌘+B`, `g t`, `J or ↓`. Surfaces that render
 * keycaps read `display[shortcutPlatform]` directly instead.
 */
export function formatShortcut(display: ShortcutDisplay): string {
	const keys = display[shortcutPlatform]
	if ('sequence' in keys) return keys.sequence.join(' ')
	const combinations = 'combination' in keys ? [keys.combination] : keys.alternatives
	return combinations.map((combination) => combination.join('+')).join(' or ')
}

const key = (combination: readonly string[]): ShortcutDisplay => ({
	mac: { combination },
	nonMac: { combination },
})

const mod = (rest: readonly string[]): ShortcutDisplay => ({
	mac: { combination: ['⌘', ...rest] },
	nonMac: { combination: ['Ctrl', ...rest] },
})

const alt = (rest: readonly string[]): ShortcutDisplay => ({
	mac: { combination: ['⌥', ...rest] },
	nonMac: { combination: ['Alt', ...rest] },
})

const alternatives = (
	mac: readonly (readonly string[])[],
	nonMac: readonly (readonly string[])[] = mac,
): ShortcutDisplay => ({ mac: { alternatives: mac }, nonMac: { alternatives: nonMac } })

const sequence = (keys: readonly string[]): ShortcutDisplay => ({
	mac: { sequence: keys },
	nonMac: { sequence: keys },
})

export const hotkeysCatalog = {
	global: {
		label: 'Global',
		scope: 'Common shortcuts outside text entry',
		shortcuts: {
			commandPalette: {
				label: 'Open command palette',
				reactHotkeys: resolvePlatformModifier('mod+k'),
				display: mod(['K']),
			},
			tasksView: { label: 'Go to Tasks', reactHotkeys: 'g>t', display: sequence(['g', 't']) },
			settings: {
				label: 'Open settings',
				reactHotkeys: resolvePlatformModifier('mod+comma'),
				display: mod([',']),
			},
			toggleSidebar: {
				label: 'Toggle sidebar',
				reactHotkeys: resolvePlatformModifier('mod+b'),
				display: mod(['B']),
			},
			hotkeyHelp: { label: 'Open Hotkeys Guide', reactHotkeys: 'shift+?', display: key(['⇧', '?']) },
			unfocusOrBack: { label: 'Unfocus/back', reactHotkeys: 'escape', display: key(['Esc']) },
			moveDown: { label: 'Move down', reactHotkeys: 'j,down', display: alternatives([['J'], ['↓']]) },
			moveUp: { label: 'Move up', reactHotkeys: 'k,up', display: alternatives([['K'], ['↑']]) },
			moveLeft: { label: 'Move left', reactHotkeys: 'h,left', display: alternatives([['H'], ['←']]) },
			moveRight: { label: 'Move right', reactHotkeys: 'l,right', display: alternatives([['L'], ['→']]) },
			first: { label: 'Jump to first item', reactHotkeys: 'g>g', display: sequence(['g', 'g']) },
			last: { label: 'Jump to last item', reactHotkeys: 'shift+g', display: key(['⇧', 'G']) },
			openFocused: { label: 'Open focused item', reactHotkeys: 'enter', display: key(['Enter']) },
			renameFocused: { label: 'Rename focused item', reactHotkeys: 'shift+r', display: key(['⇧', 'R']) },
			archiveFocused: { label: 'Archive focused item', reactHotkeys: 'e', display: key(['E']) },
			copyPrimaryUrl: {
				label: 'Copy focused or current URL',
				reactHotkeys: resolvePlatformModifier('mod+shift+c'),
				display: mod(['⇧', 'C']),
			},
			latestNotification: {
				label: 'Open notifications',
				reactHotkeys: resolvePlatformModifier('mod+shift+j'),
				display: mod(['⇧', 'J']),
			},
			previousHorizontalTab: {
				label: 'Move one tab left',
				reactHotkeys: resolvePlatformModifier('mod+shift+[,ctrl+shift+tab'),
				display: alternatives(
					[
						['⌘', '⇧', '['],
						['Ctrl', '⇧', 'Tab'],
					],
					[
						['Ctrl', '⇧', '['],
						['Ctrl', '⇧', 'Tab'],
					],
				),
				desktopOnly: true,
			},
			nextHorizontalTab: {
				label: 'Move one tab right',
				reactHotkeys: resolvePlatformModifier('mod+shift+],ctrl+tab'),
				display: alternatives(
					[
						['⌘', '⇧', ']'],
						['Ctrl', 'Tab'],
					],
					[
						['Ctrl', '⇧', ']'],
						['Ctrl', 'Tab'],
					],
				),
				desktopOnly: true,
			},
		},
	},
	navigationAndCreation: {
		label: 'Navigation & Creation',
		scope: 'Main workspace',
		shortcuts: {
			workspaceTab: {
				label: 'Open workspace tab 1-3',
				reactHotkeys: '1,2,3',
				display: alternatives([['1'], ['2'], ['3']]),
			},
			cycleTabs: {
				label: 'Cycle workspace tabs',
				reactHotkeys: 'tab,shift+tab',
				display: alternatives([['Tab'], ['⇧', 'Tab']]),
			},
			createSession: { label: 'Create session', reactHotkeys: 'c', display: key(['C']) },
			createTask: { label: 'Create task', reactHotkeys: 't', display: key(['T']) },
			focusSidebar: {
				label: 'Move keyboard focus left',
				reactHotkeys: 'shift+h',
				display: key(['⇧', 'H']),
			},
			focusRightPane: {
				label: 'Move keyboard focus right',
				reactHotkeys: 'shift+l',
				display: key(['⇧', 'L']),
			},
			cycleSidebar: {
				label: 'Cycle sidebar content',
				reactHotkeys: 's,shift+s',
				display: alternatives([['S'], ['⇧', 'S']]),
			},
		},
	},
	sessionList: {
		label: 'Session List',
		scope: 'Focused session row',
		shortcuts: {
			bypass: { label: 'Toggle bypass permissions', reactHotkeys: 'alt+y', display: alt(['Y']) },
			autoAccept: { label: 'Toggle auto-accept edits', reactHotkeys: 'alt+a', display: alt(['A']) },
		},
	},
	notifications: {
		label: 'Notifications',
		scope: 'Open notification list',
		shortcuts: {
			dismiss: { label: 'Dismiss notification', reactHotkeys: 'e', display: key(['E']) },
		},
	},
	artifacts: {
		label: 'Artifacts',
		scope: 'Artifact panel and fullscreen',
		shortcuts: {
			close: {
				label: 'Close selected artifact',
				reactHotkeys: 's,shift+s',
				display: alternatives([['S'], ['⇧', 'S']]),
			},
			fullscreen: { label: 'Toggle artifact fullscreen', reactHotkeys: 'f', display: key(['F']) },
			find: { label: 'Find in artifact', reactHotkeys: resolvePlatformModifier('mod+f'), display: mod(['F']) },
			outline: { label: 'Toggle document outline', reactHotkeys: 'shift+o', display: key(['⇧', 'O']) },
			comment: { label: 'Comment on focused block', reactHotkeys: 'c', display: key(['C']) },
			sendComments: { label: 'Send comments using current mode', reactHotkeys: 'alt+c', display: alt(['C']) },
		},
	},
	desktopApp: {
		label: 'Desktop App',
		scope: 'Available in the native app',
		shortcuts: {
			toggleTerminal: {
				label: 'Toggle terminal',
				reactHotkeys: resolvePlatformModifier('mod+j'),
				display: mod(['J']),
				desktopOnly: true,
			},
			openEditor: {
				label: 'Open working directory in editor',
				reactHotkeys: resolvePlatformModifier('mod+shift+o'),
				display: mod(['⇧', 'O']),
				desktopOnly: true,
			},
			zoomIn: {
				label: 'Increase zoom',
				reactHotkeys: resolvePlatformModifier('mod+='),
				display: mod(['+']),
				desktopOnly: true,
			},
			zoomOut: {
				label: 'Decrease zoom',
				reactHotkeys: resolvePlatformModifier('mod+-'),
				display: mod(['-']),
				desktopOnly: true,
			},
			resetZoom: {
				label: 'Reset zoom',
				reactHotkeys: resolvePlatformModifier('mod+0'),
				display: mod(['0']),
				desktopOnly: true,
			},
		},
	},
	sessionDetail: {
		label: 'Session Detail',
		scope: 'While viewing a session',
		shortcuts: {
			approve: { label: 'Approve pending request', reactHotkeys: 'a', display: key(['A']) },
			applySuggestions: { label: 'Apply pending suggestions', reactHotkeys: 'l', display: key(['L']) },
			deny: { label: 'Deny pending request', reactHotkeys: 'd', display: key(['D']) },
			copyMessage: { label: 'Copy focused message or command', reactHotkeys: 'y', display: key(['Y']) },
			fork: { label: 'Fork session', reactHotkeys: resolvePlatformModifier('mod+y'), display: mod(['Y']) },
			bypass: { label: 'Toggle bypass permissions', reactHotkeys: 'alt+y', display: alt(['Y']) },
			autoAccept: { label: 'Toggle auto-accept edits', reactHotkeys: 'alt+a', display: alt(['A']) },
			autoAdvance: { label: 'Toggle auto-advance', reactHotkeys: 'alt+shift+a', display: alt(['⇧', 'A']) },
			archive: { label: 'Archive or unarchive session', reactHotkeys: 'e', display: key(['E']) },
			addToTask: { label: 'Add or change task', reactHotkeys: 'shift+t', display: key(['⇧', 'T']) },
			focusContinuation: { label: 'Focus continuation editor', reactHotkeys: 'enter', display: key(['Enter']) },
			switchModel: { label: 'Switch model', reactHotkeys: 'shift+m', display: key(['⇧', 'M']) },
			interrupt: {
				label: 'Interrupt running session',
				reactHotkeys: 'ctrl+c,ctrl+x',
				display: alternatives([
					['Ctrl', 'C'],
					['Ctrl', 'X'],
				]),
			},
			proceedNext: {
				label: 'Proceed to next step',
				reactHotkeys: resolvePlatformModifier('mod+shift+enter'),
				display: mod(['⇧', 'Enter']),
			},
			iterate: { label: 'Iterate in a new session', reactHotkeys: 'alt+enter', display: alt(['Enter']) },
			copyPrimaryUrl: {
				label: 'Copy session URL',
				reactHotkeys: resolvePlatformModifier('mod+shift+c'),
				display: mod(['⇧', 'C']),
			},
			attachFile: { label: 'Attach file', reactHotkeys: resolvePlatformModifier('mod+o'), display: mod(['O']) },
			toggleDiff: { label: 'Toggle split or unified diff', reactHotkeys: 'shift+v', display: key(['⇧', 'V']) },
		},
	},
	taskDetail: {
		label: 'Task Detail',
		scope: 'While viewing a task',
		shortcuts: {
			createSession: { label: 'Create session in task', reactHotkeys: 'c', display: key(['C']) },
			archive: { label: 'Archive or unarchive task', reactHotkeys: 'e', display: key(['E']) },
			rename: { label: 'Rename focused session or task', reactHotkeys: 'shift+r', display: key(['⇧', 'R']) },
			editDirectory: {
				label: 'Edit default working directory',
				reactHotkeys: 'shift+d',
				display: key(['⇧', 'D']),
			},
			copyPrimaryUrl: {
				label: 'Copy task URL',
				reactHotkeys: resolvePlatformModifier('mod+shift+c'),
				display: mod(['⇧', 'C']),
			},
		},
	},
	textEditing: {
		label: 'Text Editing',
		scope: 'Riptide editors and comments',
		shortcuts: {
			submit: {
				label: 'Submit prompt or comment',
				reactHotkeys: resolvePlatformModifier('mod+enter'),
				display: mod(['Enter']),
			},
			slashCommands: { label: 'Open slash commands', reactHotkeys: '/', display: key(['/']) },
			fileMention: { label: 'Mention a file', reactHotkeys: '@', display: key(['@']) },
			launchDraft: {
				label: 'Launch session draft',
				reactHotkeys: resolvePlatformModifier('mod+enter'),
				display: mod(['Enter']),
			},
			undoArchive: { label: 'Undo recent archive action', reactHotkeys: 'z', display: key(['Z']) },
		},
	},
	launcherV3: {
		label: 'Task Launcher',
		scope: 'While creating a task',
		shortcuts: {
			attachLinear: { label: 'Attach Linear issue', reactHotkeys: 'alt+l', display: alt(['L']) },
			attachGitHub: { label: 'Attach GitHub issue', reactHotkeys: 'alt+g', display: alt(['G']) },
			attachJira: { label: 'Attach Jira issue', reactHotkeys: 'alt+j', display: alt(['J']) },
		},
	},
} as const

/** Settings-aware display values for the two user-configurable keybindings. */
export type KeybindingDisplays = {
	readonly archive: ShortcutDisplay
	readonly sendMessage: ShortcutDisplay
}

/** Resolves a stored configurable binding into platform-aware keycaps. */
export function resolveKeybindingDisplay(binding: ArchiveKeybinding | SendMessageKeybinding): ShortcutDisplay {
	switch (binding) {
		case 'e':
			return key(['E'])
		case 'mod+e':
			return mod(['E'])
		case 'enter':
			return key(['Enter'])
		case 'mod+enter':
			return mod(['Enter'])
	}
}

/**
 * Resolves the stored keybinding choices into platform-aware keycap displays,
 * matching the catalog's `ShortcutDisplay` shape. Display-only: runtime
 * registration derives its own strings from the same settings.
 */
export function resolveKeybindingDisplays({
	archiveKeybinding,
	sendMessageKeybinding,
}: {
	archiveKeybinding: ArchiveKeybinding
	sendMessageKeybinding: SendMessageKeybinding
}): KeybindingDisplays {
	return {
		archive: resolveKeybindingDisplay(archiveKeybinding),
		sendMessage: resolveKeybindingDisplay(sendMessageKeybinding),
	}
}

/**
 * The keycaps this machine should render for a display: the platform
 * combination, the first alternative, or the sequence keys.
 */
export function shortcutKeycaps(
	display: ShortcutDisplay,
	platform: 'mac' | 'nonMac' = shortcutPlatform,
): readonly string[] {
	const keys = display[platform]
	if ('combination' in keys) return keys.combination
	if ('alternatives' in keys) return keys.alternatives[0] ?? []
	return keys.sequence
}

/**
 * Catalog entries whose display values follow the stored keybinding choices:
 * every Archive keycap plus the composer submit hints.
 */
const keybindingDisplayOverrides = (displays: KeybindingDisplays) =>
	new Map<string, ShortcutDisplay>([
		['global.archiveFocused', displays.archive],
		['sessionDetail.archive', displays.archive],
		['taskDetail.archive', displays.archive],
		['textEditing.submit', displays.sendMessage],
		['textEditing.launchDraft', displays.sendMessage],
	])

/**
 * Projects the static catalog into help-modal groups, substituting the
 * settings-aware Archive and Send-message displays. Never mutates the
 * module-level catalog.
 */
export function buildHotkeyHelpGroups(
	keybindingDisplays: KeybindingDisplays,
	{ desktop }: { desktop: boolean },
): HotkeyHelpGroup[] {
	const overrides = keybindingDisplayOverrides(keybindingDisplays)
	return Object.entries(hotkeysCatalog)
		.map(([groupKey, group]) => ({
			label: group.label,
			scope: group.scope,
			shortcuts: Object.entries(group.shortcuts)
				.filter(([, shortcut]) => !shortcut.desktopOnly || desktop)
				.map(([shortcutKey, shortcut]) => ({
					label: shortcut.label,
					display: overrides.get(`${groupKey}.${shortcutKey}`) ?? shortcut.display,
				})),
		}))
		.filter((group) => group.shortcuts.length > 0)
}
