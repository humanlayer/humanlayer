import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { ThemeSelector } from '@humanlayer/ui/components/theme-selector'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Settings } from 'lucide-react'
import type { FC } from 'react'

import { BillingFooterIndicators } from '@/components/BillingFooterIndicators'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useIsSyncing } from '@/hooks/useIsSyncing'

import { OrganizationSwitcher } from './OrganizationSwitcher'

export const Footer: FC = () => {
	const isSyncing = useIsSyncing()

	return (
		<>
			<footer className="flex-none border-t border-border bg-background">
				<div className="flex items-center justify-between px-4 py-2">
					<div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
						HumanLayer Cloud
						<BillingFooterIndicators />
						{isSyncing && (
							<SyncGridAnimation
								variant="snake"
								size="xs"
								speed={120}
								className="text-muted-foreground"
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										onClick={() => useSettingsStore.getState().open()}
										className="cursor-pointer px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
										aria-label="Settings"
									>
										<Settings className="w-3 h-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Settings</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						<ThemeSelector enableHotkeys={true} showTooltip={true} />
						<OrganizationSwitcher />
					</div>
				</div>
			</footer>
			<SettingsDialog />
		</>
	)
}
