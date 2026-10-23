import { normalizeRepositoryIdentity, repositoryNameFromIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { SettingsGroup } from '@/minimalist/components/SettingsControls'
import { useHosts } from '@/minimalist/lib/data'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'
import { invalidateProjectsV2 } from '@/queries/projects-v2'

/**
 * One repository, where it already lives, and what each worktree needs. More
 * repositories and per-host paths live in the project's settings afterwards.
 */
export function AddProjectPage() {
	const { client: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const { showToast } = useUi()
	const action = useAction()
	const { hosts } = useHosts()
	const [remote, setRemote] = useState('')
	const [name, setName] = useState('')
	const [branch, setBranch] = useState('main')
	const [hostId, setHostId] = useState<string | null>(null)
	const [path, setPath] = useState('')
	const [copy, setCopy] = useState('')
	const [setup, setSetup] = useState('')
	const [shared, setShared] = useState(false)

	const identity = normalizeRepositoryIdentity(remote)
	const derivedName = identity ? repositoryNameFromIdentity(identity) : ''
	const host =
		hosts.find((entry) => entry.host.host_id === hostId) ?? hosts.find((entry) => entry.online) ?? hosts[0] ?? null
	const remoteError = remote.trim() && !identity ? 'Use a Git remote such as git@github.com:acme/app.git' : null
	const ready = Boolean(identity && branch.trim() && (name.trim() || derivedName))

	const submit = () => {
		if (!identity || !ready || action.pending) return
		void action.run(async () => {
			const { project } = await api.projects.v2.create({
				name: name.trim() || derivedName,
				private: !shared,
				repositories: [
					{
						remoteUrl: remote.trim(),
						repositoryIdentity: identity,
						defaultBranch: branch.trim(),
						default: true,
						autoPushBranch: false,
						copyGlobs: copy
							.split(',')
							.map((glob) => glob.trim())
							.filter(Boolean),
						setupCommand: setup.trim() || undefined,
					},
				],
				hostId: host && path.trim() ? host.host.host_id : undefined,
				repositoryPaths: host && path.trim() ? { [identity]: path.trim() } : undefined,
			})
			await invalidateProjectsV2(queryClient)
			showToast(`Added ${project.name}`)
			void navigate({ to: '/', search: { project: project.id } })
		}, 'Could not add the project. Check the remote and try again.')
	}

	return (
		<form
			className="addproj"
			onSubmit={(event) => {
				event.preventDefault()
				submit()
			}}
			onKeyDown={(event) => {
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
					event.preventDefault()
					submit()
				}
			}}
		>
			<p className="settings-lede">
				Each task in a project gets its own worktree and branch, so the agent never edits your checkout.
			</p>
			<SettingsGroup>
				<Field
					label="Repository"
					hint={remoteError ?? 'The Git remote the agent pushes to'}
					error={Boolean(remoteError)}
				>
					<input
						autoFocus
						spellCheck={false}
						placeholder="git@github.com:acme/app.git"
						value={remote}
						onChange={(event) => setRemote(event.target.value)}
					/>
				</Field>
				<Field label="Name">
					<input
						placeholder={derivedName || 'app'}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Field label="Base branch" hint="New task branches start from here">
					<input spellCheck={false} value={branch} onChange={(event) => setBranch(event.target.value)} />
				</Field>
			</SettingsGroup>
			<SettingsGroup title="Existing checkout">
				<Field label="Host">
					<select
						className="select"
						value={host?.host.host_id ?? ''}
						onChange={(event) => setHostId(event.target.value)}
						disabled={hosts.length === 0}
					>
						{hosts.length === 0 ? <option value="">No hosts yet</option> : null}
						{hosts.map((entry) => (
							<option key={entry.host.host_id} value={entry.host.host_id}>
								{entry.name}
								{entry.online ? '' : ' (offline)'}
							</option>
						))}
					</select>
				</Field>
				<Field label="Path" hint="Optional. Leave blank and the host clones the repository when a task starts.">
					<input
						spellCheck={false}
						placeholder="~/code/app"
						value={path}
						onChange={(event) => setPath(event.target.value)}
					/>
				</Field>
			</SettingsGroup>
			<SettingsGroup title="Each new worktree">
				<Field label="Copy files" hint="Comma-separated, for example .env, .env.local">
					<input
						spellCheck={false}
						placeholder=".env"
						value={copy}
						onChange={(event) => setCopy(event.target.value)}
					/>
				</Field>
				<Field label="Setup command" hint="Runs before the agent starts">
					<input
						spellCheck={false}
						placeholder="bun install"
						value={setup}
						onChange={(event) => setSetup(event.target.value)}
					/>
				</Field>
			</SettingsGroup>
			<div className="addproj-foot">
				<label className="check-row">
					<input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
					Visible to your organization
				</label>
				<span className="sp" />
				<button type="button" className="btn ghost" onClick={() => void navigate({ to: '/settings/projects' })}>
					Cancel
				</button>
				<button type="submit" className="btn primary" disabled={!ready || action.pending}>
					Add project <span className="kbd inv">⌘⏎</span>
				</button>
			</div>
		</form>
	)
}

function Field({
	label,
	hint,
	error,
	children,
}: {
	label: string
	hint?: string
	error?: boolean
	children: React.ReactNode
}) {
	return (
		<label className="frow">
			<span className="l">
				<b>{label}</b>
				{hint ? <span className={error ? 'err' : undefined}>{hint}</span> : null}
			</span>
			{children}
		</label>
	)
}
