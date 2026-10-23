import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageLimitsRelevantToModel,
	usageWindowHasReset,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { ChevronDown, ChevronRight, ShieldAlert, ShieldCheck, Terminal, Zap } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'

import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { UsageBars } from '@/minimalist/components/UsageBars'
import {
	type Agent,
	AGENT_NAMES,
	CODEX_SIGN_IN,
	type ComposerSettings,
	effortLabel,
	type ModelCatalog,
	type ModelOption,
	modelLabel,
	pickModel,
	splitModels,
} from '@/minimalist/lib/models'
import { PERMISSION_MODES, permissionLabel } from '@/minimalist/lib/status'
import { useCopy } from '@/minimalist/lib/use-copy'

const AGENTS: Agent[] = ['claude', 'codelayer']

/**
 * The model pill and its menu: models grouped by agent, effort, Codex's fast mode, and Claude
 * usage on the host. With `onHandoff`, the session's agent is fixed and the other agent's
 * models start a hand-off instead of switching.
 */
export function ModelPicker({
	settings,
	onSettingsChange,
	catalog,
	usage,
	onHandoff,
	handoffBlocked,
}: {
	settings: ComposerSettings
	onSettingsChange: (settings: ComposerSettings) => void
	catalog: ModelCatalog
	/** The chosen host's Claude usage; the pill shows it once it matters. */
	usage?: { hostName: string; limits: ClaudeUsageLimits | null | undefined }
	onHandoff?: (model: ModelOption) => void
	/** Why the other agent's models can't be picked right now. */
	handoffBlocked?: string | null
}) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const [expanded, setExpanded] = useState<Agent[]>([])
	const selected = catalog.models.find((model) => model.value === settings.model)
	const claudeUsage = settings.agent === 'claude' ? usage : undefined
	return (
		<>
			<button type="button" ref={anchor} className="pill" onClick={() => setOpen(true)}>
				<b>{modelLabel(catalog.models, settings.model)}</b>
				{settings.effort ? effortLabel(settings.effort) : null}
				{settings.fastMode ? <Zap className="i sm" strokeWidth={1.6} aria-label="Fast mode" /> : null}
				<UsageMeter limits={claudeUsage?.limits} model={settings.model} />
				<ChevronDown className="i sm" />
			</button>
			<Menu
				anchor={anchor}
				open={open}
				onClose={() => {
					setOpen(false)
					setExpanded([])
				}}
				placement="above-end"
				width={300}
			>
				{AGENTS.map((agent) => {
					const models = catalog.models.filter((model) => model.agent === agent)
					const handoff = onHandoff !== undefined && agent !== settings.agent
					const needsSignIn = agent === 'codelayer' && catalog.codexSignedOut
					if (models.length === 0 && !needsSignIn) return null
					const { featured, more } = splitModels(models, settings.model)
					const showMore = expanded.includes(agent)
					return (
						<Fragment key={agent}>
							{agent === AGENTS[0] ? null : <MenuSeparator />}
							<MenuLabel>{handoff ? `Hand off to ${AGENT_NAMES[agent]}` : AGENT_NAMES[agent]}</MenuLabel>
							{handoff && handoffBlocked ? <div className="note">{handoffBlocked}</div> : null}
							{(showMore ? [...featured, ...more] : featured).map((model) => (
								<MenuItem
									key={model.value}
									label={model.label}
									checked={settings.model === model.value}
									disabled={handoff && Boolean(handoffBlocked)}
									onSelect={() => {
										if (!handoff) return onSettingsChange(pickModel(settings, model))
										setOpen(false)
										onHandoff?.(model)
									}}
								/>
							))}
							{more.length > 0 && !showMore ? (
								<MenuItem
									icon={<ChevronRight className="i sm" strokeWidth={1.6} />}
									label={`More ${AGENT_NAMES[agent]} models`}
									onSelect={() => setExpanded((current) => [...current, agent])}
								/>
							) : null}
							{needsSignIn ? (
								<CodexSetup hostName={usage?.hostName} onDone={() => setOpen(false)} />
							) : null}
						</Fragment>
					)
				})}
				{selected && selected.efforts.length > 0 ? (
					<>
						<MenuSeparator />
						<MenuLabel>
							{settings.effort ? 'Effort' : `Effort · ${AGENT_NAMES[selected.agent]} default`}
						</MenuLabel>
						<div className="seg fill effort">
							{selected.efforts.map((effort) => (
								<button
									type="button"
									key={effort}
									className={
										(settings.effort ?? selected.defaultEffort) === effort ? 'on' : undefined
									}
									aria-pressed={(settings.effort ?? selected.defaultEffort) === effort}
									onClick={() => onSettingsChange({ ...settings, effort })}
								>
									{effortLabel(effort)}
								</button>
							))}
						</div>
					</>
				) : null}
				{selected?.fastMode ? (
					<MenuItem
						icon={<Zap className="i sm" strokeWidth={1.6} />}
						label="Fast mode"
						checked={settings.fastMode}
						onSelect={() => onSettingsChange({ ...settings, fastMode: !settings.fastMode })}
					/>
				) : null}
				{claudeUsage ? (
					<>
						<MenuSeparator />
						<MenuLabel>Claude usage on {claudeUsage.hostName}</MenuLabel>
						<UsageBars limits={claudeUsage.limits} />
					</>
				) : null}
			</Menu>
		</>
	)
}

/** Sign-in help accompanies the bundled models when the host reports an auth failure. */
function CodexSetup({ hostName, onDone }: { hostName: string | undefined; onDone: () => void }) {
	const copy = useCopy()
	const where = hostName ?? 'the host'
	return (
		<MenuItem
			icon={<Terminal className="i sm" strokeWidth={1.6} />}
			label="Set up Codex"
			onSelect={() => {
				onDone()
				copy(
					CODEX_SIGN_IN,
					`Copied. Run it on ${where} to sign in to Codex.`,
					`Could not copy. Run ${CODEX_SIGN_IN} on ${where}.`,
				)
			}}
		/>
	)
}

/** Quiet until half the tightest window for this model is gone; amber past 80%, as the color rules ask. */
function UsageMeter({ limits, model }: { limits: ClaudeUsageLimits | null | undefined; model: string }) {
	const worst = mostConstrainedUsageWindow(usageLimitsRelevantToModel(limits, model))
	if (!worst || usageWindowHasReset(worst.window) || worst.window.used_percent < 50) return null
	const used = Math.min(100, worst.window.used_percent)
	return (
		<span
			className={`meter pill-meter${used >= 80 ? ' high' : ''}`}
			title={`${Math.round(used)}% of Claude usage used`}
			aria-label={`${Math.round(used)}% of Claude usage used`}
		>
			<i style={{ width: `${used}%` }} />
		</span>
	)
}

/** How actions get approved. Codex always runs without asking, and Auto needs a model that offers it. */
export function PermissionPicker({
	settings,
	onSettingsChange,
	autoMode,
}: {
	settings: ComposerSettings
	onSettingsChange: (settings: ComposerSettings) => void
	autoMode: boolean
}) {
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const bypass = settings.permissionsMode === 'bypass'
	const codex = settings.agent === 'codelayer'
	return (
		<>
			<button type="button" ref={anchor} className="pill" onClick={() => setOpen(true)}>
				{bypass ? (
					<ShieldAlert className="i sm caution" strokeWidth={1.6} />
				) : (
					<ShieldCheck className="i sm" strokeWidth={1.6} />
				)}
				<span className={bypass ? 'caution' : undefined}>{permissionLabel(settings.permissionsMode)}</span>
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="above-start" width={300}>
				<MenuLabel>{codex ? 'Codex always runs without asking' : 'How should actions be approved?'}</MenuLabel>
				{PERMISSION_MODES.map((mode) => (
					<MenuItem
						key={mode.value}
						label={<span className={mode.value === 'bypass' ? 'caution' : undefined}>{mode.label}</span>}
						detail={
							mode.value === 'auto' && !autoMode && !codex
								? 'Not available with this model'
								: mode.description
						}
						checked={settings.permissionsMode === mode.value}
						disabled={codex ? mode.value !== 'bypass' : mode.value === 'auto' && !autoMode}
						onSelect={() => {
							onSettingsChange({ ...settings, permissionsMode: mode.value })
							setOpen(false)
						}}
					/>
				))}
			</Menu>
		</>
	)
}
