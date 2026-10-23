import { readFile } from 'node:fs/promises'

import type { BunPlugin } from 'bun'

const photonWasmLookup = "const path = require('path').join(__dirname, 'photon_rs_bg.wasm');"
const embeddedPhotonWasmLookup = `import photonWasmPath from './photon_rs_bg.wasm' with { type: 'file' };
const path = photonWasmPath;`

export function embedPhotonWasmLoader(source: string, path: string): string {
	const occurrences = source.split(photonWasmLookup).length - 1
	if (occurrences !== 1) {
		throw new Error(`Expected one Photon WASM runtime lookup in ${path}, found ${occurrences}`)
	}

	return source.replace(photonWasmLookup, embeddedPhotonWasmLookup)
}

/**
 * Photon loads its WASM with a runtime `__dirname` lookup that Bun cannot discover while compiling a standalone
 * executable. Rewrite that lookup to a static file import so Bun embeds the WASM and supplies its executable path.
 */
export const embedPhotonWasmPlugin: BunPlugin = {
	name: 'embed-photon-wasm',
	setup(build) {
		build.onLoad({ filter: /[/\\]@silvia-odwyer[/\\]photon-node[/\\]photon_rs\.js$/ }, async ({ path }) => {
			const source = await readFile(path, 'utf8')

			return {
				contents: embedPhotonWasmLoader(source, path),
				loader: 'js',
			}
		})
	},
}
