/**
 * Eval wrapper around the actual Context7 resolver.
 * Passes packageName and language from eval questions directly
 * to the real implementation.
 */

import { searchContext7WithResolution as resolveContext7 } from '../../src/agents/doc-researcher/context7-resolver'
import type { Context7EvalResult, EvalQuestion } from './types'

export async function searchContext7WithResolution(question: EvalQuestion): Promise<Context7EvalResult> {
	return resolveContext7(question.question, question.packageName, question.language)
}
