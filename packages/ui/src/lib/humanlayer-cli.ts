const HUMANLAYER_CLI_TARGETS = {
	local: {
		packageSpecifier: '@humanlayer/cli@dev',
		environmentFlag: '--local',
	},
	dev: {
		packageSpecifier: '@humanlayer/cli@dev',
		environmentFlag: '--dev',
	},
	beta: {
		packageSpecifier: '@humanlayer/cli@beta',
		environmentFlag: '--beta',
	},
	prod: {
		packageSpecifier: '@humanlayer/cli@latest',
		environmentFlag: null,
	},
} as const

export type HumanLayerCliStage = keyof typeof HUMANLAYER_CLI_TARGETS

export function isHumanLayerCliStage(value: unknown): value is HumanLayerCliStage {
	return typeof value === 'string' && Object.hasOwn(HUMANLAYER_CLI_TARGETS, value)
}

export function getHumanLayerCliTarget(stage: HumanLayerCliStage) {
	return HUMANLAYER_CLI_TARGETS[stage]
}

export function getHumanLayerCliInstallCommand(stage: HumanLayerCliStage): string {
	return `npm install -g ${getHumanLayerCliTarget(stage).packageSpecifier}`
}

export function getHumanLayerCliNpxCommand(stage: HumanLayerCliStage, args: string): string {
	return `npx ${getHumanLayerCliTarget(stage).packageSpecifier} ${args}`
}
