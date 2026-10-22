/**
 * Effective user+org merged settings returned by the daemon settings endpoint.
 * This file is kept separate to allow external imports without path alias dependencies.
 */
export interface EffectiveSettings {
	experimentalSubagentsEnabled: boolean
	haikuResearchSubagentsEnabled: boolean
	jiraEnabled: boolean
	linearEnabled: boolean
	// Per-org telemetry-collection opt-ins (Advanced Metrics rollout). Seeded into the daemon's
	// org-telemetry cache so the collector gates can consult the org's opt-in.
	commitTrackingEnabled: boolean
	prTrackingEnabled: boolean
}

export const DEFAULT_EFFECTIVE_SETTINGS: EffectiveSettings = {
	experimentalSubagentsEnabled: false,
	haikuResearchSubagentsEnabled: false,
	jiraEnabled: false,
	linearEnabled: false,
	commitTrackingEnabled: false,
	prTrackingEnabled: false,
}
