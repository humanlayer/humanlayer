import type { Meta, StoryObj } from '@storybook/react'
import { MermaidDiagram } from './mermaid-diagram'

const meta = {
	title: 'Components/MermaidDiagram',
	component: MermaidDiagram,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-64 p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof MermaidDiagram>

export default meta
type Story = StoryObj<typeof meta>

export const Flowchart: Story = {
	args: {
		code: `graph TD
    A[Client] --> B[API]
    B --> C[DB]
    C --> B
    B --> A`,
	},
}

export const SequenceDiagram: Story = {
	args: {
		code: `sequenceDiagram
    Client->>API: Request
    API->>DB: Query
    DB-->>API: Result
    API-->>Client: Response`,
	},
}

export const ErrorState: Story = {
	args: { code: 'this is not valid mermaid syntax %%%' },
}

export const MultipleDiagrams: Story = {
	render: () => (
		<div className="space-y-4">
			<MermaidDiagram code="graph TD\nA-->B\nB-->C" />
			<MermaidDiagram code="graph TD\nX-->Y\nY-->Z" />
		</div>
	),
}
