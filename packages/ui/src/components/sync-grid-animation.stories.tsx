import type { Meta, StoryObj } from '@storybook/react'
import { MessageCircle, Settings } from 'lucide-react'
import { SyncGridAnimation } from './sync-grid-animation'

const meta = {
	title: 'Components/SyncGridAnimation',
	component: SyncGridAnimation,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		variant: {
			control: 'select',
			options: ['fill', 'snake', 'ring'],
		},
		size: {
			control: 'select',
			options: ['xs', 'sm', 'md', 'lg', 'xl'],
		},
		speed: {
			control: { type: 'range', min: 50, max: 400, step: 10 },
		},
		gridSize: {
			control: { type: 'range', min: 3, max: 7, step: 1 },
		},
		synchronized: {
			control: 'boolean',
		},
	},
} satisfies Meta<typeof SyncGridAnimation>

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Interactive playground
// ---------------------------------------------------------------------------

export const Default: Story = {
	args: {
		variant: 'snake',
		size: 'lg',
		speed: 150,
	},
}

// ---------------------------------------------------------------------------
// Variant comparison
// ---------------------------------------------------------------------------

export const Variants: Story = {
	render: () => (
		<div className="flex flex-col gap-8">
			<div className="text-sm font-mono text-muted-foreground">Fill vs Snake vs Ring</div>
			<div className="flex gap-12 items-end">
				<Label label="fill">
					<SyncGridAnimation variant="fill" size="xl" speed={150} />
				</Label>
				<Label label="snake">
					<SyncGridAnimation variant="snake" size="xl" speed={150} />
				</Label>
				<Label label="ring (gradient trail)">
					<SyncGridAnimation variant="ring" size="xl" />
				</Label>
			</div>
		</div>
	),
}

// ---------------------------------------------------------------------------
// All sizes
// ---------------------------------------------------------------------------

export const Sizes: Story = {
	render: () => (
		<div className="flex flex-col gap-8">
			<div className="text-sm font-mono text-muted-foreground">Sizes: xs - xl</div>
			<div className="flex gap-8 items-end">
				{(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
					<Label key={s} label={s}>
						<SyncGridAnimation variant="snake" size={s} speed={150} />
					</Label>
				))}
			</div>
		</div>
	),
}

// ---------------------------------------------------------------------------
// Grid sizes (outer grid with faint surrounding dots)
// ---------------------------------------------------------------------------

export const GridSizes: Story = {
	render: () => (
		<div className="flex flex-col gap-8">
			<div className="text-sm font-mono text-muted-foreground">Outer grid sizes (animated 3x3 centered within)</div>
			<div className="flex gap-12 items-end">
				{[3, 4, 5, 6].map((gs) => (
					<Label key={gs} label={`${gs}x${gs}`}>
						<SyncGridAnimation variant="snake" size="xl" speed={150} gridSize={gs} />
					</Label>
				))}
			</div>
		</div>
	),
}

// ---------------------------------------------------------------------------
// Synchronized: all instances share the same wall-clock phase
// ---------------------------------------------------------------------------

export const Synchronized: Story = {
	render: () => (
		<div className="flex flex-col gap-8">
			<div className="text-sm font-mono text-muted-foreground">
				Synchronized: all instances with the same speed are in lockstep via wall clock
			</div>
			<div className="flex gap-12 items-end">
				<Label label="sync ring 1">
					<SyncGridAnimation variant="ring" size="xl" synchronized />
				</Label>
				<Label label="sync ring 2">
					<SyncGridAnimation variant="ring" size="xl" synchronized />
				</Label>
				<Label label="sync ring (sm)">
					<SyncGridAnimation variant="ring" size="sm" synchronized />
				</Label>
				<Label label="sync ring (xs)">
					<SyncGridAnimation variant="ring" size="xs" synchronized />
				</Label>
			</div>
			<div className="text-sm font-mono text-muted-foreground mt-4">
				Unsynchronized for comparison (each starts its cycle on mount)
			</div>
			<div className="flex gap-12 items-end">
				<Label label="unsync 1">
					<SyncGridAnimation variant="ring" size="xl" />
				</Label>
				<Label label="unsync 2">
					<SyncGridAnimation variant="ring" size="xl" />
				</Label>
				<Label label="unsync 3">
					<SyncGridAnimation variant="ring" size="xl" />
				</Label>
			</div>
		</div>
	),
}

// ---------------------------------------------------------------------------
// Footer context: realistic usage at small sizes
// ---------------------------------------------------------------------------

export const FooterContext: Story = {
	parameters: {
		layout: 'fullscreen',
	},
	render: () => (
		<div className="flex flex-col h-screen">
			<div className="flex-1 bg-background" />
			<footer className="flex justify-between items-center px-3 py-1 border-t border-border bg-secondary text-xs">
				<div className="flex flex-row items-center gap-2 text-muted-foreground uppercase">HumanLayer-Dev</div>
				<div className="flex flex-row items-center gap-2">
					<SyncGridAnimation variant="snake" size="xs" speed={150} className="text-muted-foreground" />
					<span className="text-muted-foreground text-[10px] font-mono">syncing</span>

					<div className="w-px h-3 bg-border mx-1" />

					<SyncGridAnimation variant="snake" size="sm" speed={120} className="text-muted-foreground" />
					<span className="text-muted-foreground text-[10px] font-mono">syncing</span>

					<div className="w-px h-3 bg-border mx-1" />

					<SyncGridAnimation variant="ring" size="sm" className="text-muted-foreground" />
					<span className="text-muted-foreground text-[10px] font-mono">syncing</span>

					<div className="w-px h-3 bg-border mx-1" />

					<button
						type="button"
						className="cursor-pointer px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors"
					>
						<Settings className="w-3 h-3" />
					</button>
					<a className="px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors">
						<MessageCircle className="w-3 h-3" />
					</a>
				</div>
			</footer>
		</div>
	),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Label({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col items-center gap-2">
			{children}
			<span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{label}</span>
		</div>
	)
}
