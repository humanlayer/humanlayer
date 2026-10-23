import type { Keys } from '@humanlayer/react-hotkeys-hook'

export function isApplePlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
	return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function resolvePlatformModifier(hotkey: string, platform?: string): string {
	const modifier = isApplePlatform(platform) ? 'meta' : 'ctrl'
	return hotkey.replace(/\bmod\+/gi, `${modifier}+`)
}

export function resolvePlatformHotkeys(keys: Keys, platform?: string): Keys {
	return typeof keys === 'string'
		? resolvePlatformModifier(keys, platform)
		: keys.map((key) => resolvePlatformModifier(key, platform))
}
