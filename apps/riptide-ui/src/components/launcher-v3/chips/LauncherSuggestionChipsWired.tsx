import { Option, Schema } from 'effect'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useTaskFormV3SuggestionsStore } from '@/hooks/stores/taskFormV3SuggestionsStore'
import { useConnectIntegrationAction, type ConnectableIntegration } from '@/hooks/useConnectIntegrationAction'
import { useGitHubIssuePreviewSource } from '@/hooks/useGitHubIssuePreviewSource'

import { LauncherSuggestionChips, type LauncherSuggestionChip } from './LauncherSuggestionChips'

export interface LauncherSuggestionChipsWiredProps {
	disabled?: boolean
}

const CONNECT_CHIP_IDS = ['connect-linear', 'connect-github', 'connect-jira'] as const
const ConnectChipId = Schema.Literals(CONNECT_CHIP_IDS)
const CONNECT_CHIP_INTEGRATIONS: Record<(typeof CONNECT_CHIP_IDS)[number], ConnectableIntegration> = {
	'connect-linear': 'linear',
	'connect-github': 'github',
	'connect-jira': 'jira',
}

const noop = () => {}

export function LauncherSuggestionChipsWired({ disabled }: LauncherSuggestionChipsWiredProps) {
	const connectIntegration = useConnectIntegrationAction()
	const linearEnabled = useSettingsStore((state) => state.linearEnabled)
	const linearNeedsReauth = useSettingsStore((state) => state.linearNeedsReauth)
	const jiraEnabled = useSettingsStore((state) => state.jiraEnabled)
	const jiraNeedsReauth = useSettingsStore((state) => state.jiraNeedsReauth)
	const dismissedSuggestionIds = useTaskFormV3SuggestionsStore((state) => state.dismissedSuggestionIds)
	const dismissSuggestion = useTaskFormV3SuggestionsStore((state) => state.dismissSuggestion)
	const github = useGitHubIssuePreviewSource({ enabled: true, issueInput: '', setIssueInput: noop })

	const availableChips: LauncherSuggestionChip[] = []
	if (linearNeedsReauth || !linearEnabled) {
		availableChips.push({
			id: 'connect-linear',
			label: linearNeedsReauth ? 'Reconnect Linear' : 'Connect Linear',
			kind: 'integration',
		})
	}
	if (!github.isLoadingRepositories && !github.isEnabled) {
		availableChips.push({ id: 'connect-github', label: 'Connect GitHub', kind: 'integration' })
	}
	if (jiraNeedsReauth || !jiraEnabled) {
		availableChips.push({
			id: 'connect-jira',
			label: jiraNeedsReauth ? 'Reconnect Jira' : 'Connect Jira',
			kind: 'integration',
		})
	}

	const dismissedSuggestions = new Set(dismissedSuggestionIds)
	const chips = availableChips.filter((chip) => !dismissedSuggestions.has(chip.id))

	const selectChip = (chipId: string) => {
		const connectChipId = Option.getOrUndefined(Schema.decodeUnknownOption(ConnectChipId)(chipId))
		if (connectChipId !== undefined) void connectIntegration(CONNECT_CHIP_INTEGRATIONS[connectChipId])
	}

	return (
		<LauncherSuggestionChips
			chips={chips}
			disabled={disabled}
			onSelectChip={selectChip}
			onDismissChip={dismissSuggestion}
		/>
	)
}
