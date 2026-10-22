const { writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const updaterConfigByChannel = require('../src/config/updater-channels.json')

function updaterConfigForProductName(productName) {
	const updaterConfig = Object.values(updaterConfigByChannel).find((config) => config.productName === productName)
	if (updaterConfig === undefined) {
		throw new Error(`Unsupported Electron product name: ${productName}`)
	}
	return updaterConfig
}

function appUpdateManifestForProductName(productName) {
	const updaterConfig = updaterConfigForProductName(productName)
	return [
		'provider: generic',
		`url: ${updaterConfig.url}`,
		`updaterCacheDirName: ${updaterConfig.updaterCacheDirName}`,
		'',
	].join('\n')
}

async function afterPack(context) {
	if (context.electronPlatformName !== 'darwin') return

	const manifestPath = join(context.packager.getResourcesDir(context.appOutDir), 'app-update.yml')
	await writeFile(manifestPath, appUpdateManifestForProductName(context.packager.appInfo.productName))
}

exports.default = afterPack
exports.appUpdateManifestForProductName = appUpdateManifestForProductName
