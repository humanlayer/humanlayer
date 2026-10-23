import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Skill } from '@humanlayer/agentlayer-core'
import { parse as parseToml } from '@iarna/toml'
import matter from 'gray-matter'

import logger from '@/logger'

const DEFAULT_PROJECT_ROOT_MARKERS = ['.git']
const PROJECT_SKILL_DIRECTORIES = ['.codex', '.agents', '.claude'] as const

export type CodexSkillSourceKind = 'bundled' | 'project' | 'configured' | 'user' | 'plugin'

export interface CodexSkillSource {
	kind: CodexSkillSourceKind
	root: string
	configuredRoot?: string
	projectDirectory?: string
	pluginIdentityToken?: string
	pluginConfigIndex?: number
	pluginVersionToken?: string
	pluginVersionKind?: PluginVersionKind
}

export interface DiscoveredCodexSkill extends Skill {
	source: CodexSkillSource
	skillFile: string
}

export interface CodexSkillDiscoveryDiagnostic {
	stage: 'catalog' | 'config' | 'cache' | 'manifest' | 'root' | 'file'
	sourceKind: CodexSkillSourceKind | 'catalog' | 'config'
	path: string
	code: CodexSkillDiscoveryErrorCode
	message: string
	configIndex?: number
	pluginIdentityToken?: string
	pluginClassification?: PluginClassification
	versionToken?: string
	versionKind?: PluginVersionKind
	pathToken?: string
}

export type CodexSkillDiscoveryErrorCode =
	| 'catalog_discovery_failed'
	| 'config_read_failed'
	| 'config_parse_failed'
	| 'config_validation_failed'
	| 'plugin_identity_invalid'
	| 'plugin_config_validation_failed'
	| 'plugin_cache_read_failed'
	| 'plugin_cache_entry_invalid'
	| 'plugin_cache_canonicalization_failed'
	| 'plugin_cache_path_escape'
	| 'plugin_manifest_read_failed'
	| 'plugin_manifest_parse_failed'
	| 'plugin_manifest_validation_failed'
	| 'plugin_skill_root_path_escape'
	| 'cwd_canonicalization_failed'
	| 'configured_root_stat_failed'
	| 'configured_root_canonicalization_failed'
	| 'marker_check_failed'
	| 'root_stat_failed'
	| 'root_canonicalization_failed'
	| 'root_read_failed'
	| 'entry_stat_failed'
	| 'file_canonicalization_failed'
	| 'file_read_failed'
	| 'frontmatter_parse_failed'
	| 'frontmatter_validation_failed'

export interface CodexSkillDiscoverySummary {
	checked: number
	found: number
	missing: number
	loaded: number
	skipped: number
	errors: number
	diagnosticCount: number
}

export interface DiscoverCodexSkillsOptions {
	cwd: string
	home?: string
	codexHome?: string
	bundledRpiRoot: string
	bundledHumanlayerRoot?: string
	configuredRepoRoots: string[]
}

export interface CodexSkillDiscoveryResult {
	skills: DiscoveredCodexSkill[]
	diagnostics: CodexSkillDiscoveryDiagnostic[]
	sources: CodexSkillSource[]
	summary: CodexSkillDiscoverySummary
}

interface PendingRoot {
	path: string
	kind: CodexSkillSourceKind
	namespace?: string
	configuredRoot?: string
	projectDirectory?: string
	excludeSystem?: boolean
	pluginIdentityToken?: string
	pluginConfigIndex?: number
	pluginVersionToken?: string
	pluginVersionKind?: PluginVersionKind
	confinementRoot?: string
	pluginTokenPathRoot?: string
}

interface PluginIdentity {
	id: string
	plugin: string
	marketplace: string
}

interface EnabledPlugin extends PluginIdentity {
	configIndex: number
	identityToken: string
}

type PluginClassification = 'valid-identity' | 'invalid-identity'
type PluginVersionKind = 'local' | 'semver' | 'opaque'

interface PluginVersionMetadata {
	versionKind: PluginVersionKind
	versionToken: string
}

interface PluginObservationMetadataExtra {
	versionKind?: PluginVersionKind
	versionToken?: string
	rootIndex?: number
}

interface DiscoveryErrorMetadata {
	stage: DiscoveryStage
	sourceKind: CodexSkillSourceKind | 'catalog' | 'config'
	path: string
	configIndex?: number
	pluginIdentityToken?: string
	pluginClassification?: PluginClassification
	versionToken?: string
	versionKind?: PluginVersionKind
	pathToken?: string
}

interface LoadedCodexConfig {
	projectRootMarkers: string[]
	enabledPlugins: EnabledPlugin[]
}

interface MutableCounts {
	checked: number
	found: number
	missing: number
	loaded: number
	skipped: number
	errors: number
}

type DiscoveryStage = CodexSkillDiscoveryDiagnostic['stage']

function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

const SAFE_ERROR_MESSAGES: Record<CodexSkillDiscoveryErrorCode, string> = {
	catalog_discovery_failed: 'Codex skill catalog discovery failed',
	config_read_failed: 'Codex config could not be read',
	config_parse_failed: 'Codex config could not be parsed',
	config_validation_failed: 'Codex config has invalid project root markers',
	plugin_identity_invalid: 'Codex plugin identity is invalid',
	plugin_config_validation_failed: 'Codex plugin configuration is invalid',
	plugin_cache_read_failed: 'Codex plugin cache could not be read',
	plugin_cache_entry_invalid: 'Codex plugin cache entry is invalid',
	plugin_cache_canonicalization_failed: 'Codex plugin cache path could not be canonicalized',
	plugin_cache_path_escape: 'Codex plugin cache path escapes its expected location',
	plugin_manifest_read_failed: 'Codex plugin manifest could not be read',
	plugin_manifest_parse_failed: 'Codex plugin manifest could not be parsed',
	plugin_manifest_validation_failed: 'Codex plugin manifest is invalid',
	plugin_skill_root_path_escape: 'Codex plugin skill root escapes its bundle',
	cwd_canonicalization_failed: 'Working directory could not be canonicalized',
	configured_root_stat_failed: 'Configured repository root could not be inspected',
	configured_root_canonicalization_failed: 'Configured repository root could not be canonicalized',
	marker_check_failed: 'Project root marker could not be inspected',
	root_stat_failed: 'Skill root could not be inspected',
	root_canonicalization_failed: 'Skill root could not be canonicalized',
	root_read_failed: 'Skill root could not be read',
	entry_stat_failed: 'Skill entry could not be inspected',
	file_canonicalization_failed: 'Skill file could not be canonicalized',
	file_read_failed: 'Skill file could not be read',
	frontmatter_parse_failed: 'Skill frontmatter could not be parsed',
	frontmatter_validation_failed: 'Skill frontmatter is missing required fields',
}

function info(
	counts: MutableCounts,
	stage: DiscoveryStage,
	outcome:
		| 'checked'
		| 'found'
		| 'missing'
		| 'loaded'
		| 'empty'
		| 'disabled'
		| 'selected'
		| 'rejected'
		| 'excluded'
		| 'deduplicated'
		| 'collision',
	metadata: Record<string, unknown>,
): void {
	if (outcome === 'checked') counts.checked += 1
	if (outcome === 'found') counts.found += 1
	if (outcome === 'missing') counts.missing += 1
	if (outcome === 'loaded') counts.loaded += 1
	if (
		outcome === 'empty' ||
		outcome === 'disabled' ||
		outcome === 'rejected' ||
		outcome === 'excluded' ||
		outcome === 'deduplicated' ||
		outcome === 'collision'
	) {
		counts.skipped += 1
	}
	logger.info({ discovery: 'codex-skills', stage, outcome, ...metadata }, 'Codex skill discovery')
}

function reportError(
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
	code: CodexSkillDiscoveryErrorCode,
	metadata: DiscoveryErrorMetadata,
): void {
	const message = SAFE_ERROR_MESSAGES[code]
	const diagnostic = { ...metadata, code, message }
	counts.errors += 1
	diagnostics.push(diagnostic)
	logger.error(
		{ discovery: 'codex-skills', outcome: 'error', errorCode: code, ...metadata },
		'Codex skill discovery failed',
	)
}

function resolveHome(explicitHome?: string): string {
	const home = explicitHome ?? process.env.HOME
	if (!home) throw new Error('Cannot discover Codex skills without a home directory')
	return resolve(home)
}

function resolveCodexHome(home: string, explicitCodexHome?: string): string {
	return resolve(explicitCodexHome || process.env.CODEX_HOME || join(home, '.codex'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableToken(kind: string, value: string): string {
	return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function identityToken(identity: string): string {
	return stableToken('plugin', identity)
}

function versionMetadata(version: string): PluginVersionMetadata {
	return {
		versionKind: version === 'local' ? 'local' : parseSemanticVersion(version) ? 'semver' : 'opaque',
		versionToken: stableToken('version', version),
	}
}

function pluginObservationMetadata(
	plugin: Pick<EnabledPlugin, 'configIndex' | 'identityToken'>,
	path: string,
	extra: PluginObservationMetadataExtra = {},
	pathTokenSeed = path,
): Omit<DiscoveryErrorMetadata, 'stage'> {
	const pathToken = stableToken('path', pathTokenSeed)
	return {
		sourceKind: 'plugin',
		path: `plugin://${plugin.identityToken}/${pathToken}`,
		pathToken,
		configIndex: plugin.configIndex,
		pluginIdentityToken: plugin.identityToken,
		pluginClassification: 'valid-identity',
		...extra,
	}
}

function pendingRootMetadata(root: PendingRoot, path: string): Omit<DiscoveryErrorMetadata, 'stage'> {
	if (!root.pluginIdentityToken || root.pluginConfigIndex === undefined) {
		return { sourceKind: root.kind, path }
	}
	const version: PluginObservationMetadataExtra = {}
	if (root.pluginVersionKind) version.versionKind = root.pluginVersionKind
	if (root.pluginVersionToken) version.versionToken = root.pluginVersionToken
	return pluginObservationMetadata(
		{ configIndex: root.pluginConfigIndex, identityToken: root.pluginIdentityToken },
		path,
		version,
		root.pluginTokenPathRoot ? relative(root.pluginTokenPathRoot, path) : path,
	)
}

function canonicalPathMetadata(root: PendingRoot, canonicalPath: string): Record<string, unknown> {
	return root.pluginIdentityToken
		? {
				canonicalPathToken: stableToken(
					'path',
					root.pluginTokenPathRoot ? relative(root.pluginTokenPathRoot, canonicalPath) : canonicalPath,
				),
			}
		: { canonicalPath }
}

function discoveredSource(root: PendingRoot, canonicalRoot: string): CodexSkillSource {
	const source: CodexSkillSource = {
		kind: root.kind,
		root: root.kind === 'plugin' ? String(pendingRootMetadata(root, canonicalRoot).path) : canonicalRoot,
	}
	if (root.configuredRoot) source.configuredRoot = root.configuredRoot
	if (root.projectDirectory) source.projectDirectory = root.projectDirectory
	if (root.pluginIdentityToken) source.pluginIdentityToken = root.pluginIdentityToken
	if (root.pluginConfigIndex !== undefined) source.pluginConfigIndex = root.pluginConfigIndex
	if (root.pluginVersionToken) source.pluginVersionToken = root.pluginVersionToken
	if (root.pluginVersionKind) source.pluginVersionKind = root.pluginVersionKind
	return source
}

function isSafePathSegment(value: string): boolean {
	return (
		value.length > 0 &&
		value !== '.' &&
		value !== '..' &&
		!value.includes('/') &&
		!value.includes('\\') &&
		!value.includes('\0')
	)
}

function parsePluginIdentity(id: string): PluginIdentity | undefined {
	const separator = id.lastIndexOf('@')
	if (separator <= 0 || separator === id.length - 1) return undefined
	const plugin = id.slice(0, separator)
	const marketplace = id.slice(separator + 1)
	if (!isSafePathSegment(plugin) || !isSafePathSegment(marketplace)) return undefined
	return { id, plugin, marketplace }
}

async function loadCodexConfig(
	codexHome: string,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<LoadedCodexConfig> {
	const configPath = join(codexHome, 'config.toml')
	const metadata = { sourceKind: 'config' as const, path: configPath }
	info(counts, 'config', 'checked', metadata)
	const defaults: LoadedCodexConfig = { projectRootMarkers: DEFAULT_PROJECT_ROOT_MARKERS, enabledPlugins: [] }

	let contents: string
	try {
		contents = await readFile(configPath, 'utf8')
	} catch (error) {
		if (isMissing(error)) {
			info(counts, 'config', 'missing', metadata)
			return defaults
		}
		reportError(counts, diagnostics, 'config_read_failed', { stage: 'config', ...metadata })
		return defaults
	}

	info(counts, 'config', 'found', metadata)
	if (contents.trim().length === 0) {
		info(counts, 'config', 'empty', metadata)
		return defaults
	}

	let parsed: ReturnType<typeof parseToml>
	try {
		parsed = parseToml(contents)
	} catch {
		reportError(counts, diagnostics, 'config_parse_failed', { stage: 'config', ...metadata })
		return defaults
	}
	info(counts, 'config', 'loaded', { ...metadata, scope: 'global' })

	let projectRootMarkers = DEFAULT_PROJECT_ROOT_MARKERS
	try {
		const value = parsed.project_root_markers
		if (
			value !== undefined &&
			(!Array.isArray(value) || value.some((marker) => typeof marker !== 'string' || marker.length === 0))
		) {
			throw new TypeError('invalid project root markers')
		}
		if (value !== undefined) projectRootMarkers = value as string[]
	} catch {
		reportError(counts, diagnostics, 'config_validation_failed', { stage: 'config', ...metadata })
	}

	const features = parsed.features
	if (features !== undefined && !isRecord(features)) {
		reportError(counts, diagnostics, 'plugin_config_validation_failed', { stage: 'config', ...metadata })
		return { projectRootMarkers, enabledPlugins: [] }
	}
	const pluginsFeature = features?.plugins
	if (pluginsFeature !== undefined && typeof pluginsFeature !== 'boolean') {
		reportError(counts, diagnostics, 'plugin_config_validation_failed', { stage: 'config', ...metadata })
		return { projectRootMarkers, enabledPlugins: [] }
	}

	const plugins = parsed.plugins
	if (pluginsFeature === false) {
		info(counts, 'config', 'disabled', { ...metadata, scope: 'global', reason: 'feature-disabled' })
		if (isRecord(plugins)) {
			for (const configIndex of Object.keys(plugins).keys()) {
				info(counts, 'config', 'disabled', {
					...metadata,
					scope: 'entry',
					reason: 'feature-disabled',
					configIndex,
				})
			}
		}
		return { projectRootMarkers, enabledPlugins: [] }
	}
	if (plugins === undefined) return { projectRootMarkers, enabledPlugins: [] }
	if (!isRecord(plugins)) {
		reportError(counts, diagnostics, 'plugin_config_validation_failed', { stage: 'config', ...metadata })
		return { projectRootMarkers, enabledPlugins: [] }
	}

	const enabledPlugins: EnabledPlugin[] = []
	for (const [configIndex, [id, value]] of Object.entries(plugins).entries()) {
		const entryMetadata = { sourceKind: 'config' as const, path: configPath, configIndex }
		info(counts, 'config', 'checked', entryMetadata)
		const identity = parsePluginIdentity(id)
		if (!identity) {
			reportError(counts, diagnostics, 'plugin_identity_invalid', {
				stage: 'config',
				...entryMetadata,
				pluginClassification: 'invalid-identity',
			})
			continue
		}
		const pluginIdentityToken = identityToken(identity.id)
		const correlatedEntryMetadata = {
			...entryMetadata,
			pluginIdentityToken,
			pluginClassification: 'valid-identity' as const,
		}
		if (!isRecord(value) || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) {
			reportError(counts, diagnostics, 'plugin_config_validation_failed', {
				stage: 'config',
				...correlatedEntryMetadata,
			})
			continue
		}
		if (value.enabled === false) {
			info(counts, 'config', 'disabled', {
				...correlatedEntryMetadata,
				scope: 'entry',
				reason: 'plugin-disabled',
			})
			continue
		}
		info(counts, 'config', 'loaded', { ...correlatedEntryMetadata, scope: 'entry' })
		enabledPlugins.push({ ...identity, configIndex, identityToken: pluginIdentityToken })
	}

	return { projectRootMarkers, enabledPlugins }
}

function parentDirectory(path: string): string | undefined {
	const parent = dirname(path)
	return parent === path ? undefined : parent
}

async function projectDirectories(cwd: string, home: string): Promise<string[]> {
	const directories: string[] = []
	const homeIsAncestor = isPathWithin(home, cwd)
	let current = cwd
	while (true) {
		directories.push(current)
		if (homeIsAncestor && current === home) break
		const parent = parentDirectory(current)
		if (!parent) break
		current = parent
	}
	return directories
}

async function canonicalizeCwd(
	cwd: string,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<string | undefined> {
	const resolvedCwd = resolve(cwd)
	try {
		return await realpath(resolvedCwd)
	} catch {
		reportError(counts, diagnostics, 'cwd_canonicalization_failed', {
			stage: 'root',
			sourceKind: 'project',
			path: resolvedCwd,
		})
		return undefined
	}
}

async function canonicalizeConfiguredRoots(
	configuredRepoRoots: string[],
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<string[]> {
	const canonicalRoots: string[] = []
	for (const configuredRoot of configuredRepoRoots) {
		const resolvedRoot = resolve(configuredRoot)
		const metadata = { sourceKind: 'configured' as const, path: resolvedRoot }
		info(counts, 'root', 'checked', metadata)
		try {
			const details = await stat(resolvedRoot)
			if (!details.isDirectory()) {
				info(counts, 'root', 'empty', metadata)
				continue
			}
		} catch (error) {
			if (isMissing(error)) info(counts, 'root', 'missing', metadata)
			else reportError(counts, diagnostics, 'configured_root_stat_failed', { stage: 'root', ...metadata })
			continue
		}

		try {
			const canonicalRoot = await realpath(resolvedRoot)
			info(counts, 'root', 'found', { ...metadata, canonicalPath: canonicalRoot })
			canonicalRoots.push(canonicalRoot)
		} catch {
			reportError(counts, diagnostics, 'configured_root_canonicalization_failed', { stage: 'root', ...metadata })
		}
	}
	return canonicalRoots
}

function isPathWithin(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate)
	return (
		pathFromParent === '' ||
		(!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent))
	)
}

interface SemanticVersion {
	major: string
	minor: string
	patch: string
	prerelease: string[]
}

function parseSemanticVersion(value: string): SemanticVersion | undefined {
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
			value,
		)
	if (!match) return undefined
	const [, major, minor, patch, prerelease] = match
	if (major === undefined || minor === undefined || patch === undefined) return undefined
	return {
		major,
		minor,
		patch,
		prerelease: prerelease?.split('.') ?? [],
	}
}

function compareNumericIdentifiers(left: string, right: string): number {
	if (left.length !== right.length) return left.length < right.length ? -1 : 1
	return left < right ? -1 : left > right ? 1 : 0
}

function comparePrerelease(left: string[], right: string[]): number {
	if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftPart = left[index]
		const rightPart = right[index]
		if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1
		if (leftPart === rightPart) continue
		const leftNumeric = /^\d+$/.test(leftPart)
		const rightNumeric = /^\d+$/.test(rightPart)
		if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart)
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
		return leftPart < rightPart ? -1 : 1
	}
	return 0
}

function compareCacheVersions(left: string, right: string): number {
	const leftSemver = parseSemanticVersion(left)
	const rightSemver = parseSemanticVersion(right)
	if (!leftSemver || !rightSemver) return left < right ? -1 : left > right ? 1 : 0
	for (const key of ['major', 'minor', 'patch'] as const) {
		const comparison = compareNumericIdentifiers(leftSemver[key], rightSemver[key])
		if (comparison !== 0) return comparison
	}
	return comparePrerelease(leftSemver.prerelease, rightSemver.prerelease)
}

async function selectPluginBundle(
	plugin: EnabledPlugin,
	canonicalCacheRoot: string,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<({ root: string; version: string; tokenPathRoot: string } & PluginVersionMetadata) | undefined> {
	const pluginCachePath = join(canonicalCacheRoot, plugin.marketplace, plugin.plugin)
	const observe = (path: string, extra: PluginObservationMetadataExtra = {}) =>
		pluginObservationMetadata(plugin, path, extra, relative(pluginCachePath, path))
	const metadata = observe(pluginCachePath)
	info(counts, 'cache', 'checked', metadata)

	let entries
	try {
		entries = await readdir(pluginCachePath, { withFileTypes: true })
	} catch (error) {
		if (isMissing(error)) info(counts, 'cache', 'missing', metadata)
		else reportError(counts, diagnostics, 'plugin_cache_read_failed', { stage: 'cache', ...metadata })
		return undefined
	}
	info(counts, 'cache', 'found', metadata)

	let canonicalPluginCache: string
	try {
		canonicalPluginCache = await realpath(pluginCachePath)
	} catch {
		reportError(counts, diagnostics, 'plugin_cache_canonicalization_failed', { stage: 'cache', ...metadata })
		return undefined
	}
	if (!isPathWithin(canonicalCacheRoot, canonicalPluginCache)) {
		reportError(counts, diagnostics, 'plugin_cache_path_escape', { stage: 'cache', ...metadata })
		return undefined
	}

	const versions: string[] = []
	for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
		const entryPath = join(pluginCachePath, entry.name)
		const entryVersionMetadata = versionMetadata(entry.name)
		const entryMetadata = observe(entryPath, entryVersionMetadata)
		info(counts, 'cache', 'checked', entryMetadata)
		let isDirectory = entry.isDirectory()
		if (entry.isSymbolicLink()) {
			try {
				isDirectory = (await stat(entryPath)).isDirectory()
			} catch {
				reportError(counts, diagnostics, 'plugin_cache_entry_invalid', { stage: 'cache', ...entryMetadata })
				continue
			}
		}
		if (!isDirectory) {
			info(counts, 'cache', 'rejected', { ...entryMetadata, reason: 'not-directory' })
			continue
		}
		info(counts, 'cache', 'found', entryMetadata)
		versions.push(entry.name)
	}

	const version = versions.includes('local')
		? 'local'
		: versions.reduce<string | undefined>(
				(selected, candidate) =>
					selected === undefined || compareCacheVersions(selected, candidate) < 0 ? candidate : selected,
				undefined,
			)
	if (!version) {
		info(counts, 'cache', 'empty', metadata)
		return undefined
	}

	const bundlePath = join(pluginCachePath, version)
	const selectedVersionMetadata = versionMetadata(version)
	let canonicalBundle: string
	try {
		canonicalBundle = await realpath(bundlePath)
	} catch {
		reportError(counts, diagnostics, 'plugin_cache_canonicalization_failed', {
			stage: 'cache',
			...observe(bundlePath, selectedVersionMetadata),
		})
		return undefined
	}
	if (!isPathWithin(canonicalPluginCache, canonicalBundle)) {
		reportError(counts, diagnostics, 'plugin_cache_path_escape', {
			stage: 'cache',
			...observe(bundlePath, selectedVersionMetadata),
		})
		return undefined
	}
	info(counts, 'cache', 'selected', {
		...observe(bundlePath, selectedVersionMetadata),
		selection: version === 'local' ? 'local' : 'version',
	})
	return { root: canonicalBundle, version, tokenPathRoot: pluginCachePath, ...selectedVersionMetadata }
}

async function readPluginManifest(
	plugin: EnabledPlugin,
	bundle: { root: string; version: string; tokenPathRoot: string } & PluginVersionMetadata,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<PendingRoot[]> {
	let manifestPath: string | undefined
	let contents: string | undefined
	const selectedVersionMetadata: PluginVersionMetadata = {
		versionKind: bundle.versionKind,
		versionToken: bundle.versionToken,
	}
	const observe = (path: string, extra: PluginObservationMetadataExtra = selectedVersionMetadata) =>
		pluginObservationMetadata(plugin, path, extra, relative(bundle.tokenPathRoot, path))
	for (const relativeManifest of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
		const candidate = join(bundle.root, relativeManifest)
		const metadata = observe(candidate)
		info(counts, 'manifest', 'checked', metadata)
		let canonicalManifest: string
		try {
			canonicalManifest = await realpath(candidate)
		} catch (error) {
			if (isMissing(error)) info(counts, 'manifest', 'missing', metadata)
			else {
				reportError(counts, diagnostics, 'plugin_manifest_read_failed', { stage: 'manifest', ...metadata })
				return []
			}
			continue
		}
		if (!isPathWithin(bundle.root, canonicalManifest)) {
			info(counts, 'manifest', 'rejected', { ...metadata, reason: 'path-escape' })
			reportError(counts, diagnostics, 'plugin_cache_path_escape', { stage: 'manifest', ...metadata })
			return []
		}
		try {
			contents = await readFile(canonicalManifest, 'utf8')
			manifestPath = candidate
			info(counts, 'manifest', 'found', {
				...metadata,
				canonicalPathToken: stableToken('path', relative(bundle.tokenPathRoot, canonicalManifest)),
			})
			break
		} catch {
			reportError(counts, diagnostics, 'plugin_manifest_read_failed', { stage: 'manifest', ...metadata })
			return []
		}
	}
	if (!manifestPath || contents === undefined) return []

	let manifest: unknown
	try {
		manifest = JSON.parse(contents)
	} catch {
		reportError(counts, diagnostics, 'plugin_manifest_parse_failed', {
			stage: 'manifest',
			...observe(manifestPath),
		})
		return []
	}
	if (!isRecord(manifest) || typeof manifest.name !== 'string' || manifest.name !== plugin.plugin) {
		reportError(counts, diagnostics, 'plugin_manifest_validation_failed', {
			stage: 'manifest',
			...observe(manifestPath),
		})
		return []
	}

	let declaredRoots: string[]
	if (manifest.skills === undefined) declaredRoots = ['./skills']
	else if (typeof manifest.skills === 'string') declaredRoots = [manifest.skills]
	else if (Array.isArray(manifest.skills) && manifest.skills.every((entry) => typeof entry === 'string')) {
		declaredRoots = manifest.skills
	} else {
		reportError(counts, diagnostics, 'plugin_manifest_validation_failed', {
			stage: 'manifest',
			...observe(manifestPath),
		})
		return []
	}

	const roots: PendingRoot[] = []
	for (const [rootIndex, declaredRoot] of declaredRoots.entries()) {
		const rootMetadata = observe(manifestPath, { ...selectedVersionMetadata, rootIndex })
		const pathSegments = declaredRoot.split('/')
		if (
			!declaredRoot.startsWith('./') ||
			declaredRoot === './' ||
			declaredRoot.includes('\0') ||
			declaredRoot.includes('\\') ||
			pathSegments.includes('..')
		) {
			info(counts, 'manifest', 'rejected', { ...rootMetadata, reason: 'invalid-skill-root' })
			reportError(counts, diagnostics, 'plugin_manifest_validation_failed', {
				stage: 'manifest',
				...rootMetadata,
			})
			continue
		}
		const rootPath = resolve(bundle.root, declaredRoot)
		if (!isPathWithin(bundle.root, rootPath)) {
			info(counts, 'manifest', 'rejected', { ...rootMetadata, reason: 'path-escape' })
			reportError(counts, diagnostics, 'plugin_skill_root_path_escape', {
				stage: 'manifest',
				...rootMetadata,
			})
			continue
		}
		info(counts, 'manifest', 'selected', rootMetadata)
		roots.push({
			path: rootPath,
			kind: 'plugin',
			namespace: manifest.name,
			pluginIdentityToken: plugin.identityToken,
			pluginConfigIndex: plugin.configIndex,
			pluginVersionToken: bundle.versionToken,
			pluginVersionKind: bundle.versionKind,
			confinementRoot: bundle.root,
			pluginTokenPathRoot: bundle.tokenPathRoot,
		})
	}
	return roots
}

async function installedPluginRoots(
	codexHome: string,
	plugins: EnabledPlugin[],
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<PendingRoot[]> {
	if (plugins.length === 0) return []
	const cacheRoot = join(codexHome, 'plugins', 'cache')
	const metadata = { sourceKind: 'plugin' as const, path: cacheRoot }
	info(counts, 'cache', 'checked', metadata)
	let canonicalCacheRoot: string
	try {
		canonicalCacheRoot = await realpath(cacheRoot)
		info(counts, 'cache', 'found', { ...metadata, canonicalPath: canonicalCacheRoot })
	} catch (error) {
		if (isMissing(error)) info(counts, 'cache', 'missing', metadata)
		else reportError(counts, diagnostics, 'plugin_cache_canonicalization_failed', { stage: 'cache', ...metadata })
		return []
	}

	const roots: PendingRoot[] = []
	for (const plugin of plugins) {
		const bundle = await selectPluginBundle(plugin, canonicalCacheRoot, counts, diagnostics)
		if (bundle) roots.push(...(await readPluginManifest(plugin, bundle, counts, diagnostics)))
	}
	return roots
}

function pendingRoots(
	directories: string[],
	options: {
		bundledRpiRoot: string
		bundledHumanlayerRoot?: string
		configuredRepoRoots: string[]
		home: string
		codexHome: string
	},
): PendingRoot[] {
	const roots: PendingRoot[] = [{ path: options.bundledRpiRoot, kind: 'bundled', namespace: 'rpi' }]
	if (options.bundledHumanlayerRoot) {
		roots.push({ path: options.bundledHumanlayerRoot, kind: 'bundled', namespace: 'hl' })
	}

	for (const projectDirectory of directories) {
		for (const configDirectory of PROJECT_SKILL_DIRECTORIES) {
			roots.push({
				path: join(projectDirectory, configDirectory, 'skills'),
				kind: 'project',
				projectDirectory,
			})
		}
	}

	for (const configuredRoot of options.configuredRepoRoots) {
		for (const configDirectory of PROJECT_SKILL_DIRECTORIES) {
			roots.push({
				path: join(configuredRoot, configDirectory, 'skills'),
				kind: 'configured',
				configuredRoot,
			})
		}
	}

	roots.push(
		{ path: join(options.codexHome, 'skills'), kind: 'user', excludeSystem: true },
		{ path: join(options.home, '.agents', 'skills'), kind: 'user' },
		{ path: join(options.home, '.claude', 'skills'), kind: 'user' },
	)
	return roots
}

async function canonicalDirectory(
	root: PendingRoot,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<string | undefined> {
	const metadata = pendingRootMetadata(root, root.path)
	info(counts, 'root', 'checked', metadata)
	try {
		const details = await stat(root.path)
		if (!details.isDirectory()) {
			info(counts, 'root', 'empty', metadata)
			return undefined
		}
	} catch (error) {
		if (isMissing(error)) {
			info(counts, 'root', 'missing', metadata)
			return undefined
		}
		reportError(counts, diagnostics, 'root_stat_failed', { stage: 'root', ...metadata })
		return undefined
	}
	try {
		const canonical = await realpath(root.path)
		if (root.confinementRoot && !isPathWithin(root.confinementRoot, canonical)) {
			info(counts, 'root', 'rejected', { ...metadata, reason: 'path-escape' })
			reportError(counts, diagnostics, 'plugin_skill_root_path_escape', { stage: 'root', ...metadata })
			return undefined
		}
		info(counts, 'root', 'found', { ...metadata, ...canonicalPathMetadata(root, canonical) })
		return canonical
	} catch {
		reportError(counts, diagnostics, 'root_canonicalization_failed', { stage: 'root', ...metadata })
		return undefined
	}
}

async function collectSkillFiles(
	root: PendingRoot,
	canonicalRoot: string,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<string[]> {
	const files: string[] = []
	const visitedDirectories = new Set<string>()

	async function walk(directory: string, relativeDirectory: string): Promise<void> {
		const metadata = pendingRootMetadata(root, directory)
		let canonicalDirectoryPath: string
		try {
			canonicalDirectoryPath = await realpath(directory)
		} catch {
			reportError(counts, diagnostics, 'root_canonicalization_failed', {
				stage: 'root',
				...metadata,
			})
			return
		}
		if (root.confinementRoot && !isPathWithin(root.confinementRoot, canonicalDirectoryPath)) {
			info(counts, 'root', 'rejected', { ...metadata, reason: 'path-escape' })
			reportError(counts, diagnostics, 'plugin_skill_root_path_escape', {
				stage: 'root',
				...metadata,
			})
			return
		}
		if (visitedDirectories.has(canonicalDirectoryPath)) return
		visitedDirectories.add(canonicalDirectoryPath)

		let entries
		try {
			entries = await readdir(directory, { withFileTypes: true })
		} catch {
			reportError(counts, diagnostics, 'root_read_failed', {
				stage: 'root',
				...metadata,
			})
			return
		}

		for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
			const entryPath = join(directory, entry.name)
			const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name
			if (root.excludeSystem && relativePath === '.system') {
				info(counts, 'root', 'excluded', {
					...pendingRootMetadata(root, entryPath),
					reason: 'system-root',
				})
				continue
			}

			let directoryEntry = entry.isDirectory()
			if (entry.isSymbolicLink()) {
				try {
					directoryEntry = (await stat(entryPath)).isDirectory()
				} catch {
					const entryMetadata = pendingRootMetadata(root, entryPath)
					reportError(counts, diagnostics, 'entry_stat_failed', { stage: 'file', ...entryMetadata })
					continue
				}
			}

			if (directoryEntry) {
				await walk(entryPath, relativePath)
			} else if (entry.name === 'SKILL.md') {
				files.push(entryPath)
			}
		}
	}

	await walk(canonicalRoot, '')
	return files
}

async function loadSkill(
	filePath: string,
	root: PendingRoot,
	canonicalRoot: string,
	counts: MutableCounts,
	diagnostics: CodexSkillDiscoveryDiagnostic[],
): Promise<DiscoveredCodexSkill | undefined> {
	const metadata = pendingRootMetadata(root, filePath)
	info(counts, 'file', 'checked', metadata)

	let canonicalFile: string
	let contents: string
	try {
		canonicalFile = await realpath(filePath)
	} catch {
		reportError(counts, diagnostics, 'file_canonicalization_failed', { stage: 'file', ...metadata })
		return undefined
	}
	if (root.confinementRoot && !isPathWithin(root.confinementRoot, canonicalFile)) {
		info(counts, 'file', 'rejected', { ...metadata, reason: 'path-escape' })
		reportError(counts, diagnostics, 'plugin_skill_root_path_escape', { stage: 'file', ...metadata })
		return undefined
	}
	try {
		contents = await readFile(canonicalFile, 'utf8')
	} catch {
		reportError(counts, diagnostics, 'file_read_failed', { stage: 'file', ...metadata })
		return undefined
	}
	info(counts, 'file', 'found', { ...metadata, ...canonicalPathMetadata(root, canonicalFile) })

	let parsed: ReturnType<typeof matter>
	try {
		parsed = matter(contents)
	} catch {
		reportError(counts, diagnostics, 'frontmatter_parse_failed', { stage: 'file', ...metadata })
		return undefined
	}

	try {
		const frontmatterName = parsed.data.name
		const description = parsed.data.description
		if (typeof frontmatterName !== 'string' || frontmatterName.trim().length === 0) {
			throw new Error('SKILL.md frontmatter requires a non-empty name')
		}
		if (typeof description !== 'string' || description.trim().length === 0) {
			throw new Error('SKILL.md frontmatter requires a non-empty description')
		}
		const baseName = frontmatterName.trim()
		const name = root.namespace ? `${root.namespace}:${baseName}` : baseName
		return {
			name,
			description: description.trim(),
			content: contents,
			baseDir: dirname(canonicalFile),
			skillFile: canonicalFile,
			source: discoveredSource(root, canonicalRoot),
		}
	} catch {
		reportError(counts, diagnostics, 'frontmatter_validation_failed', { stage: 'file', ...metadata })
		return undefined
	}
}

export async function discoverBundledRpiSkills(bundledRpiRoot: string): Promise<CodexSkillDiscoveryResult> {
	const counts: MutableCounts = { checked: 0, found: 0, missing: 0, loaded: 0, skipped: 0, errors: 0 }
	const diagnostics: CodexSkillDiscoveryDiagnostic[] = []
	const root: PendingRoot = { path: resolve(bundledRpiRoot), kind: 'bundled', namespace: 'rpi' }
	const canonicalRoot = await canonicalDirectory(root, counts, diagnostics)
	if (!canonicalRoot) {
		return {
			skills: [],
			diagnostics,
			sources: [],
			summary: { ...counts, diagnosticCount: diagnostics.length },
		}
	}

	const skills: DiscoveredCodexSkill[] = []
	const finalNames = new Set<string>()
	for (const filePath of await collectSkillFiles(root, canonicalRoot, counts, diagnostics)) {
		const skill = await loadSkill(filePath, root, canonicalRoot, counts, diagnostics)
		if (!skill) continue
		if (finalNames.has(skill.name)) {
			info(counts, 'file', 'collision', {
				sourceKind: root.kind,
				path: skill.skillFile,
			})
			continue
		}
		finalNames.add(skill.name)
		skills.push(skill)
		info(counts, 'file', 'loaded', {
			sourceKind: root.kind,
			path: skill.skillFile,
		})
	}
	const sources: CodexSkillSource[] = [{ kind: 'bundled', root: canonicalRoot }]
	return {
		skills,
		diagnostics,
		sources,
		summary: { ...counts, diagnosticCount: diagnostics.length },
	}
}

export async function discoverCodexSkills(options: DiscoverCodexSkillsOptions): Promise<CodexSkillDiscoveryResult> {
	const counts: MutableCounts = { checked: 0, found: 0, missing: 0, loaded: 0, skipped: 0, errors: 0 }
	const diagnostics: CodexSkillDiscoveryDiagnostic[] = []
	const skills: DiscoveredCodexSkill[] = []
	const sources: CodexSkillSource[] = []
	const canonicalRoots = new Set<string>()
	const canonicalFiles = new Set<string>()
	const finalNames = new Set<string>()
	const home = resolveHome(options.home)
	const codexHome = resolveCodexHome(home, options.codexHome)
	const cwd = await canonicalizeCwd(options.cwd, counts, diagnostics)
	const config = await loadCodexConfig(codexHome, counts, diagnostics)
	const directories = cwd ? await projectDirectories(cwd, home) : []
	const configuredRepoRoots = await canonicalizeConfiguredRoots(options.configuredRepoRoots, counts, diagnostics)

	async function processRoot(root: PendingRoot): Promise<void> {
		const canonicalRoot = await canonicalDirectory(root, counts, diagnostics)
		if (!canonicalRoot) return
		if (canonicalRoots.has(canonicalRoot)) {
			info(counts, 'root', 'deduplicated', {
				...pendingRootMetadata(root, root.path),
				...canonicalPathMetadata(root, canonicalRoot),
			})
			return
		}
		canonicalRoots.add(canonicalRoot)
		const source = discoveredSource(root, canonicalRoot)
		sources.push(source)

		const files = await collectSkillFiles(root, canonicalRoot, counts, diagnostics)
		if (files.length === 0) info(counts, 'root', 'empty', pendingRootMetadata(root, root.path))
		for (const filePath of files) {
			const skill = await loadSkill(filePath, root, canonicalRoot, counts, diagnostics)
			if (!skill) continue
			if (canonicalFiles.has(skill.skillFile)) {
				info(counts, 'file', 'deduplicated', {
					...pendingRootMetadata(root, filePath),
					...canonicalPathMetadata(root, skill.skillFile),
				})
				continue
			}
			canonicalFiles.add(skill.skillFile)
			if (finalNames.has(skill.name)) {
				info(counts, 'file', 'collision', pendingRootMetadata(root, skill.skillFile))
				continue
			}
			finalNames.add(skill.name)
			skills.push(skill)
			info(counts, 'file', 'loaded', pendingRootMetadata(root, skill.skillFile))
		}
	}

	for (const root of pendingRoots(directories, {
		bundledRpiRoot: isAbsolute(options.bundledRpiRoot) ? options.bundledRpiRoot : resolve(options.bundledRpiRoot),
		bundledHumanlayerRoot: options.bundledHumanlayerRoot
			? isAbsolute(options.bundledHumanlayerRoot)
				? options.bundledHumanlayerRoot
				: resolve(options.bundledHumanlayerRoot)
			: undefined,
		configuredRepoRoots,
		home,
		codexHome,
	})) {
		await processRoot(root)
	}
	for (const root of await installedPluginRoots(codexHome, config.enabledPlugins, counts, diagnostics)) {
		await processRoot(root)
	}

	const summary: CodexSkillDiscoverySummary = { ...counts, diagnosticCount: diagnostics.length }
	const observableSources = sources.map((source) =>
		source.kind === 'plugin'
			? {
					kind: source.kind,
					root: source.root,
					pluginIdentityToken: source.pluginIdentityToken,
					pluginConfigIndex: source.pluginConfigIndex,
					pluginVersionToken: source.pluginVersionToken,
					pluginVersionKind: source.pluginVersionKind,
				}
			: source,
	)
	logger.info(
		{
			discovery: 'codex-skills',
			stage: 'summary',
			outcome: 'complete',
			mode: 'catalog',
			sources: observableSources,
			diagnostics,
			summary,
		},
		'Codex skill discovery complete',
	)
	return { skills, diagnostics, sources, summary }
}
