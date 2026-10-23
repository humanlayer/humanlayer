/**
 * NameSlugSection.tsx
 *
 * Section component for task name and slug fields.
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Props that must be passed in:
 * - displayName/displaySlug: Derived from ticket data + AI generation in parent
 * - isGeneratingTitle: Comes from useTitleAutoGenerate which needs form values
 *
 * The name error is obtained directly from the form's formState.
 */

import { Field, FieldDescription, FieldError, FieldLabel } from '@humanlayer/ui/components/field'
import { Input } from '@humanlayer/ui/components/input'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useWatch } from 'react-hook-form'

import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'

export interface NameSlugSectionProps {
	// Display values (derived from ticket or AI generation in parent)
	displayName: string
	displaySlug: string

	// Name generation state (from useTitleAutoGenerate in parent)
	isGeneratingTitle: boolean
}

export const NameSlugSection: FC<NameSlugSectionProps> = ({ displayName, displaySlug, isGeneratingTitle }) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)
	const setNameManuallyEdited = useNewTaskFormStore((s) => s.setNameManuallyEdited)
	const setSlugManuallyEdited = useNewTaskFormStore((s) => s.setSlugManuallyEdited)

	const name = useWatch({ control: form?.control, name: 'name' })
	const slug = useWatch({ control: form?.control, name: 'slug' })

	const isSubmitting = submitState.isSubmitting

	// Get name error directly from form state
	const nameError = form?.formState.errors.name?.message

	const handleNameChange = useCallback(
		(value: string) => {
			form?.setValue('name', value, { shouldValidate: true })
			setNameManuallyEdited(true)
		},
		[form, setNameManuallyEdited],
	)

	const handleSlugChange = useCallback(
		(value: string) => {
			form?.setValue('slug', value)
			setSlugManuallyEdited(true)
		},
		[form, setSlugManuallyEdited],
	)

	if (!form) return null

	// Use display values for the inputs (they may be derived from ticket or AI)
	const effectiveName = displayName || name || ''
	const effectiveSlug = displaySlug || slug || ''

	return (
		<>
			{/* Name field */}
			<Field data-invalid={!!nameError}>
				<FieldLabel>Name</FieldLabel>
				<div className="relative">
					<Input
						value={effectiveName}
						onChange={(e) => handleNameChange(e.target.value)}
						placeholder="Task name..."
						disabled={isSubmitting}
						spellCheck={false}
					/>
					{isGeneratingTitle && (
						<SyncGridAnimation
							variant="snake"
							size="sm"
							speed={120}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
					)}
				</div>
				{nameError && <FieldError errors={[{ message: nameError }]} />}
			</Field>

			{/* Slug field */}
			<Field>
				<FieldLabel>Slug</FieldLabel>
				<Input
					value={effectiveSlug}
					onChange={(e) => handleSlugChange(e.target.value)}
					placeholder="task-slug"
					disabled={isSubmitting}
					spellCheck={false}
					className="font-mono"
				/>
				<FieldDescription>URL-friendly identifier (auto-generated from name)</FieldDescription>
			</Field>
		</>
	)
}
