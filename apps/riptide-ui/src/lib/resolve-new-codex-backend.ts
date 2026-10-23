import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

export function resolveNewCodexBackend(input: {
	readonly codingAgent: CodingAgent
	readonly useFoldCodingAgent: boolean
}): CodingAgent {
	return input.codingAgent === 'codelayer' && input.useFoldCodingAgent ? 'fold' : input.codingAgent
}

export function resolveNewSessionFastMode(input: {
	readonly codingAgent: CodingAgent
	readonly fastMode: boolean | null | undefined
	readonly useFoldCodingAgent: boolean
}): boolean {
	return resolveNewCodexBackend(input) === 'fold' ? false : (input.fastMode ?? false)
}
