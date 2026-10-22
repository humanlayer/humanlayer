/**
 * Doc Researcher Agent
 *
 * Researches library documentation using multiple sources (Exa, Context7)
 * and synthesizes source-agnostic answers using AI orchestration.
 */

// Lower-level APIs (for testing/advanced use)
export { fetchDocumentation } from './dual-source-fetcher'
export { formatSearchResults } from './format-results'
// Main API
export { researchDocumentation } from './orchestrator'
// Types
export type { DocumentationResearchResult, DualSourceResult, ResearchDocumentationInput } from './types'
