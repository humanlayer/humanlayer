#!/usr/bin/env bun

/**
 * VS Code Theme Extraction Script
 *
 * Extracts color themes from VS Code theme repositories and generates:
 * - TypeScript metadata (vscode-themes.generated.ts)
 * - CSS custom properties (vscode-themes.generated.css)
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'jsonc-parser'

// ============================================================================
// Type Definitions
// ============================================================================

interface VSCodeThemeJSON {
	name?: string
	type?: 'dark' | 'light'
	colors?: Record<string, string>
	tokenColors?: unknown[]
}

interface ExtractedTheme {
	id: string
	name: string
	type: 'dark' | 'light'
	icon: 'Moon' | 'Sun'
	cssVariables: Map<string, string>
}

interface ThemeConfig {
	path: string
	name?: string
}

interface ThemeRegistry {
	themes: Array<{
		repo: string
		themes: Array<string | ThemeConfig>
		mappingOverrides?: Record<string, string>
	}>
}

interface TokenMapping {
	colorMappings: Record<string, string>
	fallbacks: {
		dark: { icon: string }
		light: { icon: string }
	}
}

// ============================================================================
// Configuration
// ============================================================================

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const THEME_CLONES_DIR = resolve(SCRIPT_DIR, './themeClones')
const GENERATED_DIR = resolve(SCRIPT_DIR, './generated')
const REGISTRY_PATH = resolve(SCRIPT_DIR, './config/theme-registry.json')
const MAPPING_PATH = resolve(SCRIPT_DIR, './config/theme-token-mapping.json')

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Ensures a git repository is cloned and up-to-date
 */
async function ensureRepository(repoUrl: string): Promise<string> {
	const repoName = basename(repoUrl, '.git')
	const repoPath = join(THEME_CLONES_DIR, repoName)

	// Create themeClones directory if it doesn't exist
	if (!existsSync(THEME_CLONES_DIR)) {
		await mkdir(THEME_CLONES_DIR, { recursive: true })
	}

	if (existsSync(repoPath)) {
		console.log(`📦 Repository already cloned: ${repoName}`)
		// Pull latest changes
		try {
			execSync('git pull', { cwd: repoPath, stdio: 'pipe' })
			console.log(`✓ Updated repository: ${repoName}`)
		} catch (error) {
			console.warn(`⚠️  Could not update repository: ${repoName}`)
		}
	} else {
		console.log(`📥 Cloning repository: ${repoUrl}`)
		execSync(`git clone ${repoUrl} ${repoPath}`, { stdio: 'inherit' })
		console.log(`✓ Cloned repository: ${repoName}`)
	}

	return repoPath
}

/**
 * Reads and parses a theme JSON file (with JSONC support)
 */
async function readThemeFile(filePath: string): Promise<VSCodeThemeJSON> {
	const content = await readFile(filePath, 'utf-8')
	return parse(content, undefined, {
		disallowComments: false,
		allowTrailingComma: true,
	}) as VSCodeThemeJSON
}

/**
 * Converts hex color to rgba with specified opacity
 */
function hexToRgba(hex: string, opacity: number): string {
	// Remove # if present
	hex = hex.replace(/^#/, '')

	// Remove alpha channel if present (8 char hex)
	if (hex.length === 8) {
		hex = hex.substring(0, 6)
	}

	// Handle shorthand hex
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((c) => c + c)
			.join('')
	}

	const r = parseInt(hex.substring(0, 2), 16)
	const g = parseInt(hex.substring(2, 4), 16)
	const b = parseInt(hex.substring(4, 6), 16)

	return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/**
 * Extracts theme colors and maps them to CSS variables
 */
function extractThemeColors(theme: VSCodeThemeJSON, mappings: Record<string, string>): Map<string, string> {
	const cssVariables = new Map<string, string>()

	if (!theme.colors) {
		console.warn(`⚠️  Theme "${theme.name}" has no colors defined`)
		return cssVariables
	}

	// Map VS Code color tokens to CSS variables
	for (const [cssVar, vscodeToken] of Object.entries(mappings)) {
		const color = theme.colors[vscodeToken]
		if (color) {
			cssVariables.set(cssVar, color.toLowerCase())
		}
	}

	// Generate --terminal-accent-dim from --terminal-accent with 30% opacity
	const accentColor = cssVariables.get('--terminal-accent')
	if (accentColor) {
		cssVariables.set('--terminal-accent-dim', hexToRgba(accentColor, 0.3))
	}

	// Every hand-written theme in globals.css defines --terminal-fg-dim and
	// --terminal-accent-alt, and the @theme bridge consumes them
	// (--color-muted-foreground: var(--terminal-fg-dim), …). A generated theme
	// that omits them leaves those bridge vars unresolvable — CSS text falls
	// back to inherit, but anything reading the var from JS (chart label
	// fills) renders BLACK. Derive them when the theme's own tokens don't
	// provide one, so a generated theme can never ship without the full set.
	if (!cssVariables.get('--terminal-fg-dim')) {
		const fg = cssVariables.get('--terminal-fg')
		if (fg) cssVariables.set('--terminal-fg-dim', hexToRgba(fg, 0.65))
	}
	if (!cssVariables.get('--terminal-accent-alt') && accentColor) {
		cssVariables.set('--terminal-accent-alt', accentColor)
	}

	// Some VS Code themes omit editor status tokens. The ANSI palette is always
	// present in the supported themes, so use its matching status hue rather than
	// leaving consumer styles invalid and inheriting an unintended foreground.
	const semanticColorFallbacks = [
		['--terminal-success', '--terminal-color-2'],
		['--terminal-warning', '--terminal-color-3'],
		['--terminal-error', '--terminal-color-1'],
	] as const
	for (const [semanticColor, ansiColor] of semanticColorFallbacks) {
		if (cssVariables.has(semanticColor)) continue
		const fallbackColor = cssVariables.get(ansiColor)
		if (fallbackColor) cssVariables.set(semanticColor, fallbackColor)
	}

	return cssVariables
}

/**
 * Generates a theme ID from theme name
 */
function generateThemeId(themeName: string): string {
	return `${themeName.toLowerCase().replace(/\s+/g, '-')}-vscode`
}

/**
 * Calculates luminance of a color
 */
function getLuminance(hex: string): number {
	// Remove # if present
	hex = hex.replace(/^#/, '')

	// Handle shorthand hex
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((c) => c + c)
			.join('')
	}

	// Remove alpha channel if present
	if (hex.length === 8) {
		hex = hex.substring(0, 6)
	}

	const r = parseInt(hex.substring(0, 2), 16) / 255
	const g = parseInt(hex.substring(2, 4), 16) / 255
	const b = parseInt(hex.substring(4, 6), 16) / 255

	// Convert to linear RGB
	const toLinear = (c: number) => {
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	}

	const rLinear = toLinear(r)
	const gLinear = toLinear(g)
	const bLinear = toLinear(b)

	// Calculate relative luminance
	return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
}

/**
 * Detects theme type based on background color luminance
 */
function detectThemeType(theme: VSCodeThemeJSON): 'dark' | 'light' {
	// Try to get background color
	const bgColor = theme.colors?.['editor.background']

	if (bgColor) {
		const luminance = getLuminance(bgColor)
		// If luminance > 0.5, it's a light theme
		return luminance > 0.5 ? 'light' : 'dark'
	}

	// Fall back to declared type or default to dark
	return theme.type || 'dark'
}

/**
 * Determines icon based on theme type
 */
function getIconForTheme(themeType: 'dark' | 'light', fallbacks: TokenMapping['fallbacks']): 'Moon' | 'Sun' {
	const icon = themeType === 'dark' ? fallbacks.dark.icon : fallbacks.light.icon
	return icon as 'Moon' | 'Sun'
}

/**
 * Generates TypeScript metadata file
 */
function generateTypeScriptMetadata(themes: ExtractedTheme[]): string {
	const timestamp = new Date().toISOString()

	const themeEntries = themes
		.map((theme) => {
			return `  {
    value: '${theme.id}',
    label: '${theme.name}',
    icon: '${theme.icon}',
    type: '${theme.type}'
  }`
		})
		.join(',\n')

	return `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 *
 * Generated by: packages/ui/src/vscode-themes/extract-themes.ts
 * Generated at: ${timestamp}
 * Source: config/theme-registry.json + config/theme-token-mapping.json
 *
 * To regenerate: cd packages/ui && bun run generate:themes
 */

export interface VSCodeThemeMetadata {
  value: string;
  label: string;
  icon: 'Moon' | 'Sun';
  type: 'dark' | 'light';
}

export const vscodeThemes: VSCodeThemeMetadata[] = [
${themeEntries}
];
`
}

/**
 * Generates CSS custom properties file
 */
function generateCSS(themes: ExtractedTheme[]): string {
	const timestamp = new Date().toISOString()

	const themeBlocks = themes
		.map((theme) => {
			const variables = Array.from(theme.cssVariables.entries())
				.map(([varName, value]) => `\t${varName}: ${value};`)
				.join('\n')

			return `/* ${theme.name} (VS Code) */
[data-theme="${theme.id}"] {
${variables}
}`
		})
		.join('\n\n')

	return `/* ===== AUTO-GENERATED VS CODE THEMES ===== */
/* Generated at: ${timestamp} */
/* DO NOT EDIT BELOW THIS LINE - Regenerate with: cd packages/ui && bun run generate:themes */

${themeBlocks}
`
}

// ============================================================================
// Main Extraction Logic
// ============================================================================

async function main() {
	console.log('🎨 VS Code Theme Extraction Started\n')

	// Load configuration files
	console.log('📋 Loading configuration...')
	const registryContent = await readFile(REGISTRY_PATH, 'utf-8')
	const registry: ThemeRegistry = JSON.parse(registryContent)

	const mappingContent = await readFile(MAPPING_PATH, 'utf-8')
	const tokenMapping: TokenMapping = JSON.parse(mappingContent)

	console.log(`✓ Found ${registry.themes.length} theme source(s)\n`)

	// Extract themes
	const extractedThemes: ExtractedTheme[] = []

	for (const source of registry.themes) {
		console.log(`📦 Processing: ${source.repo}`)
		const repoPath = await ensureRepository(source.repo)

		for (const themeEntry of source.themes) {
			// Handle both string and object formats
			const themePath = typeof themeEntry === 'string' ? themeEntry : themeEntry.path
			const nameOverride = typeof themeEntry === 'object' ? themeEntry.name : undefined

			const fullPath = join(repoPath, themePath)

			if (!existsSync(fullPath)) {
				console.error(`❌ Theme file not found: ${themePath}`)
				continue
			}

			console.log(`  📄 Reading theme: ${themePath}`)
			const theme = await readThemeFile(fullPath)

			// Use custom name if provided, otherwise use theme's original name
			const themeName = nameOverride || theme.name
			if (!themeName) {
				throw new Error(`Theme file ${fullPath} needs a name in the file or registry`)
			}

			if (nameOverride) {
				console.log(`  📝 Using custom name: "${nameOverride}" (original: "${theme.name}")`)
			}

			// Detect theme type based on background color luminance
			const themeType = detectThemeType(theme)

			console.log(`  ✓ Parsed theme: ${themeName} (${themeType})`)

			// Merge default mappings with any theme-specific overrides
			const effectiveMappings = {
				...tokenMapping.colorMappings,
				...(source.mappingOverrides || {}),
			}

			if (source.mappingOverrides) {
				console.log(`  📝 Applying ${Object.keys(source.mappingOverrides).length} mapping override(s)`)
			}

			// Extract colors
			const cssVariables = extractThemeColors(theme, effectiveMappings)
			console.log(`  ✓ Extracted ${cssVariables.size} CSS variables`)

			// Create extracted theme object
			const extractedTheme: ExtractedTheme = {
				id: generateThemeId(themeName),
				name: themeName,
				type: themeType,
				icon: getIconForTheme(themeType, tokenMapping.fallbacks),
				cssVariables,
			}

			extractedThemes.push(extractedTheme)
		}

		console.log()
	}

	// Generate output files
	console.log('📝 Generating output files...')

	// Create generated directory if it doesn't exist
	if (!existsSync(GENERATED_DIR)) {
		await mkdir(GENERATED_DIR, { recursive: true })
	}

	// Generate TypeScript metadata
	const tsContent = generateTypeScriptMetadata(extractedThemes)
	const tsPath = join(GENERATED_DIR, 'vscode-themes.generated.ts')
	await writeFile(tsPath, tsContent, 'utf-8')
	console.log(`✓ Generated: ${tsPath}`)

	// Generate CSS
	const cssContent = generateCSS(extractedThemes)
	const cssPath = join(GENERATED_DIR, 'vscode-themes.generated.css')
	await writeFile(cssPath, cssContent, 'utf-8')
	console.log(`✓ Generated: ${cssPath}`)

	console.log(`\n✅ Theme extraction complete! Generated ${extractedThemes.length} theme(s).`)
}

// Run the script
main().catch((error) => {
	console.error('❌ Error during theme extraction:', error)
	process.exit(1)
})
