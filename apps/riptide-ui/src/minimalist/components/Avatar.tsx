import humanlayerLogo from '@humanlayer/ui/assets/humanlayer-logo.png'
import { getInitials } from '@humanlayer/ui/lib/comment-utils'
import { useState } from 'react'

import { useBrowserAuth as useAuth } from '@/hooks/use-browser-auth'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { type CommentPerson, personName } from '@/minimalist/lib/people'

/**
 * A round WorkOS profile picture, with initials until it loads or when it can't.
 * Google-hosted pictures refuse requests that carry a referrer, so none is sent.
 */
export function Avatar({ name, src, size = 20 }: { name: string; src?: string | null; size?: number }) {
	const [failed, setFailed] = useState<string | null>(null)
	const [loaded, setLoaded] = useState<string | null>(null)
	const showImage = Boolean(src) && failed !== src
	return (
		<span
			className="avatar"
			style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.42)) }}
			aria-hidden="true"
		>
			{getInitials(name)}
			{showImage && src ? (
				<img
					src={src}
					alt=""
					referrerPolicy="no-referrer"
					className={loaded === src ? 'loaded' : undefined}
					onLoad={() => setLoaded(src)}
					onError={() => setFailed(src)}
				/>
			) : null}
		</span>
	)
}

/** An org member's avatar by WorkOS user id; your own falls back to your sign-in profile. */
export function WiredUserAvatar({ userId, size }: { userId: string; size?: number }) {
	const { membersMap } = useOrgMembers()
	const { user } = useAuth()
	const member = membersMap.get(userId)
	const self = user?.id === userId ? user : null
	const name = member
		? personName(userId, member)
		: self
			? personName(userId, {
					firstName: self.firstName ?? undefined,
					lastName: self.lastName ?? undefined,
					email: self.email,
				})
			: userId.slice(0, 8)
	return (
		<span title={name} className="avatar-wrap">
			<Avatar name={name} src={member?.profilePictureUrl ?? self?.profilePictureUrl} size={size} />
		</span>
	)
}

/**
 * A comment's author: their avatar and name. The agent's comments stack the HumanLayer logo on the
 * person it works for, and read as "Ada Lovelace's agent".
 */
export function Byline({ name, src, agent, size = 18 }: CommentPerson & { size?: number }) {
	return (
		<span className="byline">
			{agent ? (
				<span className="avatar-stack" title={`${name}'s agent`}>
					<Avatar name={name} src={src} size={size} />
					<span className="avatar agent-mark" style={{ width: size, height: size }} aria-hidden="true">
						<img src={humanlayerLogo} alt="" className="loaded" />
					</span>
				</span>
			) : (
				<Avatar name={name} src={src} size={size} />
			)}
			<b>{agent ? `${name}'s agent` : name}</b>
		</span>
	)
}
