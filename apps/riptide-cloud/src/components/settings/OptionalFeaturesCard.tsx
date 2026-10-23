import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'

interface OptionalFeaturesCardProps {
	experimentalSubagentsEnabled: boolean
	onExperimentalSubagentsChange: (checked: boolean) => void
	isLoading: boolean
	isPending: boolean
}

export function OptionalFeaturesCard({
	experimentalSubagentsEnabled,
	onExperimentalSubagentsChange,
	isLoading,
	isPending,
}: OptionalFeaturesCardProps) {
	return (
		<Card className="p-4">
			<CardHeader>
				<CardTitle>Optional Features</CardTitle>
				<CardDescription>
					Enable or disable optional features for your organization. When disabled, users cannot enable these
					features in their settings.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-1">
						<Label className="text-sm font-medium">Experimental Subagents</Label>
						<p className="text-sm text-muted-foreground">
							Allow users to enable experimental subagent features in their sessions.
						</p>
					</div>
					<Switch
						checked={experimentalSubagentsEnabled}
						onCheckedChange={onExperimentalSubagentsChange}
						disabled={isLoading || isPending}
					/>
				</div>
			</CardContent>
		</Card>
	)
}
