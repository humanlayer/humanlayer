export const RECOMMENDED_CLAUDE_VERSION = '2.1.232'

function parseVersion(version: string): [number, number, number] {
	const match = version.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
	if (!match) return [0, 0, 0]
	return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function isVersionBelow(current: string, target: string): boolean {
	const [aMaj, aMin, aPatch] = parseVersion(current)
	const [bMaj, bMin, bPatch] = parseVersion(target)
	if (aMaj !== bMaj) return aMaj < bMaj
	if (aMin !== bMin) return aMin < bMin
	return aPatch < bPatch
}
