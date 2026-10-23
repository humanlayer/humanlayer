import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModelV3 } from '@ai-sdk/provider'

export interface MatrixEntry {
	label: string
	model: LanguageModelV3
}

export interface MatrixSpec {
	anthropic: { label: string; modelId: string }
	openai: { label: string; modelId: string }
}

export function buildMatrix(spec: MatrixSpec): ReadonlyArray<MatrixEntry> {
	const candidates: ReadonlyArray<{ entry: MatrixEntry; envVar: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' }> = [
		{
			entry: { label: spec.anthropic.label, model: anthropic(spec.anthropic.modelId) as LanguageModelV3 },
			envVar: 'ANTHROPIC_API_KEY',
		},
		{
			entry: { label: spec.openai.label, model: openai(spec.openai.modelId) as LanguageModelV3 },
			envVar: 'OPENAI_API_KEY',
		},
	]
	return candidates.filter(({ envVar }) => !!process.env[envVar]).map(({ entry }) => entry)
}
