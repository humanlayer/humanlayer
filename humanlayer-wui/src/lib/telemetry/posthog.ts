import posthog from 'posthog-js'
import { getAppVersion } from '@/lib/version'

// PostHog configuration based on build type
export const getPostHogConfig = () => ({
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',

  // Privacy-first defaults
  opt_out_capturing_by_default: true, // Opt-out by default for privacy
  autocapture: false, // Will be toggled based on consent
  capture_pageview: false, // We'll track manually
  capture_pageleave: false,
  disable_session_recording: true,
  disable_surveys: true,

  // Anonymous tracking
  person_profiles: 'always' as const, // Create profiles for all users

  // Performance
  bootstrap: {
    distinctID: undefined, // Let PostHog generate anonymous ID
  },
})

// Check if PostHog should be initialized
export const shouldInitializePostHog = (): boolean => {
  // Don't initialize without API key
  if (!import.meta.env.VITE_PUBLIC_POSTHOG_KEY) {
    console.log('PostHog API key not configured')
    return false
  }

  // Don't initialize in test environment
  if (import.meta.env.MODE === 'test') {
    return false
  }

  return true
}

// Initialize PostHog with super properties
export const initializePostHog = () => {
  if (!shouldInitializePostHog()) return null

  const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY!
  const config = getPostHogConfig()

  posthog.init(apiKey, config)

  // Set super properties for all events
  const version = getAppVersion()
  if (version) {
    posthog.register({
      app_version: version,
      build_type: version.includes('nightly') ? 'nightly' : 'stable',
      platform: 'desktop',
    })
  }

  return posthog
}
