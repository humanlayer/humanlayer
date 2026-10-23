import { Button } from '@humanlayer/ui/components/button'
import { HardDriveDownload } from 'lucide-react'
import type { FC } from 'react'

export interface DaemonTooOldNoticeProps {
	hostName: string | null
	onOpenDaemonSettings: () => void
}

export const DaemonTooOldNotice: FC<DaemonTooOldNoticeProps> = ({ hostName, onOpenDaemonSettings }) => (
	<div className="p-2" data-testid="github-daemon-too-old">
		<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-md bg-muted p-2">
					<HardDriveDownload className="size-4 text-muted-foreground" />
				</div>
				<div className="flex-1 space-y-2">
					<p className="text-sm font-medium">
						Update the daemon on {hostName ?? 'this host'} and restart it to see pull requests
					</p>
					<Button size="xs" variant="outline" onClick={onOpenDaemonSettings}>
						Open host settings
					</Button>
				</div>
			</div>
		</div>
	</div>
)
