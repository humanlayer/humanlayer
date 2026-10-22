import { describe, expect, test } from 'vitest'

import {
	getHumanLayerCliInstallCommand,
	getHumanLayerCliNpxCommand,
	getHumanLayerCliTarget,
	isHumanLayerCliStage,
} from './humanlayer-cli'

describe('HumanLayer CLI targets', () => {
	test.each([
		['prod', '@humanlayer/cli@latest', null],
		['beta', '@humanlayer/cli@beta', '--beta'],
		['dev', '@humanlayer/cli@dev', '--dev'],
		['local', '@humanlayer/cli@dev', '--local'],
	] as const)('maps %s to its package and environment flag', (stage, packageSpecifier, flag) => {
		expect(getHumanLayerCliTarget(stage)).toEqual({ packageSpecifier, environmentFlag: flag })
	})

	test('builds install and npx commands from the shared package mapping', () => {
		expect(getHumanLayerCliInstallCommand('beta')).toBe('npm install -g @humanlayer/cli@beta')
		expect(getHumanLayerCliNpxCommand('dev', 'agents auth')).toBe('npx @humanlayer/cli@dev agents auth')
	})

	test('recognizes only supported stages', () => {
		expect(isHumanLayerCliStage('prod')).toBe(true)
		expect(isHumanLayerCliStage('preview')).toBe(false)
		expect(isHumanLayerCliStage(undefined)).toBe(false)
	})
})
