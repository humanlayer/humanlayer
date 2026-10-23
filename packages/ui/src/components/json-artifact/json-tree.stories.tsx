import type { Meta, StoryObj } from '@storybook/react'

import { JsonArtifactView } from './json-artifact-view'
import { MAX_STRUCTURED_NODES, MAX_STRUCTURED_SOURCE_BYTES } from './json-tree-model'

const meta = {
	title: 'Components/JSON Artifact View',
	component: JsonArtifactView,
	parameters: { layout: 'fullscreen' },
	decorators: [(Story) => <div className="h-dvh bg-background p-6 text-foreground"><Story /></div>],
} satisfies Meta<typeof JsonArtifactView>

export default meta
type Story = StoryObj<typeof meta>

export const ObjectValue: Story = {
	args: { content: JSON.stringify({ service: 'riptide', healthy: true, ports: [3000, 5174], owner: null }, null, 2) },
}

export const ArrayValue: Story = {
	args: { content: JSON.stringify([{ id: 1, state: 'ready' }, { id: 2, state: 'running' }], null, 2) },
}

export const ScalarValue: Story = { args: { content: '"structured scalar"' } }
export const InvalidJson: Story = { args: { content: '{ "status": ready }\n' } }

let deepValue: unknown = 'leaf'
for (let depth = 0; depth < 24; depth++) deepValue = { child: deepValue }
export const DeepJson: Story = { args: { content: JSON.stringify(deepValue) } }

export const GuardedSource: Story = {
	args: { content: `"${'x'.repeat(MAX_STRUCTURED_SOURCE_BYTES)}"` },
}

export const FiftyThousandNodeStress: Story = {
	args: { content: JSON.stringify(Array.from({ length: MAX_STRUCTURED_NODES - 1 }, (_, index) => index)) },
}

export const JsonlValidRecords: Story = {
	args: { kind: 'jsonl', content: '{"event":"start","at":1}\n{"event":"finish","at":2}\n' },
}

export const JsonlMixedValidity: Story = {
	args: { kind: 'jsonl', content: '{"event":"start"}\nnot-json\n\n42\nnull\n{"event":"finish"}\n' },
}

export const JsonlBlankLine: Story = {
	args: { kind: 'jsonl', content: '{"first":true}\n\n{"third":true}\n' },
}

export const JsonlScalarRecords: Story = {
	args: { kind: 'jsonl', content: '"text"\n42\nfalse\nnull\n' },
}

export const GuardedJsonl: Story = {
	args: { kind: 'jsonl', content: `${'x'.repeat(MAX_STRUCTURED_SOURCE_BYTES + 1)}\n` },
}
