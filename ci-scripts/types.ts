export type ReleaseType = 'dev' | 'beta' | 'prod'

export interface VersionOutput {
  release_version: string
  release_type: ReleaseType
  release_tag: string
  dmg_filename: string
  canonical_dmg_filename: string
  dmg_variant: string
  updater_artifact_name: string
}

export interface CaskConfig {
  release_type: ReleaseType
  release_version: string
  sha256: string
  dmg_url: string
}

export interface BinaryVerificationResult {
  success: boolean
  errors: string[]
}
