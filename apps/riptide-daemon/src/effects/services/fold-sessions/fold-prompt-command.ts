import { Data } from 'effect'

export type FoldPromptCommand = Data.TaggedEnum<{
	Prompt: { readonly prompt: string }
	Compact: { readonly additionalInstructions: string | null }
}>

export const FoldPromptCommand = Data.taggedEnum<FoldPromptCommand>()

const compactCommand = /^\s*\/compact(?:\s+([\s\S]*))?$/

export const parseFoldPromptCommand = (prompt: string): FoldPromptCommand => {
	const match = compactCommand.exec(prompt)
	if (match === null) return FoldPromptCommand.Prompt({ prompt })

	const additionalInstructions = match[1]?.trim()
	return FoldPromptCommand.Compact({
		additionalInstructions:
			additionalInstructions === undefined || additionalInstructions.length === 0 ? null : additionalInstructions,
	})
}
