#!/usr/bin/env bun

const rootPackage = await Bun.file(new URL('../package.json', import.meta.url)).json()
const expectedVersion = rootPackage.catalog?.zod

if (typeof expectedVersion !== 'string') {
	throw new Error('The root catalog must define an exact Zod version')
}

const errors: string[] = []

for (const workspaceDirectory of ['apps', 'contracts', 'packages', 'vendor']) {
	const glob = new Bun.Glob('*/package.json')
	for await (const relativePath of glob.scan({ cwd: new URL(`../${workspaceDirectory}/`, import.meta.url).pathname })) {
		const manifestPath = `${workspaceDirectory}/${relativePath}`
		const manifest = await Bun.file(new URL(`../${manifestPath}`, import.meta.url)).json()

		for (const dependencyType of [
			'dependencies',
			'devDependencies',
			'optionalDependencies',
			'peerDependencies',
		] as const) {
			const declaredVersion = manifest[dependencyType]?.zod
			if (declaredVersion !== undefined && declaredVersion !== 'catalog:') {
				errors.push(`${manifestPath}: ${dependencyType}.zod must use "catalog:", found ${declaredVersion}`)
			}
		}
	}
}

const agentlayerCatalogEntries = Object.entries(rootPackage.catalog).filter(
	([name]) => name === '@humanlayer/codelayer' || name.startsWith('@humanlayer/agentlayer-'),
)
const agentlayerVersions = new Set(agentlayerCatalogEntries.map(([, version]) => version))
if (agentlayerVersions.size !== 1) {
	errors.push(
		`AgentLayer catalog packages must use one version, found: ${[...agentlayerVersions].sort().join(', ') || 'none'}`,
	)
}

const allowedLockfileResolutions = new Map([
	['zod', expectedVersion],
	['chromium-bidi/zod', '3.25.76'],
	// riptide-opencode-plugin uses @opencode/plugin only for types; opencode supplies it at run time
	['@opencode/plugin/zod', '4.1.8'],
])
const lockfile = await Bun.file(new URL('../bun.lock', import.meta.url)).text()
const resolutionPattern = /^\s+"([^"]*zod)": \["zod@([^"]+)"/gm
const seenResolutions = new Map<string, string>()

for (const match of lockfile.matchAll(resolutionPattern)) {
	const [, name, version] = match
	seenResolutions.set(name, version)
	const allowedVersion = allowedLockfileResolutions.get(name)
	if (allowedVersion !== version) {
		errors.push(`${name} must resolve to ${allowedVersion ?? 'no version'}, found ${version}`)
	}
}

for (const [name, version] of allowedLockfileResolutions) {
	if (seenResolutions.get(name) !== version) {
		errors.push(`${name} must resolve to ${version}, found ${seenResolutions.get(name) ?? 'nothing'}`)
	}
}

if (errors.length > 0) {
	throw new Error(`Zod version alignment failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
}

console.log(
	`Zod version alignment passed (${expectedVersion}; isolated copies are limited to chromium-bidi and @opencode/plugin)`,
)
