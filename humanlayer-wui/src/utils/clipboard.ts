import { toast } from 'sonner'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await writeText(text)
    toast.success('Copied to clipboard')
    return true
  } catch (error) {
    console.error('Failed to copy to clipboard:', error instanceof Error ? error.message : error)
    toast.error('Failed to copy to clipboard')
    return false
  }
}
