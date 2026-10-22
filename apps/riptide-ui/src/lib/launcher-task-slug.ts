import { generateTaskSlug, TASK_SLUG_MAX_LENGTH } from './task-slug'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Reject the biased tail of the byte range rather than favoring early letters. */
export function generateLauncherSlugSuffix(
	fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => {
		crypto.getRandomValues(bytes)
	},
): string {
	let suffix = ''
	const bytes = new Uint8Array(6)
	while (suffix.length < 6) {
		fillRandom(bytes)
		for (const byte of bytes) {
			if (byte >= 252) continue
			suffix += ALPHABET[byte % ALPHABET.length]
			if (suffix.length === 6) break
		}
	}
	return suffix
}

export function generateLauncherTaskSlug(name: string, suffix = generateLauncherSlugSuffix): string {
	const prefix = generateTaskSlug(name)
		.slice(0, TASK_SLUG_MAX_LENGTH - 7)
		.replace(/-+$/, '')
	return prefix ? `${prefix}-${suffix()}` : ''
}
