import '@tanstack/react-start/server-only'

export interface ServerEnvironment {
  adminPassword: string
  adminSessionSecret: string
  databaseUrl: string
  emotesEnabled: boolean
  participantCapacity: number
  rateLimiting: boolean
  requestLogging: boolean
  secureCookies: boolean
  stunUrls: string
  trustProxy: boolean
  turnSharedSecret?: string
  turnTtlSeconds?: number
  turnUrls?: string
}

export function getServerEnvironment(): ServerEnvironment {
  return parseServerEnvironment(process.env)
}

export function parseServerEnvironment(runtimeEnvironment: NodeJS.ProcessEnv): ServerEnvironment {
  const databaseUrl = required(
    runtimeEnvironment,
    'DATABASE_URL',
    'DATABASE_URL is required for room signaling.',
  )
  const adminPassword = required(
    runtimeEnvironment,
    'ADMIN_PASSWORD',
    'ADMIN_PASSWORD is required.',
  )
  const adminSessionSecret = required(
    runtimeEnvironment,
    'ADMIN_SESSION_SECRET',
    'ADMIN_SESSION_SECRET is required.',
  )
  if (Buffer.byteLength(adminSessionSecret) < 32) {
    throw new Error('ADMIN_SESSION_SECRET must contain at least 32 bytes.')
  }

  const configuredMaximum = Number(
    runtimeEnvironment.MAX_PARTICIPANTS ?? runtimeEnvironment.MAX_VIEWERS ?? 12,
  )
  const participantCapacity = Number.isSafeInteger(configuredMaximum)
    ? Math.min(12, Math.max(2, configuredMaximum))
    : 12

  return {
    adminPassword,
    adminSessionSecret,
    databaseUrl,
    emotesEnabled: environmentBoolean(runtimeEnvironment, 'EMOTES_ENABLED', true),
    participantCapacity,
    rateLimiting: environmentBoolean(runtimeEnvironment, 'RATE_LIMIT_ENABLED', true),
    requestLogging: environmentBoolean(
      runtimeEnvironment,
      'REQUEST_LOGGING',
      Boolean(runtimeEnvironment.VERCEL || runtimeEnvironment.NODE_ENV === 'production'),
    ),
    secureCookies: environmentBoolean(
      runtimeEnvironment,
      'SECURE_COOKIES',
      Boolean(runtimeEnvironment.VERCEL || runtimeEnvironment.NODE_ENV === 'production'),
    ),
    stunUrls: runtimeEnvironment.STUN_URLS || 'stun:stun.l.google.com:19302',
    trustProxy: runtimeEnvironment.VERCEL
      ? true
      : environmentBoolean(runtimeEnvironment, 'TRUST_PROXY', false),
    turnSharedSecret: optional(runtimeEnvironment, 'TURN_SHARED_SECRET'),
    turnTtlSeconds: optionalInteger(runtimeEnvironment, 'TURN_TTL_SECONDS'),
    turnUrls: optional(runtimeEnvironment, 'TURN_URLS'),
  }
}

function required(runtimeEnvironment: NodeJS.ProcessEnv, name: string, message: string) {
  const value = optional(runtimeEnvironment, name)
  if (!value) throw new Error(message)
  return value
}

function optional(runtimeEnvironment: NodeJS.ProcessEnv, name: string) {
  return runtimeEnvironment[name]?.trim() || undefined
}

function environmentBoolean(
  runtimeEnvironment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
) {
  const value = optional(runtimeEnvironment, name)?.toLowerCase()
  if (!value) return fallback
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${name} must be a boolean value.`)
}

function optionalInteger(runtimeEnvironment: NodeJS.ProcessEnv, name: string) {
  const value = optional(runtimeEnvironment, name)
  if (!value) return undefined
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be an integer.`)
  return number
}
