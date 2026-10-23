import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { StackRecord } from './registry'

export const NATIVE_CONFIG_RELATIVE_PATH = join('apps', 'riptide-native', 'tauri.stack.json')

export type NativeStackConfig = {
	productName: string
	identifier: string
	build: { devUrl: string }
	app: {
		windows: Array<{
			label: string
			title: string
			titleBarStyle: 'Overlay'
			transparent: boolean
			hiddenTitle: boolean
		}>
	}
	bundle: { icon: string[] }
	plugins: {
		'deep-link': { desktop: { schemes: string[] } }
		updater: { pubkey: string; endpoints: string[] }
	}
}

export function createNativeStackConfig(stack: StackRecord): NativeStackConfig {
	const stackName = `devstk-${stack.id}`
	return {
		productName: stackName,
		identifier: `com.humanlayer.riptide.local.${stack.tauriSuffix}`,
		build: { devUrl: stack.routes.ui },
		app: {
			windows: [
				{
					label: 'main',
					title: stackName,
					titleBarStyle: 'Overlay',
					transparent: true,
					hiddenTitle: true,
				},
			],
		},
		bundle: { icon: [stack.nativeIcon ?? 'icons/devstack/icon-1.png'] },
		plugins: {
			'deep-link': { desktop: { schemes: [`riptide-local-${stack.id.slice(0, 40)}`] } },
			updater: {
				pubkey: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk1ODdERjg1OEVFRjVGQzcKUldUSFgrK09oZCtIbFhaRVBCT3FndG1CNEo0WUpFeWFDS2hDNmVQSzNQdERqeWpWbGVvV1JIRTAK',
				endpoints: ['https://update.dev.codelayer.gg/dev/{{target}}-{{arch}}/{{current_version}}'],
			},
		},
	}
}

export function nativeConfigPath(repoRoot: string): string {
	return join(repoRoot, NATIVE_CONFIG_RELATIVE_PATH)
}

export async function writeNativeStackConfig(repoRoot: string, stack: StackRecord): Promise<void> {
	const path = nativeConfigPath(repoRoot)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(createNativeStackConfig(stack), null, 2)}\n`)
}

export async function checkNativeStackConfig(repoRoot: string, stack: StackRecord): Promise<void> {
	let actual: string
	try {
		actual = await readFile(nativeConfigPath(repoRoot), 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				'Stack native config is missing. Run `bun --bun run devstack sync` before `bun --bun run riptide:native`.',
			)
		}
		throw error
	}
	const expected = `${JSON.stringify(createNativeStackConfig(stack), null, 2)}\n`
	if (actual !== expected) {
		throw new Error(
			'Stack native config is stale. Run `bun --bun run devstack sync` before `bun --bun run riptide:native`.',
		)
	}
}

export async function removeNativeStackConfig(repoRoot: string): Promise<void> {
	await rm(nativeConfigPath(repoRoot), { force: true })
}
