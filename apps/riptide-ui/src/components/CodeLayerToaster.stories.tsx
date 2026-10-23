import { CodeLayerToaster } from '@humanlayer/ui/components/CodeLayerToaster'
import { Button } from '@humanlayer/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { CodeLayerToastButtons } from './CodeLayerToastButtons'

const meta = {
	title: 'Shell Demos/CodeLayerToaster',
	component: CodeLayerToaster,
	parameters: {
		layout: 'fullscreen',
	},
	decorators: [
		(Story) => (
			<div className="min-h-screen p-8 bg-background text-foreground">
				<Story />
				<CodeLayerToaster />
			</div>
		),
	],
} satisfies Meta<typeof CodeLayerToaster>

export default meta
type Story = StoryObj<typeof meta>

// Platform-aware hotkey label
const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
const hotkeyLabel = isMac ? '⌘+⇧+J' : 'Ctrl+Shift+J'

// Basic toast variants
export const BasicVariants: Story = {
	render: () => (
		<div className="flex flex-col gap-4 max-w-2xl">
			<h2 className="text-lg font-mono uppercase">Toast Variants</h2>
			<div className="flex flex-wrap gap-2">
				<Button onClick={() => toast.success('Operation completed successfully')} variant="outline">
					Success Toast
				</Button>
				<Button onClick={() => toast.error('Failed to connect to server')} variant="outline">
					Error Toast
				</Button>
				<Button onClick={() => toast.warning('Low memory warning')} variant="outline">
					Warning Toast
				</Button>
				<Button onClick={() => toast.info('New update available')} variant="outline">
					Info Toast
				</Button>
			</div>
		</div>
	),
}

// Simulated approval toast
export const ApprovalToast: Story = {
	render: () => {
		const showApprovalToast = () => {
			const toastId = `approval_required:session123:approval456`

			const titleElement = (
				<div className="flex flex-col gap-0.5 relative pr-6">
					<button
						type="button"
						onClick={() => {
							toast.dismiss(toastId)
							console.log('Dismissed from stack')
						}}
						className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
					>
						<X className="h-3 w-3" />
					</button>
					<span className="font-bold text-[var(--terminal-warning)]">needs_approval</span>
					<span className="text-xs text-muted-foreground">Fix authentication bug in login flow</span>
				</div>
			)

			const bodyElement = (
				<span>
					<code className="text-accent bg-muted/50 rounded-md px-1 py-0.5 font-mono">Bash</code>
					<span> using </span>
					<code className="text-accent bg-muted/50 rounded-md px-1 py-0.5 font-mono">npm install</code>
				</span>
			)

			toast(titleElement, {
				id: toastId,
				duration: 8000,
				description: bodyElement,
				action: (
					<CodeLayerToastButtons
						action={{
							label: (
								<span className="flex items-center gap-1">
									Jump to Session
									<kbd className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-background/50 rounded border border-border">
										{hotkeyLabel}
									</kbd>
								</span>
							),
							onClick: () => {
								toast.dismiss(toastId)
								console.log('Navigate to session')
							},
						}}
						variant="default"
						toastId={toastId}
					/>
				),
			})
		}

		return (
			<div className="flex flex-col gap-4 max-w-2xl">
				<h2 className="text-lg font-mono uppercase">Approval Toast</h2>
				<p className="text-sm text-muted-foreground">
					Simulates approval notification with warning-colored title, hotkey hint, and dismiss button.
				</p>
				<Button onClick={showApprovalToast} variant="outline">
					Show Approval Toast
				</Button>
			</div>
		)
	},
}

// Session failed toast with error styling
export const SessionFailedToast: Story = {
	render: () => {
		const showFailedToast = () => {
			const toastId = `session_failed:session789`

			const titleElement = (
				<div className="flex flex-col gap-0.5 relative pr-6">
					<button
						type="button"
						onClick={() => {
							toast.dismiss(toastId)
							console.log('Dismissed from stack')
						}}
						className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
					>
						<X className="h-3 w-3" />
					</button>
					<span className="font-bold text-destructive">session_failed</span>
					<span className="text-xs text-muted-foreground">Deploy feature branch to staging</span>
				</div>
			)

			const bodyElement = (
				<span className="text-sm">
					Process exited with code 1: npm ERR! ERESOLVE unable to resolve dependency tree
				</span>
			)

			toast(titleElement, {
				id: toastId,
				duration: 8000,
				description: bodyElement,
				action: (
					<CodeLayerToastButtons
						action={{
							label: (
								<span className="flex items-center gap-1">
									Jump to Session
									<kbd className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-background/50 rounded border border-border">
										{hotkeyLabel}
									</kbd>
								</span>
							),
							onClick: () => {
								toast.dismiss(toastId)
								console.log('Navigate to failed session')
							},
						}}
						variant="default"
						toastId={toastId}
					/>
				),
			})
		}

		return (
			<div className="flex flex-col gap-4 max-w-2xl">
				<h2 className="text-lg font-mono uppercase">Session Failed Toast</h2>
				<p className="text-sm text-muted-foreground">
					Toast with destructive-colored title, session title, error message, and dismiss button.
				</p>
				<Button onClick={showFailedToast} variant="outline">
					Show Session Failed Toast
				</Button>
			</div>
		)
	},
}

// Multiple stacked toasts demonstrating LIFO behavior
export const MultipleStackedToasts: Story = {
	render: () => {
		const showStackedToasts = () => {
			// Approval toast 1
			toast(
				<div className="flex flex-col gap-0.5 relative pr-6">
					<button
						type="button"
						onClick={() => toast.dismiss('approval_1')}
						className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
					>
						<X className="h-3 w-3" />
					</button>
					<span className="font-bold text-[var(--terminal-warning)]">needs_approval</span>
					<span className="text-xs text-muted-foreground">Session Alpha</span>
				</div>,
				{
					id: 'approval_1',
					duration: 8000,
					description: 'Tool: Bash',
					action: (
						<CodeLayerToastButtons
							action={{ label: 'Jump to Session', onClick: () => toast.dismiss('approval_1') }}
							variant="default"
							toastId="approval_1"
						/>
					),
				},
			)

			// Session failed toast
			setTimeout(() => {
				toast(
					<div className="flex flex-col gap-0.5 relative pr-6">
						<button
							type="button"
							onClick={() => toast.dismiss('failed_1')}
							className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
						>
							<X className="h-3 w-3" />
						</button>
						<span className="font-bold text-destructive">session_failed</span>
						<span className="text-xs text-muted-foreground">Session Beta</span>
					</div>,
					{
						id: 'failed_1',
						duration: 8000,
						description: 'Connection timeout',
						action: (
							<CodeLayerToastButtons
								action={{ label: 'Jump to Session', onClick: () => toast.dismiss('failed_1') }}
								variant="default"
								toastId="failed_1"
							/>
						),
					},
				)
			}, 200)

			// Approval toast 2
			setTimeout(() => {
				toast(
					<div className="flex flex-col gap-0.5 relative pr-6">
						<button
							type="button"
							onClick={() => toast.dismiss('approval_2')}
							className="absolute -top-1 -right-1 p-1 text-muted-foreground hover:text-foreground hover:border hover:border-border cursor-pointer transition-colors"
						>
							<X className="h-3 w-3" />
						</button>
						<span className="font-bold text-[var(--terminal-warning)]">needs_approval</span>
						<span className="text-xs text-muted-foreground">Session Gamma</span>
					</div>,
					{
						id: 'approval_2',
						duration: 8000,
						description: 'Tool: Write',
						action: (
							<CodeLayerToastButtons
								action={{ label: 'Jump to Session', onClick: () => toast.dismiss('approval_2') }}
								variant="default"
								toastId="approval_2"
							/>
						),
					},
				)
			}, 400)
		}

		return (
			<div className="flex flex-col gap-4 max-w-2xl">
				<h2 className="text-lg font-mono uppercase">Multiple Stacked Toasts</h2>
				<p className="text-sm text-muted-foreground">
					Demonstrates mixed approval and failure toasts. ⌘+⇧+J cycles through them in LIFO order (newest
					first).
				</p>
				<div className="flex gap-2">
					<Button onClick={showStackedToasts} variant="outline">
						Show 3 Stacked Toasts
					</Button>
					<Button onClick={() => toast.dismiss()} variant="ghost">
						Dismiss All
					</Button>
				</div>
			</div>
		)
	},
}

// Documentation of toast features
export const ToastDocumentation: Story = {
	render: () => (
		<div className="flex flex-col gap-4 max-w-2xl font-mono text-sm">
			<h2 className="text-lg uppercase">Toast Notification Reference</h2>

			<div className="p-4 border border-border rounded bg-muted/30">
				<p className="text-muted-foreground mb-2">&gt; APPROVAL TOASTS:</p>
				<ul className="space-y-1 ml-4 text-muted-foreground">
					<li>• Title: &quot;needs_approval&quot; in warning color (yellow/orange)</li>
					<li>• Subtitle: Session title (truncated to 50 chars)</li>
					<li>• Body: Tool name and input preview</li>
					<li>• Duration: 8 seconds auto-dismiss</li>
					<li>• Actions: &quot;Jump to Session&quot; button with ⌘+⇧+J hint</li>
					<li>• Dismiss: Small X in top-right corner</li>
				</ul>
			</div>

			<div className="p-4 border border-border rounded bg-muted/30">
				<p className="text-destructive mb-2">&gt; SESSION FAILED TOASTS:</p>
				<ul className="space-y-1 ml-4 text-muted-foreground">
					<li>• Title: &quot;session_failed&quot; in destructive color (red)</li>
					<li>• Subtitle: Session title (truncated to 40 chars)</li>
					<li>• Body: Error message (truncated to 100 chars)</li>
					<li>• Duration: 8 seconds auto-dismiss</li>
					<li>• Actions: &quot;Jump to Session&quot; button with ⌘+⇧+J hint</li>
					<li>• Dismiss: Small X in top-right corner</li>
					<li>• Same layout as approval toast, different title color</li>
				</ul>
			</div>

			<div className="p-4 border border-border rounded">
				<p className="text-muted-foreground mb-2">&gt; SHARED BEHAVIOR:</p>
				<ul className="space-y-1 ml-4 text-muted-foreground">
					<li>• ⌘+⇧+J: Cycles through all pending notifications (LIFO)</li>
					<li>• Suppressed when viewing the referenced session</li>
					<li>• Auto-dismiss when navigating to the session</li>
					<li>• Stacked in top-right corner of screen</li>
				</ul>
			</div>
		</div>
	),
}
