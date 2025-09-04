import { useState, useEffect } from 'react'
import { homeDir } from '@tauri-apps/api/path'
import { DirEntry, readDir } from '@tauri-apps/plugin-fs'
import { fuzzySearch } from '@/lib/fuzzy-search'

export interface FileBrowserOptions {
  includeFiles?: boolean
  includeDirectories?: boolean
  fileExtensions?: string[]
  maxResults?: number
}

export interface FileBrowserResult extends DirEntry {
  fullPath: string
  matches?: Array<{ indices: number[]; value?: string; key?: string }>
}

export function useFileBrowser(searchPath: string, options: FileBrowserOptions = {}) {
  const {
    includeFiles = false,
    includeDirectories = true,
    fileExtensions = [],
    maxResults = 10,
  } = options

  const [results, setResults] = useState<FileBrowserResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stabilize the fileExtensions array reference
  const fileExtensionsKey = fileExtensions.join(',')

  useEffect(() => {
    if (!searchPath) {
      setResults([])
      setIsLoading(false)
      setError(null)
      return
    }

    // Debounce the file fetching
    const timeoutId = setTimeout(async () => {
      setIsLoading(true)
      setError(null)

      try {
        let dirPath: string
        let searchQuery: string

        // Special case for just "~" or "/"
        if (searchPath === '~' || searchPath === '/') {
          dirPath = searchPath
          searchQuery = ''
        } else if (searchPath.endsWith('/')) {
          // Path ends with /, means we want to list that directory's contents
          dirPath = searchPath.slice(0, -1) // Remove trailing slash
          searchQuery = ''
        } else {
          // For paths without trailing slash, parse to find search query
          const lastSlashIndex = searchPath.lastIndexOf('/')
          if (lastSlashIndex === -1) {
            // No slash at all - always treat as search in current directory
            // This ensures we search for patterns like "humanlayer" instead of
            // jumping into a directory that happens to match
            dirPath = '.'
            searchQuery = searchPath
          } else {
            // Has a slash - split at the last slash to separate directory from search
            const pathBeforeSlash = searchPath.substring(0, lastSlashIndex) || '/'
            const pathAfterSlash = searchPath.substring(lastSlashIndex + 1)
            
            // Always treat the part after the slash as the search query if it exists
            // The part before the slash is the directory to search in
            dirPath = pathBeforeSlash
            searchQuery = pathAfterSlash
          }
        }

        // Expand home directory if needed
        if (dirPath === '~' || dirPath.startsWith('~/')) {
          const home = await homeDir()
          dirPath = dirPath === '~' ? home : dirPath.replace('~', home)
        }

        // Read directory contents
        const entries = await readDir(dirPath)

        // Filter entries based on options
        let filtered = entries.filter(entry => {
          if (entry.isDirectory && includeDirectories) return true
          if (entry.isFile && includeFiles) {
            if (fileExtensions.length > 0) {
              return fileExtensions.some(ext => entry.name?.endsWith(ext))
            }
            return true
          }
          return false
        })

        // Apply fuzzy search if there's a search query
        let searchResults: FileBrowserResult[] = []
        if (searchQuery) {
          const fuzzyResults = fuzzySearch(filtered, searchQuery, {
            keys: ['name'],
            threshold: 0.01,
            minMatchCharLength: 1,
            includeMatches: true,
          })

          searchResults = fuzzyResults.slice(0, maxResults).map(result => ({
            ...result.item,
            fullPath: `${dirPath}/${result.item.name}`,
            matches: result.matches,
          }))
        } else {
          searchResults = filtered.slice(0, maxResults).map(entry => ({
            ...entry,
            fullPath: `${dirPath}/${entry.name}`,
          }))
        }

        setResults(searchResults)
      } catch (err) {
        console.error('❌ useFileBrowser: error reading directory:', err)
        setError(err instanceof Error ? err.message : 'Failed to read directory')
        setResults([])
      } finally {
        setIsLoading(false)
      }
    }, 150)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [searchPath, includeFiles, includeDirectories, fileExtensionsKey, maxResults])

  return { results, isLoading, error }
}
