import { mock } from 'bun:test'

export const mockDirEntry = (name: string, isDirectory = false) => ({
  name,
  isDirectory,
  isFile: !isDirectory,
  isSymlink: false,
})

export const mockReadDir = mock(() => Promise.resolve([]))
export const mockHomeDir = mock(() => Promise.resolve('/home/user'))
export const mockOpenUrl = mock(() => Promise.resolve())

export const setupTauriMocks = () => {
  mockReadDir.mockClear()
  mockHomeDir.mockClear()
  mockOpenUrl.mockClear()
  mockHomeDir.mockResolvedValue('/home/user')
}
