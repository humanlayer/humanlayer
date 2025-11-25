import { describe, it, expect } from 'vitest'
import {
  resolveProfileForRepo,
  getRepoNameFromMapping,
  getProfileNameFromMapping,
  sanitizeProfileName,
  validateProfile,
  type ThoughtsConfig,
} from './thoughtsConfig.js'
import type { RepoMappingObject } from './config.js'

describe('Profile Resolution', () => {
  const mockConfig: ThoughtsConfig = {
    thoughtsRepo: '~/thoughts',
    reposDir: 'repos',
    globalDir: 'global',
    user: 'test',
    repoMappings: {
      '/path/to/legacy': 'legacy-repo',
      '/path/to/default-obj': { repo: 'default-repo' },
      '/path/to/profiled': { repo: 'profiled-repo', profile: 'personal' },
      '/path/to/invalid-profile': { repo: 'test-repo', profile: 'nonexistent' },
    },
    profiles: {
      personal: {
        thoughtsRepo: '~/thoughts-personal',
        reposDir: 'repos',
        globalDir: 'global',
      },
      work: {
        thoughtsRepo: '~/thoughts-work',
        reposDir: 'projects',
        globalDir: 'shared',
      },
    },
  }

  describe('resolveProfileForRepo()', () => {
    it('should resolve default config for string mappings', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/legacy')

      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.reposDir).toBe('repos')
      expect(result.globalDir).toBe('global')
      expect(result.profileName).toBeUndefined()
    })

    it('should resolve default config for object mapping without profile', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/default-obj')

      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.reposDir).toBe('repos')
      expect(result.globalDir).toBe('global')
      expect(result.profileName).toBeUndefined()
    })

    it('should resolve profile config for object mapping with valid profile', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/profiled')

      expect(result.thoughtsRepo).toBe('~/thoughts-personal')
      expect(result.reposDir).toBe('repos')
      expect(result.globalDir).toBe('global')
      expect(result.profileName).toBe('personal')
    })

    it('should fall back to default for object mapping with invalid profile', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/invalid-profile')

      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.reposDir).toBe('repos')
      expect(result.globalDir).toBe('global')
      expect(result.profileName).toBeUndefined()
    })

    it('should return default config for unmapped repositories', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/unmapped')

      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.reposDir).toBe('repos')
      expect(result.globalDir).toBe('global')
      expect(result.profileName).toBeUndefined()
    })

    it('should handle profile with different directory names', () => {
      // Add work project mapping
      mockConfig.repoMappings['/path/to/work-project'] = { repo: 'work-proj', profile: 'work' }
      const workResult = resolveProfileForRepo(mockConfig, '/path/to/work-project')

      expect(workResult.thoughtsRepo).toBe('~/thoughts-work')
      expect(workResult.reposDir).toBe('projects')
      expect(workResult.globalDir).toBe('shared')
      expect(workResult.profileName).toBe('work')
    })

    it('should handle config without profiles field', () => {
      const configWithoutProfiles: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {
          '/path/to/repo': 'repo-name',
        },
      }

      const result = resolveProfileForRepo(configWithoutProfiles, '/path/to/repo')

      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.profileName).toBeUndefined()
    })
  })

  describe('getRepoNameFromMapping()', () => {
    it('should extract repo name from string mapping', () => {
      expect(getRepoNameFromMapping('test-repo')).toBe('test-repo')
    })

    it('should extract repo name from object mapping', () => {
      const mapping: RepoMappingObject = { repo: 'test-repo', profile: 'personal' }
      expect(getRepoNameFromMapping(mapping)).toBe('test-repo')
    })

    it('should extract repo name from object mapping without profile', () => {
      const mapping: RepoMappingObject = { repo: 'test-repo' }
      expect(getRepoNameFromMapping(mapping)).toBe('test-repo')
    })

    it('should return undefined for undefined mapping', () => {
      expect(getRepoNameFromMapping(undefined)).toBeUndefined()
    })

    it('should return undefined for null mapping', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getRepoNameFromMapping(null as unknown as any)).toBeUndefined()
    })
  })

  describe('getProfileNameFromMapping()', () => {
    it('should extract profile name from object mapping', () => {
      const mapping: RepoMappingObject = { repo: 'test', profile: 'personal' }
      expect(getProfileNameFromMapping(mapping)).toBe('personal')
    })

    it('should return undefined for string mapping', () => {
      expect(getProfileNameFromMapping('test-repo')).toBeUndefined()
    })

    it('should return undefined for object mapping without profile', () => {
      const mapping: RepoMappingObject = { repo: 'test' }
      expect(getProfileNameFromMapping(mapping)).toBeUndefined()
    })

    it('should return undefined for undefined mapping', () => {
      expect(getProfileNameFromMapping(undefined)).toBeUndefined()
    })

    it('should return undefined for null mapping', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getProfileNameFromMapping(null as unknown as any)).toBeUndefined()
    })
  })

  describe('validateProfile()', () => {
    it('should return true for existing profile', () => {
      expect(validateProfile(mockConfig, 'personal')).toBe(true)
      expect(validateProfile(mockConfig, 'work')).toBe(true)
    })

    it('should return false for non-existent profile', () => {
      expect(validateProfile(mockConfig, 'nonexistent')).toBe(false)
    })

    it('should return false when profiles field is undefined', () => {
      const configWithoutProfiles: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {},
      }

      expect(validateProfile(configWithoutProfiles, 'personal')).toBe(false)
    })

    it('should return false when profiles object is empty', () => {
      const configWithEmptyProfiles: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {},
        profiles: {},
      }

      expect(validateProfile(configWithEmptyProfiles, 'personal')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(validateProfile(mockConfig, 'Personal')).toBe(false)
      expect(validateProfile(mockConfig, 'PERSONAL')).toBe(false)
    })
  })

  describe('sanitizeProfileName()', () => {
    it('should keep valid profile names unchanged', () => {
      expect(sanitizeProfileName('client-acme')).toBe('client-acme')
      expect(sanitizeProfileName('personal')).toBe('personal')
      expect(sanitizeProfileName('work_2024')).toBe('work_2024')
      expect(sanitizeProfileName('Project-123')).toBe('Project-123')
    })

    it('should replace spaces with underscores', () => {
      expect(sanitizeProfileName('client acme')).toBe('client_acme')
      expect(sanitizeProfileName('my project')).toBe('my_project')
    })

    it('should replace special characters with underscores', () => {
      expect(sanitizeProfileName('client@acme')).toBe('client_acme')
      expect(sanitizeProfileName('client/acme')).toBe('client_acme')
      expect(sanitizeProfileName('client.acme')).toBe('client_acme')
      expect(sanitizeProfileName('client#acme')).toBe('client_acme')
    })

    it('should handle multiple consecutive special characters', () => {
      expect(sanitizeProfileName('client@@acme')).toBe('client__acme')
      expect(sanitizeProfileName('client///acme')).toBe('client___acme')
    })

    it('should preserve allowed characters (alphanumeric, underscore, hyphen)', () => {
      expect(sanitizeProfileName('abc123-_XYZ')).toBe('abc123-_XYZ')
    })

    it('should handle empty string', () => {
      expect(sanitizeProfileName('')).toBe('')
    })

    it('should handle strings with only special characters', () => {
      expect(sanitizeProfileName('@@@')).toBe('___')
      expect(sanitizeProfileName('...')).toBe('___')
    })
  })

  describe('Backward Compatibility', () => {
    it('should handle configs with only string mappings', () => {
      const legacyConfig: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {
          '/repo1': 'repo1',
          '/repo2': 'repo2',
        },
      }

      const result1 = resolveProfileForRepo(legacyConfig, '/repo1')
      const result2 = resolveProfileForRepo(legacyConfig, '/repo2')

      expect(result1.thoughtsRepo).toBe('~/thoughts')
      expect(result1.profileName).toBeUndefined()
      expect(result2.thoughtsRepo).toBe('~/thoughts')
      expect(result2.profileName).toBeUndefined()
    })

    it('should handle mixed string and object mappings', () => {
      const mixedConfig: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {
          '/legacy-repo': 'legacy',
          '/new-repo': { repo: 'new', profile: 'personal' },
        },
        profiles: {
          personal: {
            thoughtsRepo: '~/thoughts-personal',
            reposDir: 'repos',
            globalDir: 'global',
          },
        },
      }

      const legacyResult = resolveProfileForRepo(mixedConfig, '/legacy-repo')
      const newResult = resolveProfileForRepo(mixedConfig, '/new-repo')

      expect(legacyResult.thoughtsRepo).toBe('~/thoughts')
      expect(legacyResult.profileName).toBeUndefined()
      expect(newResult.thoughtsRepo).toBe('~/thoughts-personal')
      expect(newResult.profileName).toBe('personal')
    })
  })

  describe('Edge Cases', () => {
    it('should handle profile name with special characters needing sanitization', () => {
      const sanitized = sanitizeProfileName('client@2024!')
      expect(sanitized).toBe('client_2024_')

      // Verify it can be used as a valid profile name
      const configWithSanitizedProfile: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {
          '/repo': { repo: 'test', profile: sanitized },
        },
        profiles: {
          [sanitized]: {
            thoughtsRepo: '~/thoughts-client',
            reposDir: 'repos',
            globalDir: 'global',
          },
        },
      }

      const result = resolveProfileForRepo(configWithSanitizedProfile, '/repo')
      expect(result.profileName).toBe(sanitized)
    })

    it('should handle repo path with trailing slashes', () => {
      const result = resolveProfileForRepo(mockConfig, '/path/to/legacy/')
      // Should not match because keys are exact
      expect(result.profileName).toBeUndefined()
      expect(result.thoughtsRepo).toBe('~/thoughts')
    })

    it('should handle object mapping with undefined profile field', () => {
      const mapping: RepoMappingObject = { repo: 'test', profile: undefined }
      const configWithUndefined: ThoughtsConfig = {
        thoughtsRepo: '~/thoughts',
        reposDir: 'repos',
        globalDir: 'global',
        user: 'test',
        repoMappings: {
          '/test': mapping,
        },
        profiles: {
          personal: {
            thoughtsRepo: '~/thoughts-personal',
            reposDir: 'repos',
            globalDir: 'global',
          },
        },
      }

      const result = resolveProfileForRepo(configWithUndefined, '/test')
      expect(result.thoughtsRepo).toBe('~/thoughts')
      expect(result.profileName).toBeUndefined()
    })
  })
})
