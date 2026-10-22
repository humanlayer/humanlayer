import { readFile } from 'node:fs/promises'

import * as Schema from 'effect/Schema'

const BundledPluginManifest = Schema.Struct({
	version: Schema.NonEmptyString,
})
export interface BundledPluginManifest extends Schema.Schema.Type<typeof BundledPluginManifest> {}

const decodeBundledFilePath = Schema.decodeUnknownSync(Schema.String)
const decodeBundledPluginManifest = Schema.decodeUnknownSync(BundledPluginManifest)

export function parseBundledFilePath(input: unknown): string {
	return decodeBundledFilePath(input)
}

export function parseBundledPluginManifest(input: unknown): BundledPluginManifest {
	return decodeBundledPluginManifest(input)
}

export async function readBundledPluginManifest(file: unknown): Promise<BundledPluginManifest> {
	const contents = await readFile(parseBundledFilePath(file), 'utf-8')
	return parseBundledPluginManifest(JSON.parse(contents))
}
