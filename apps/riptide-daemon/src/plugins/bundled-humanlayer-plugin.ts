import pluginJson from '../../../riptide-humanlayer-claude-plugin/.claude-plugin/plugin.json' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateAutoAdvanceReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/auto-advance.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateHostsReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/hosts.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateLaunchSessionReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/launch-session.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateLaunchTaskReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/launch-task.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateListTasksReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/list-tasks.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateLoginReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/login.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateManagingArtifactsReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/managing-artifacts-and-files.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateTaskPrsReference from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/references/task-prs.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import orchestrateSkill from '../../../riptide-humanlayer-claude-plugin/skills/orchestrate/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import showMeSkill from '../../../riptide-humanlayer-claude-plugin/skills/show-me/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import teleportSecretsReference from '../../../riptide-humanlayer-claude-plugin/skills/teleport/references/secrets.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import teleportSystemdReference from '../../../riptide-humanlayer-claude-plugin/skills/teleport/references/systemd.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import teleportSkill from '../../../riptide-humanlayer-claude-plugin/skills/teleport/SKILL.md' with { type: 'file' }
import { parseBundledFilePath, readBundledPluginManifest } from './bundled-file'

const manifest = await readBundledPluginManifest(pluginJson)

export const HUMANLAYER_PLUGIN_VERSION = manifest.version

export const humanlayerEmbeddedFiles = {
	'.claude-plugin/plugin.json': parseBundledFilePath(pluginJson),
	'skills/orchestrate/SKILL.md': orchestrateSkill,
	'skills/orchestrate/references/auto-advance.md': orchestrateAutoAdvanceReference,
	'skills/orchestrate/references/hosts.md': orchestrateHostsReference,
	'skills/orchestrate/references/launch-session.md': orchestrateLaunchSessionReference,
	'skills/orchestrate/references/launch-task.md': orchestrateLaunchTaskReference,
	'skills/orchestrate/references/list-tasks.md': orchestrateListTasksReference,
	'skills/orchestrate/references/login.md': orchestrateLoginReference,
	'skills/orchestrate/references/managing-artifacts-and-files.md': orchestrateManagingArtifactsReference,
	'skills/orchestrate/references/task-prs.md': orchestrateTaskPrsReference,
	'skills/show-me/SKILL.md': showMeSkill,
	'skills/teleport/SKILL.md': teleportSkill,
	'skills/teleport/references/secrets.md': teleportSecretsReference,
	'skills/teleport/references/systemd.md': teleportSystemdReference,
}
