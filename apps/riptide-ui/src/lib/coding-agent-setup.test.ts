import { describe, expect, test } from 'vitest'

import {
	CODING_AGENT_SETUP_VARIANTS,
	getCodingAgentSetupTarget,
	HUMANLAYER_CLI_INSTALL_COMMAND,
	isCodingAgentSetupAcknowledged,
} from './coding-agent-setup'

const host = { id: 'host-1', name: 'Build machine', isColocated: false }

describe('coding-agent setup variants', () => {
	test.each([
		['codelayer', 'codex', 'Codex', [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer agents auth codex login']],
		['fold', 'codex', 'Codex', [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer fold auth codex login']],
		['fold', 'xai', 'Grok', [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer fold auth xai login']],
	] as const)(
		'resolves %s + %s to its provider-specific setup recipe',
		(agent, provider, providerName, setupCommands) => {
			const target = getCodingAgentSetupTarget({ agent, provider, host })

			expect(target?.variant.providerName).toBe(providerName)
			expect(target?.variant.setupCommands).toEqual(setupCommands)
			expect(target?.host).toEqual(host)
		},
	)

	test('does not create notices for unsupported agent/provider combinations', () => {
		expect(getCodingAgentSetupTarget({ agent: 'claude', provider: 'anthropic', host })).toBeNull()
		expect(getCodingAgentSetupTarget({ agent: 'codelayer', provider: 'xai', host })).toBeNull()
	})

	test('scopes acknowledgement to both daemon host and setup variant', () => {
		const target = { variant: CODING_AGENT_SETUP_VARIANTS['fold:xai'], host }
		const acknowledgements = {
			'host-1': { 'fold:xai': true },
		}

		expect(isCodingAgentSetupAcknowledged(acknowledgements, target)).toBe(true)
		expect(
			isCodingAgentSetupAcknowledged(acknowledgements, {
				variant: CODING_AGENT_SETUP_VARIANTS['fold:codex'],
				host,
			}),
		).toBe(false)
		expect(
			isCodingAgentSetupAcknowledged(acknowledgements, {
				variant: CODING_AGENT_SETUP_VARIANTS['fold:xai'],
				host: { ...host, id: 'host-2' },
			}),
		).toBe(false)
	})
})
