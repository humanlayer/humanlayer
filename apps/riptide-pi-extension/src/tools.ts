// The HumanLayer tools riptide-daemon gives its agents (plan-part-2.md phase 1), as pi tools. The
// tools themselves are @humanlayer/session-sdk-tools'; this turns their parameters into TypeBox
// schemas and registers them with pi.

import { type TSchema, Type } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { HUMANLAYER_TOOLS, type Param, runTool, TOOLS, type ToolTarget } from '@humanlayer/session-sdk-tools'

import { daemonCall } from './api.ts'

export {
	formatArtifactComments,
	formatDiffComments,
	HUMANLAYER_TOOLS,
	type ToolTarget,
} from '@humanlayer/session-sdk-tools'

function typeBox(p: Param): TSchema {
	const { optional: _optional, type, ...rest } = p
	if (type === 'string') return Type.String(rest)
	if (type === 'boolean') return Type.Boolean(rest)
	if (type === 'true') return Type.Literal(true, rest)
	if (type === 'integer') return Type.Integer(rest)
	const { items, ...array } = rest as {
		items?: Record<string, string | number>
		minItems?: number
		description: string
	}
	return Type.Array(Type.String(items), array)
}

function parameters(params: Record<string, Param>): TSchema {
	const shape = Object.fromEntries(
		Object.entries(params).map(([name, p]) => [name, p.optional ? Type.Optional(typeBox(p)) : typeBox(p)]),
	)
	return Type.Object(shape)
}

/**
 * Registers the tools. `target` names the bound task at call time. Tools are registered once and
 * switched on or off with syncTools() as the session links to a task or stops mirroring.
 */
export function registerHumanlayerTools(pi: ExtensionAPI, target: () => ToolTarget): void {
	for (const name of HUMANLAYER_TOOLS) {
		const { description, params } = TOOLS[name]
		pi.registerTool({
			name,
			label: name.replaceAll('_', ' '),
			description,
			parameters: parameters(params),
			// A reply reopens its thread, so a reply and a resolve in one turn must land in order.
			executionMode: 'sequential',
			async execute(_id, input, signal) {
				const text = await runTool(name, input, target, daemonCall, signal)
				return { content: [{ type: 'text', text }], details: undefined }
			},
		})
	}
}

/** Turns the tools on while `on`, off otherwise, leaving every other tool as it is. */
export function syncTools(pi: ExtensionAPI, on: boolean): void {
	const active = pi.getActiveTools()
	const ours = new Set<string>(HUMANLAYER_TOOLS)
	const has = active.some((t) => ours.has(t))
	if (on === has) return
	pi.setActiveTools(on ? [...active, ...HUMANLAYER_TOOLS] : active.filter((t) => !ours.has(t)))
}
