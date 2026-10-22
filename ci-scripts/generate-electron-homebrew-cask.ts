#!/usr/bin/env bun

/**
 * Generate the Electron-only Homebrew cask for one release channel.
 * This file never replaces or renames the existing Tauri casks.
 *
 * Required environment variables:
 * - RELEASE_TYPE: dev | beta | prod
 * - RELEASE_VERSION
 * - SHA256
 * - DMG_URL
 * - OUTPUT_DIR
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ReleaseType } from './types'

interface ChannelConfig {
	productName: string
	appId: string
	description: string
	caskSlug: string
	daemonTarget: string
}

const channelConfigs: Record<ReleaseType, ChannelConfig> = {
	dev: {
		productName: 'HumanLayerElectronDev',
		appId: 'com.humanlayer.electron.dev',
		description: 'Development Electron build of HumanLayer pointing at the dev environment',
		caskSlug: 'humanlayer-electron-dev',
		daemonTarget: 'riptided-electron-dev',
	},
	beta: {
		productName: 'HumanLayerElectronBeta',
		appId: 'com.humanlayer.electron.beta',
		description: 'Beta Electron build of HumanLayer pointing at the beta environment',
		caskSlug: 'humanlayer-electron-beta',
		daemonTarget: 'riptided-electron-beta',
	},
	prod: {
		productName: 'HumanLayerElectron',
		appId: 'com.humanlayer.electron',
		description: 'Electron edition of the HumanLayer AI coding agent powered by Claude',
		caskSlug: 'humanlayer-electron',
		daemonTarget: 'riptided-electron',
	},
}

interface GenerateCaskInput {
	releaseType: ReleaseType
	releaseVersion: string
	sha256: string
	dmgUrl: string
	outputDir: string
}

function renderCask(input: GenerateCaskInput, slug: string): string {
	const channel = channelConfigs[input.releaseType]
	const productName = channel.productName
	const zapPaths = [
		`~/.humanlayer/electrondata/${input.releaseType}`,
		`~/Library/Logs/${channel.appId}/`,
		`~/Library/Preferences/${channel.appId}.plist`,
		`~/Library/Saved Application State/${channel.appId}.savedState`,
	]

	return `# frozen_string_literal: true

cask "${slug}" do
  version "${input.releaseVersion}"
  sha256 "${input.sha256}"

  url "${input.dmgUrl}"
  name "${productName}"
  desc "${channel.description}"
  homepage "https://humanlayer.dev/"

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "${productName}.app"
  binary "#{appdir}/${productName}.app/Contents/Resources/bin/riptided", target: "${channel.daemonTarget}"

  zap trash: [
${zapPaths.map((path) => `    "${path}",`).join('\n')}
  ]
end
`
}

function main(): void {
	const releaseType = process.env.RELEASE_TYPE as ReleaseType | undefined
	const releaseVersion = process.env.RELEASE_VERSION
	const sha256 = process.env.SHA256
	const dmgUrl = process.env.DMG_URL
	const outputDir = process.env.OUTPUT_DIR
	const missing = [
		['RELEASE_TYPE', releaseType],
		['RELEASE_VERSION', releaseVersion],
		['SHA256', sha256],
		['DMG_URL', dmgUrl],
		['OUTPUT_DIR', outputDir],
	]
		.filter(([, value]) => !value)
		.map(([name]) => name)

	if (missing.length > 0) {
		console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`)
		process.exit(1)
	}
	if (!releaseType || !Object.hasOwn(channelConfigs, releaseType)) {
		console.error(`ERROR: Invalid RELEASE_TYPE: ${releaseType}`)
		process.exit(1)
	}

	const input: GenerateCaskInput = {
		releaseType,
		releaseVersion: releaseVersion!,
		sha256: sha256!,
		dmgUrl: dmgUrl!,
		outputDir: outputDir!,
	}
	mkdirSync(input.outputDir, { recursive: true })
	const channel = channelConfigs[releaseType]
	const outputPath = join(input.outputDir, `${channel.caskSlug}.rb`)
	writeFileSync(outputPath, renderCask(input, channel.caskSlug))
	console.error(`Generated Electron cask: ${outputPath}`)
	console.log(`cask_path=${outputPath}`)
}

if (import.meta.main) main()
