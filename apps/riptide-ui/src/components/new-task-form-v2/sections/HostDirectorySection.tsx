/**
 * HostDirectorySection.tsx
 *
 * Section component for host selection and directory input in the NewTaskFormV2.
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Internalizes:
 * - Host selection state from newTaskFormStore (userSelectedHostId, setUserSelectedHostId)
 * - Available hosts from useLiveQuery via useAuth
 * - Host aliases from useHostAliases for formatHostName
 * - Default directory from settingsStore
 * - Recent directories from useRecentDirectories
 * - Colocated detection from useIsColocated
 * - Directory input component selection (filesystem-aware vs remote)
 *
 * Props that must be passed in:
 * - onHostChange: Needs parent coordination for lastUsedHostId and axis preferences
 * - onDirectoryBlur: Needs parent coordination for axis preferences
 * - setAsDefault/onSetAsDefaultChange: UI state managed in parent
 */

import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Field, FieldDescription, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { useAuth } from '@workos-inc/authkit-react'
import { Monitor } from 'lucide-react'
import { type FC, useCallback, useMemo } from 'react'
import { useWatch } from 'react-hook-form'

import { getOnlineHostKey } from '@/collections/online-host-key'
import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { isDesktop } from '@/lib/utils'

export interface DirectoryInputComponentProps {
	value?: string
	onChange?: (value: string) => void
	onBlur?: () => void
	placeholder?: string
	recentDirectories?: string[]
	className?: string
	disabled?: boolean
	autoFocus?: boolean
}

export interface HostDirectorySectionProps {
	// Host change callback (needs parent coordination for lastUsedHostId and axis preferences)
	onHostChange: (hostId: string) => void

	// Directory blur callback (needs parent coordination for axis preferences)
	onDirectoryBlur: () => void

	// Set as default state (UI state managed in parent)
	setAsDefault: boolean
	onSetAsDefaultChange: (value: boolean) => void
}

export const HostDirectorySection: FC<HostDirectorySectionProps> = ({
	onHostChange,
	onDirectoryBlur,
	setAsDefault,
	onSetAsDefaultChange,
}) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)

	// Get user from auth (for recent directories)
	const { user } = useAuth()

	// Settings store for default directory
	const defaultDirectory = useSettingsStore((s) => s.defaultDirectory)

	// Host aliases for display names
	const { data: aliases } = useHostAliases()

	// Effective host (shared derivation)
	const { availableHosts, hostId, isColocated, localHostId } = useEffectiveHost()
	const { guardSetup } = useCodingAgentSetupGuard()

	// Recent directories
	const recentDirectories = useRecentDirectories(hostId, user?.id)

	// Format host name with alias
	const formatHostName = useCallback(
		(host: { host_id: string; host_name: string | null }) => {
			const shortKey = host.host_id?.substring(0, 6) ?? 'unknown'
			const alias = aliases?.find((a) => a.hostId === host.host_id)
			if (alias) return `${alias.displayName} (${shortKey})`
			return host.host_name ? `${host.host_name} (${shortKey})` : shortKey
		},
		[aliases],
	)

	const directory = useWatch({ control: form?.control, name: 'directory' })
	const codingAgent = useWatch({ control: form?.control, name: 'codingAgent' })
	const provider = useWatch({ control: form?.control, name: 'provider' })
	const isSubmitting = submitState.isSubmitting

	const handleDirectoryChange = useCallback(
		(value: string) => {
			form?.setValue('directory', value, { shouldValidate: true })
		},
		[form],
	)

	const handleHostSelection = useCallback(
		(nextHostId: string) => {
			const nextHost = availableHosts.find((host) => host.host_id === nextHostId)
			if (!nextHost || (codingAgent !== 'codelayer' && codingAgent !== 'fold')) {
				onHostChange(nextHostId)
				return
			}
			guardSetup({
				agent: codingAgent,
				provider,
				host: {
					id: nextHostId,
					name: formatHostName(nextHost),
					isColocated: nextHostId === localHostId,
				},
				onContinue: () => onHostChange(nextHostId),
			})
		},
		[availableHosts, codingAgent, formatHostName, guardSetup, localHostId, onHostChange, provider],
	)

	const showSetAsDefaultCheckbox = directory !== '' && directory !== defaultDirectory
	const useFilesystemDir = isDesktop() && isColocated
	const hasMultipleHosts = availableHosts.length > 1

	// Remote directory input fallback
	const RemoteDirectoryInput: FC<DirectoryInputComponentProps> = useCallback(
		({ value, onChange, onBlur, placeholder }) => (
			<div>
				<Input
					placeholder={placeholder ?? 'Enter working directory path'}
					value={value ?? ''}
					onChange={(e) => onChange?.(e.target.value)}
					onBlur={onBlur}
					className="font-mono"
				/>
				{isDesktop() && !isColocated && (
					<p className="text-xs text-muted-foreground mt-1">
						This is a remote host. Directory auto-complete is not available.
					</p>
				)}
			</div>
		),
		[isColocated],
	)

	// todo - this is slightly less bad than using components as props but i still hate it
	const EffectiveDirectoryInput = useMemo(() => {
		if (useFilesystemDir) {
			return DirectorySearchInputWithFilesystem
		}
		return RemoteDirectoryInput
	}, [useFilesystemDir, RemoteDirectoryInput])

	if (!form) return null

	return (
		<>
			{/* Host picker - only shown when multiple hosts are available */}
			{hasMultipleHosts && (
				<div className="space-y-1">
					<label
						htmlFor="host-picker-select"
						className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"
					>
						<Monitor className="h-3 w-3" /> Host
					</label>
					<Select value={hostId} onValueChange={handleHostSelection}>
						<SelectTrigger id="host-picker-select" className="w-full">
							<SelectValue placeholder="Select a host..." />
						</SelectTrigger>
						<SelectContent>
							{availableHosts.map((host) => (
								<SelectItem key={getOnlineHostKey(host)} value={host.host_id}>
									{formatHostName(host)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{/* Directory field */}
			<Field>
				<FieldLabel>Directory</FieldLabel>
				<EffectiveDirectoryInput
					value={directory}
					onChange={handleDirectoryChange}
					onBlur={onDirectoryBlur}
					placeholder="Working directory..."
					recentDirectories={recentDirectories}
					disabled={isSubmitting}
				/>
				<FieldDescription>The repository or directory you want to work out of for this task</FieldDescription>
				{showSetAsDefaultCheckbox && (
					<div className="flex items-center gap-2 mt-1">
						<Checkbox
							id="v2-set-as-default-dir"
							checked={setAsDefault}
							onCheckedChange={(checked) => onSetAsDefaultChange(checked === true)}
							disabled={isSubmitting}
						/>
						<Label htmlFor="v2-set-as-default-dir" className="text-sm text-muted-foreground cursor-pointer">
							Set as default working directory for new tasks
						</Label>
					</div>
				)}
			</Field>
		</>
	)
}
