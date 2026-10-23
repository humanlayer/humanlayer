import type { PermissionsMode } from '@humanlayer/ui/constants/permission-modes'
import type { Content } from '@tiptap/core'
import { useState } from 'react'

import {
	LauncherAgentControl,
	type LauncherAgentProviderOption,
	type LauncherAgentSelection,
} from '@/components/launcher-v3/controls/LauncherAgentControl'
import { LauncherDirectoryControl } from '@/components/launcher-v3/controls/LauncherDirectoryControl'
import { LauncherHostControl, type LauncherHostOption } from '@/components/launcher-v3/controls/LauncherHostControl'
import { LauncherPermissionControl } from '@/components/launcher-v3/controls/LauncherPermissionControl'
import { LauncherIdentity } from '@/components/launcher-v3/identity/LauncherIdentity'
import {
	LauncherTrayView,
	LauncherV3Submit,
	LauncherV3View,
	LauncherWorkflowSummary,
} from '@/components/launcher-v3/LauncherV3View'
import { LauncherProgress } from '@/components/launcher-v3/progress/LauncherProgress'
import { LauncherPrompt } from '@/components/launcher-v3/prompt/LauncherPrompt'

const WIDTHS = Array.from({ length: 14 }, (_, index) => 300 + index * 50)

const HOSTS = [
	{ id: 'local', label: 'Dexters MacBook Pro', isLocal: true },
	{ id: 'remote', label: 'Remote development host', isLocal: false },
] as const satisfies readonly LauncherHostOption[]

const AGENT_OPTIONS = [
	{
		agent: 'claude',
		agentLabel: 'Claude Code',
		provider: 'anthropic',
		models: [
			{
				value: 'opus',
				label: 'OPUS',
				effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
				defaultEffort: 'high',
			},
			{ value: 'sonnet', label: 'SONNET', effortLevels: ['low', 'medium', 'high'], defaultEffort: 'high' },
		],
	},
	{
		agent: 'codelayer',
		agentLabel: 'Codex',
		provider: 'codex',
		models: [
			{
				value: 'gpt-5.6-sol',
				label: 'GPT-5.6 Sol',
				effortLevels: ['low', 'medium', 'high'],
				defaultEffort: 'medium',
			},
		],
	},
] as const satisfies readonly LauncherAgentProviderOption[]

const RECENT_DIRECTORIES = ['/Users/dex/wt/syncopate/core-1725-inline-composer', '/Users/dex/repos/syncopate'] as const

function LauncherDirectoryControlShellDemo({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState('')
	const changeOpen = (nextOpen: boolean) => {
		setOpen(nextOpen)
		if (!nextOpen) setSearchValue('')
	}

	return (
		<LauncherDirectoryControl
			state={{ status: 'ready', useFilesystem: false, recentDirectories: RECENT_DIRECTORIES, projects: [] }}
			value={value}
			searchValue={searchValue}
			selectedProject={null}
			open={open}
			onOpenChange={changeOpen}
			onChange={setSearchValue}
			onConfirm={(nextValue) => {
				onChange(nextValue)
				changeOpen(false)
			}}
			onBlur={() => {
				if (searchValue) onChange(searchValue)
			}}
			onPickDirectory={() => {}}
			onSelectRecent={(nextValue) => {
				onChange(nextValue)
				changeOpen(false)
			}}
			onSelectProject={() => {}}
		/>
	)
}

export function LauncherV3ComposerShellDemo() {
	const [prompt, setPrompt] = useState<Content | null>(null)
	const [title, setTitle] = useState('Improve the V3 task composer')
	const [slug, setSlug] = useState('improve-v3-task-composer')
	const [hostId, setHostId] = useState<string | null>('local')
	const [directory, setDirectory] = useState<string>(RECENT_DIRECTORIES[0])
	const [agentSelection, setAgentSelection] = useState<LauncherAgentSelection>({
		agent: 'claude',
		provider: 'anthropic',
		model: 'opus',
		effort: 'high',
	})
	const [fastMode, setFastMode] = useState(false)
	const [permissionsMode, setPermissionsMode] = useState<PermissionsMode>('auto')

	return (
		<form aria-label="Launcher V3 width demo" onSubmit={(event) => event.preventDefault()}>
			<LauncherV3View>
				<LauncherIdentity
					key="identity"
					title={title}
					slug={slug}
					generating={false}
					onTitleChange={setTitle}
					onTitleBlur={() => {}}
					onSlugChange={setSlug}
					onSlugBlur={() => {}}
				/>
				<LauncherPrompt
					key="prompt"
					prompt={prompt}
					onPromptChange={setPrompt}
					onPromptBlur={() => {}}
					onSubmit={() => {}}
				/>
				<LauncherAgentControl
					key="agent"
					{...agentSelection}
					options={AGENT_OPTIONS}
					fastMode={fastMode}
					fastModeSupported
					onSelectAgentSettings={setAgentSelection}
					onFastModeChange={setFastMode}
					onBlur={() => {}}
				/>
				<LauncherTrayView key="tray">
					<LauncherPermissionControl
						key="permission"
						permissionsMode={permissionsMode}
						unavailableReasons={{}}
						onSelectPermissionsMode={setPermissionsMode}
						onBlur={() => {}}
					/>
					<LauncherHostControl
						key="host"
						state={{ status: 'available', hosts: HOSTS }}
						selectedHostId={hostId}
						isDesktopApp
						onSelectHost={setHostId}
						onOpenDaemonSettings={() => {}}
						onLaunchDesktopApp={() => {}}
						onDownloadDesktopApp={() => {}}
						onBlur={() => {}}
					/>
					<LauncherDirectoryControlShellDemo key="directory" value={directory} onChange={setDirectory} />
					<LauncherWorkflowSummary key="workflow" />
					<LauncherV3Submit key="submit" />
				</LauncherTrayView>
				<LauncherProgress
					key="progress"
					operations={[]}
					recovery={null}
					onRetry={() => {}}
					onSkip={() => {}}
					onReset={() => {}}
				/>
			</LauncherV3View>
		</form>
	)
}

export function LauncherV3WidthMatrixShellDemo() {
	return (
		<div className="h-screen w-full overflow-auto bg-background text-foreground">
			<div className="min-w-max space-y-10 p-6">
				{WIDTHS.map((width) => (
					<section key={width} aria-label={`${width}px composer`} style={{ width }}>
						<p className="mb-2 font-mono text-xs text-muted-foreground">{width}px</p>
						<div className="h-[560px] overflow-hidden border border-border">
							<LauncherV3ComposerShellDemo />
						</div>
					</section>
				))}
			</div>
		</div>
	)
}
