import type { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'

export const electronChannels = ['local', 'dev', 'beta', 'prod'] as const

export const protocolSchemesByChannel = {
	local: ['humanlayer-electron-local'],
	dev: ['humanlayer-electron-dev'],
	beta: ['humanlayer-electron-beta'],
	prod: ['humanlayer-electron'],
} as const satisfies Record<DaemonStage, ReadonlyArray<string>>

export function channelFromProductName(productName: string): DaemonStage {
	if (productName === 'HumanLayerElectronDev') return 'dev'
	if (productName === 'HumanLayerElectronBeta') return 'beta'
	if (productName === 'HumanLayerElectron') return 'prod'
	return 'local'
}

export function resolveChannel(input: {
	readonly isPackaged: boolean
	readonly productName: string
	readonly environmentChannel: string | undefined
}): DaemonStage {
	if (input.isPackaged) return channelFromProductName(input.productName)
	const environmentChannel = electronChannels.find((candidate) => candidate === input.environmentChannel)
	return environmentChannel ?? channelFromProductName(input.productName)
}
