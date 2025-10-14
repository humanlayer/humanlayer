import { z } from 'zod'

export const draftSessionSchema = z.object({
  title: z.string().max(255, 'Title too long'),
  prompt: z.string().min(1, 'Prompt is required to launch').max(50000, 'Prompt too long'),
  workingDirectory: z.string().min(1, 'Working directory is required'),
  autoAcceptEdits: z.boolean(),
  dangerouslySkipPermissions: z.boolean(),
})

export type DraftSessionFormValues = z.infer<typeof draftSessionSchema>

export interface DraftSessionFormMeta {
  action: 'launch' | 'saveDraft' | null
}
