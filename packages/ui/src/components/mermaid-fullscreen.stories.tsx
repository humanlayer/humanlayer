import type { Meta, StoryObj } from '@storybook/react'
import { MermaidDiagram } from './mermaid-diagram'

const meta: Meta<typeof MermaidDiagram> = {
	title: 'Shell Demos/MermaidFullscreen',
	component: MermaidDiagram,
	parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof meta>

const COMPLEX_FLOWCHART = `flowchart TD
    subgraph Client
        A[User] --> B[Browser]
        B --> C[React App]
    end

    subgraph API Layer
        C --> D[API Gateway]
        D --> E[Auth Service]
        D --> F[Task Service]
        D --> G[Session Service]
    end

    subgraph Data Layer
        E --> H[(User DB)]
        F --> I[(Task DB)]
        G --> J[(Session DB)]
    end

    subgraph External
        F --> K[Claude API]
        G --> L[Electric SQL]
    end`

const ConstrainedWidthDemo = () => {
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				This demonstrates a diagram constrained to a narrow width (like a comment gutter). Click the
				fullscreen button to view at full size.
			</p>
			<div className="w-64 border-r pr-4">
				<MermaidDiagram code={COMPLEX_FLOWCHART} />
			</div>
		</div>
	)
}

export const ConstrainedWidth: Story = {
	render: () => <ConstrainedWidthDemo />,
}
