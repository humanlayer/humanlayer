import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { getHumanLayerCliInstallCommand } from '@humanlayer/ui/lib/humanlayer-cli'

import { buildConfig } from './config'

export const LEGACY_CODING_AGENT_SETUP_HOST_ID = '__legacy__'
export const HUMANLAYER_CLI_INSTALL_COMMAND = getHumanLayerCliInstallCommand(buildConfig.type)

export type CodingAgentSetupVariantKey = 'codelayer:codex' | 'fold:codex' | 'fold:xai' | 'claude:anthropic'

export interface CodingAgentSetupVariant {
	readonly id: CodingAgentSetupVariantKey
	readonly agent: CodingAgent
	readonly provider: string
	readonly providerName: string
	/** Provider the daemon can sign in to from the app. Absent means terminal commands only. */
	readonly signInProvider: 'claude' | 'codex' | null
	readonly setupCommands: readonly string[]
	readonly title: string
	readonly description: string
	readonly continueLabel: string
}

export const CODING_AGENT_SETUP_VARIANTS = {
	'codelayer:codex': {
		id: 'codelayer:codex',
		agent: 'codelayer',
		provider: 'codex',
		providerName: 'Codex',
		signInProvider: 'codex',
		setupCommands: [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer agents auth codex login'],
		title: 'Set up Codex',
		description:
			"Codex sessions use CodeLayer, HumanLayer's custom harness for durable, collaborative sessions over the network. Codex credentials are configured outside HumanLayer.",
		continueLabel: 'Continue with Codex',
	},
	'fold:codex': {
		id: 'fold:codex',
		agent: 'fold',
		provider: 'codex',
		providerName: 'Codex',
		signInProvider: 'codex',
		setupCommands: [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer fold auth codex login'],
		title: 'Set up Codex for Fold',
		description: 'Fold-backed Codex sessions need local Fold OAuth credentials on the daemon host.',
		continueLabel: 'Continue with Fold',
	},
	'fold:xai': {
		id: 'fold:xai',
		agent: 'fold',
		provider: 'xai',
		providerName: 'Grok',
		signInProvider: null,
		setupCommands: [HUMANLAYER_CLI_INSTALL_COMMAND, 'humanlayer fold auth xai login'],
		title: 'Set up Grok for Fold',
		description: 'Fold-backed Grok sessions need local xAI OAuth credentials on the daemon host.',
		continueLabel: 'Continue with Fold',
	},
} as const satisfies Partial<Record<CodingAgentSetupVariantKey, CodingAgentSetupVariant>>

/** Opened from a failed Claude session; not a launch guard, so it lives outside the variant map. */
export const CLAUDE_SIGN_IN_VARIANT: CodingAgentSetupVariant = {
	id: 'claude:anthropic',
	agent: 'claude',
	provider: 'anthropic',
	providerName: 'Claude',
	signInProvider: 'claude',
	setupCommands: ['claude /login'],
	title: 'Sign in to Claude',
	description: 'Claude Code sessions run with the Claude account signed in on the daemon host.',
	continueLabel: 'Done',
}

export interface CodingAgentSetupHost {
	readonly id: string
	readonly name: string
	readonly isColocated: boolean
}

export interface CodingAgentSetupTarget {
	readonly variant: CodingAgentSetupVariant
	readonly host: CodingAgentSetupHost
}

export type CodingAgentSetupAcknowledgements = Record<string, Partial<Record<CodingAgentSetupVariantKey, boolean>>>

export function getCodingAgentSetupVariant(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
): CodingAgentSetupVariant | null {
	const key = `${agent}:${provider}`
	if (key in CODING_AGENT_SETUP_VARIANTS) {
		return CODING_AGENT_SETUP_VARIANTS[key as keyof typeof CODING_AGENT_SETUP_VARIANTS]
	}
	return null
}

export function getCodingAgentSetupTarget(input: {
	readonly agent: CodingAgent | null | undefined
	readonly provider: string | null | undefined
	readonly host: CodingAgentSetupHost | null | undefined
}): CodingAgentSetupTarget | null {
	const variant = getCodingAgentSetupVariant(input.agent, input.provider)
	return variant && input.host ? { variant, host: input.host } : null
}

export function isCodingAgentSetupAcknowledged(
	acknowledgements: CodingAgentSetupAcknowledgements,
	target: CodingAgentSetupTarget,
): boolean {
	const hostAcknowledgement = acknowledgements[target.host.id]?.[target.variant.id]
	return hostAcknowledgement ?? acknowledgements[LEGACY_CODING_AGENT_SETUP_HOST_ID]?.[target.variant.id] ?? false
}
