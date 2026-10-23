import humanlayerLogo from '../assets/humanlayer-logo.png'
import { getInitials } from '../lib/comment-utils'
import { cn } from '../lib/utils'
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from './avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export interface AgentAvatarStackProps {
	/** Display name of the human user the agent is acting on behalf of */
	authorDisplayName?: string
	/** Avatar URL of the human user the agent is acting on behalf of */
	authorAvatarUrl?: string
	/** Used as the input to getInitials when authorDisplayName is absent (typically comment.created_by_user_id) */
	authorFallbackId: string
	/** Applied to the AvatarGroup container (e.g. additional spacing overrides) */
	className?: string
	/** Applied to each child Avatar — controls size (size-5, size-4, etc) */
	avatarClassName?: string
	/** Wrap in a tooltip showing "{Name}'s agent". Defaults to true; pass false in surfaces where the attribution is already inline (e.g. toast titles). */
	withTooltip?: boolean
}

export function AgentAvatarStack({
	authorDisplayName,
	authorAvatarUrl,
	authorFallbackId,
	className,
	avatarClassName,
	withTooltip = true,
}: AgentAvatarStackProps) {
	const stack = (
		<AvatarGroup className={cn('*:data-[slot=avatar]:ring-0 -space-x-1.5', className)}>
			<Avatar className={cn('shrink-0 border border-border', avatarClassName)}>
				<AvatarImage
					src={authorAvatarUrl ?? ''}
					alt={authorDisplayName ?? ''}
					className="absolute inset-0 object-cover"
				/>
				<AvatarFallback className="text-[8px]">
					{getInitials(authorDisplayName ?? authorFallbackId)}
				</AvatarFallback>
			</Avatar>
			<Avatar className={cn('shrink-0 border border-border bg-background', avatarClassName)}>
				<AvatarImage
					src={humanlayerLogo}
					alt="HumanLayer agent"
					className="absolute inset-0 object-cover"
				/>
				<AvatarFallback className="text-[8px]">HL</AvatarFallback>
			</Avatar>
		</AvatarGroup>
	)

	if (!withTooltip) return stack

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex">{stack}</span>
			</TooltipTrigger>
			<TooltipContent>{`${authorDisplayName ?? 'Someone'}'s agent`}</TooltipContent>
		</Tooltip>
	)
}
