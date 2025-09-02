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
  matches?: Array<{ indices: Array<[number, number]>; value: string; key: string }>
}

export function useFileBrowser(
  searchPath: string,
  options: FileBrowserOptions = {}
) {
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
    console.log('🔍 useFileBrowser: effect triggered', { 
      searchPath,
      includeFiles, 
      includeDirectories, 
      maxResults,
      fileExtensionsKey
    })
    
    if (!searchPath) {
      setResults([])
      setIsLoading(false)
      setError(null)
      return
    }

    // Debounce the file fetching
    const timeoutId = setTimeout(async () => {
      console.log('⏱️ useFileBrowser: timeout fired, starting fetch for:', searchPath)
      setIsLoading(true)
      setError(null)

      try {
        // Parse the search path to separate directory and search query
        const lastSlashIndex = searchPath.lastIndexOf('/')
        let dirPath = searchPath.substring(0, lastSlashIndex + 1) || '.'
        const searchQuery = searchPath.substring(lastSlashIndex + 1)
        
        console.log('📂 useFileBrowser: parsed path', { dirPath, searchQuery })

        // Expand home directory if needed
        if (dirPath.startsWith('~/')) {
          const home = await homeDir()
          dirPath = dirPath.replace('~/', `${home}/`)
          console.log('🏠 useFileBrowser: expanded home dir to:', dirPath)
        }

        // Read directory contents
        console.log('📖 useFileBrowser: reading directory:', dirPath)
        const entries = await readDir(dirPath)
        console.log('📚 useFileBrowser: found entries:', entries.length)
        
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
            fullPath: `${dirPath}${result.item.name}`,
            matches: result.matches,
          }))
        } else {
          searchResults = filtered.slice(0, maxResults).map(entry => ({
            ...entry,
            fullPath: `${dirPath}${entry.name}`,
          }))
        }

        console.log('✅ useFileBrowser: setting results:', searchResults.length, 'items')
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
      console.log('🛑 useFileBrowser: clearing timeout for path:', searchPath)
      clearTimeout(timeoutId)
    }
  }, [searchPath, includeFiles, includeDirectories, fileExtensionsKey, maxResults])

  return { results, isLoading, error }
}