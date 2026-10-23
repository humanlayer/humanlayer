const LOGO_DEV_PUBLIC_KEY = 'pk_HK7SB86VQFC5dY_d-J4fmg'

export function CompanyLogo({ domain, className }: { domain: string; className?: string }) {
	return (
		<img
			src={`https://img.logo.dev/${domain}?token=${LOGO_DEV_PUBLIC_KEY}`}
			alt="Company logo"
			className={className}
		/>
	)
}
