/**
 * Context7 Library Resolver
 * Uses AI to extract library name and select best match from search results.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'
import * as context7 from './context7-client'
import type { Context7Library } from './types'

const LibrarySelectionSchema = z.object({
	selectedIndex: z.number().describe('Index of the best matching library (0-based)'),
	reasoning: z.string().describe('Brief explanation of why this library was selected'),
})

// TODO needs better implementation prompt, also include package name and library carried through
async function selectBestLibrary(
	question: string,
	packageName: string,
	language: string,
	libraries: Context7Library[],
	model: LanguageModelV3,
): Promise<Context7Library> {
	if (libraries.length === 0) {
		throw new Error('No libraries found to select from')
	}
	if (libraries.length === 1) {
		const only = libraries[0]
		if (only === undefined) throw new Error('Missing library at index 0')
		return only
	}

	let selectedLibraries = libraries
	if (libraries.length > 20) selectedLibraries = libraries.slice(0, 20)
	const libraryList = selectedLibraries
		.map(
			(lib, i) =>
				`${i}. ${lib.title}: ${lib.description} (id: ${lib.id}, snippets: ${lib.totalSnippets ?? 'unknown'}, **trust score: ${lib.trustScore}**)`,
		)
		.join('\n')

	const prompt = `Given this question "${question}" for package/library ${packageName} in ${language},

Select the best library from this list to answer it:
${libraryList}

Choose the library most likely to have relevant documentation. Ensure to return the numerical index of the library`

	const { output } = await generateText({
		model,
		maxRetries: 0,
		prompt,
		output: Output.object({ schema: LibrarySelectionSchema }),
		providerOptions: { openai: { strictJsonSchema: false } },
	})

	console.log('Selected library', libraries[output.selectedIndex])

	const index = Math.min(Math.max(0, output.selectedIndex), libraries.length - 1)
	const selected = libraries[index]
	if (selected === undefined) throw new Error('Selected library index is out of range')
	return selected
}

export interface Context7ResolverResult {
	rawResponse: string
	selectedLibrary: Context7Library
	librariesConsidered: Context7Library[]
}

export async function searchContext7WithResolution(
	question: string,
	libraryName: string,
	language: string,
	{ model = resolveModel('sonnet') }: { model?: LanguageModelV3 } = {},
): Promise<Context7ResolverResult> {
	const searchResult = await context7.searchLibraries(question, libraryName)

	if (searchResult.results.length === 0) {
		return {
			rawResponse: 'No libraries found for this query.',
			selectedLibrary: { id: 'none', title: 'None' },
			librariesConsidered: [],
		}
	}

	const selectedLibrary = await selectBestLibrary(question, libraryName, language, searchResult.results, model)
	const rawResponse = await context7.getContext(question, selectedLibrary.id)

	return {
		rawResponse: typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse),
		selectedLibrary,
		librariesConsidered: searchResult.results,
	}
}
