import type { AgentOption } from './agents'

export const PERMISSION_MODES = ['default', 'accept_edits', 'auto', 'bypass'] as const
export type PermissionsMode = (typeof PERMISSION_MODES)[number]

export interface LaunchPermissionModeOption {
  value: PermissionsMode
  label: string
  description: string
}

export const LAUNCH_PERMISSION_MODE_MENU_LABEL = 'How should actions be approved?'

/** Task-launch copy and ordering from the prompt-first launcher design. */
export const LAUNCH_PERMISSION_MODE_OPTIONS: readonly LaunchPermissionModeOption[] = [
  { value: 'bypass', label: 'Bypass permissions', description: 'Run without asking for approval' },
  { value: 'default', label: 'Manual', description: 'Ask before tools make changes or run commands' },
  { value: 'auto', label: 'Auto', description: 'Approve routine actions and ask when needed' },
  { value: 'accept_edits', label: 'Accept Edits', description: 'Allow file edits but ask for other actions' },
] as const

export interface AgentPermissionModeConstraint {
  requiredMode: PermissionsMode
  unavailableReason: string
}

/** CodeLayer handles approvals internally and therefore always launches in bypass mode. */
export function getAgentPermissionModeConstraint(agent: AgentOption): AgentPermissionModeConstraint | null {
  return agent === 'codelayer'
    ? {
        requiredMode: 'bypass',
        unavailableReason: 'CodeLayer sessions always bypass permissions',
      }
    : null
}

export function resolvePermissionsModeForAgent(agent: AgentOption, mode: PermissionsMode): PermissionsMode {
  return getAgentPermissionModeConstraint(agent)?.requiredMode ?? mode
}

// Subset shown in the permission-mode dropdown selector. Bypass is owned by its
// dedicated `BypassButton` + confirmation dialog and is therefore excluded here.
export type PermissionsModeNoBypass = Exclude<PermissionsMode, 'bypass'>

export interface PermissionModeOption {
  value: PermissionsModeNoBypass
  label: string
  description: string
}

export const PERMISSION_MODE_OPTIONS: readonly PermissionModeOption[] = [
  { value: 'default', label: 'Default', description: 'Allow Read only' },
  {
    value: 'accept_edits',
    label: 'Accept Edits',
    description: 'Allow reads, file edits, and common filesystem commands',
  },
  { value: 'auto', label: 'Auto', description: 'Runs without asking, with background safety checks' },
] as const

export const PERMISSION_MODE_LABELS: Record<PermissionsModeNoBypass, string> = Object.fromEntries(
  PERMISSION_MODE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PermissionsModeNoBypass, string>
