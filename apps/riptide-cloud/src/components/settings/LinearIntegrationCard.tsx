import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Label } from '@humanlayer/ui/components/label'
import { Separator } from '@humanlayer/ui/components/separator'
import { Switch } from '@humanlayer/ui/components/switch'
import { AlertCircle, CheckCircle, Link2 } from 'lucide-react'
import { useState } from 'react'

interface LinearIntegrationCardProps {
	connected: boolean
	needsReauth?: boolean
	linearIntegrationEnabled: boolean
	onToggleIntegration: (checked: boolean) => void
	onDisconnect: () => void
	onConnect: () => void
	onReconnect: () => void
	isSettingsLoading: boolean
	isSettingsPending: boolean
	isDisconnectPending: boolean
}

function IntegrationStatusBadge({ onDisconnect, isPending }: { onDisconnect: () => void; isPending: boolean }) {
	const [hovered, setHovered] = useState(false)

	if (isPending) {
		return (
			<Badge variant="secondary" className="gap-1">
				Disconnecting...
			</Badge>
		)
	}

	return (
		<div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
			{hovered ? (
				<Badge variant="destructive" className="gap-1 cursor-pointer" onClick={onDisconnect}>
					Disconnect?
				</Badge>
			) : (
				<Badge variant="default" className="gap-1">
					<CheckCircle className="h-3 w-3" />
					Connected
				</Badge>
			)}
		</div>
	)
}

export function LinearIntegrationCard({
	connected,
	needsReauth,
	linearIntegrationEnabled,
	onToggleIntegration,
	onDisconnect,
	onConnect,
	onReconnect,
	isSettingsLoading,
	isSettingsPending,
	isDisconnectPending,
}: LinearIntegrationCardProps) {
	return (
		<Card className="p-4">
			<CardHeader>
				<CardTitle>Linear Integration</CardTitle>
				<CardDescription>
					Connect your Linear workspace to sync issue status and link artifacts.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{connected ? (
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-4">
							<div className="space-y-1">
								<Label className="text-sm font-medium">Enable Linear Integration</Label>
								<p className="text-sm text-muted-foreground">
									Allow users to create tasks from Linear issues.
								</p>
							</div>
							<Switch
								checked={linearIntegrationEnabled}
								onCheckedChange={onToggleIntegration}
								disabled={isSettingsLoading || isSettingsPending}
							/>
						</div>
						<Separator />
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Link2 className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm">Linear workspace connected</span>
							</div>
							{needsReauth ? (
								<Button size="sm" variant="destructive" onClick={onReconnect}>
									<AlertCircle className="mr-1 h-3 w-3" />
									Reconnect
								</Button>
							) : (
								<IntegrationStatusBadge onDisconnect={onDisconnect} isPending={isDisconnectPending} />
							)}
						</div>
					</div>
				) : (
					<Button variant="outline" className="w-full" onClick={onConnect}>
						<Link2 className="mr-2 h-4 w-4" />
						Connect Linear
					</Button>
				)}
			</CardContent>
		</Card>
	)
}
