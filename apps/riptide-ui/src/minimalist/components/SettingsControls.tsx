import type { ReactNode } from 'react'

import { selectWithArrows } from '@/minimalist/lib/roving'

/** The pieces every settings page is built from: titled groups of label-and-control rows. */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<section>
			{title ? <h2 className="h2">{title}</h2> : null}
			<div className="group">{children}</div>
		</section>
	)
}

export function SettingRow({
	label,
	description,
	htmlFor,
	children,
}: {
	label: string
	description?: string
	htmlFor?: string
	children: ReactNode
}) {
	return (
		<div className="srow">
			<div className="l">
				<label htmlFor={htmlFor}>
					<b>{label}</b>
				</label>
				{description ? <span>{description}</span> : null}
			</div>
			{children}
		</div>
	)
}

export function Toggle({
	id,
	checked,
	onChange,
	label,
}: {
	id: string
	checked: boolean
	onChange: (checked: boolean) => void
	label: string
}) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			className={`toggle${checked ? ' on' : ''}`}
			onClick={() => onChange(!checked)}
		/>
	)
}

export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string
	value: T
	options: Array<{ value: T; label: string }>
	onChange: (value: T) => void
}) {
	return (
		<div className="seg" role="radiogroup" aria-label={label} onKeyDown={selectWithArrows}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					role="radio"
					aria-checked={value === option.value}
					tabIndex={value === option.value ? 0 : -1}
					className={value === option.value ? 'on' : undefined}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	)
}
