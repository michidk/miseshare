import '@tanstack/react-start/server-only'
import { buildEmoteService } from '@/emotes'
import { buildIceServerFactory } from '@/ice-config'
import { createRoomApi } from '@/room-api'
import { getServerEnvironment } from './env.server'

type ServerRuntime = Awaited<ReturnType<typeof createServerRuntime>>

let runtimePromise: Promise<ServerRuntime> | undefined

export function getServerRuntime() {
  runtimePromise ??= createServerRuntime().catch((error) => {
    runtimePromise = undefined
    throw error
  })
  return runtimePromise
}

async function createServerRuntime() {
  const environment = getServerEnvironment()
  const roomApi = createRoomApi({
    databaseUrl: environment.databaseUrl,
    participantCapacity: environment.participantCapacity,
    rateLimiting: environment.rateLimiting,
  })
  await roomApi.migrate()

  return {
    environment,
    roomApi,
    emotes: buildEmoteService({ enabled: environment.emotesEnabled }),
    iceServers: buildIceServerFactory({
      stunUrls: environment.stunUrls,
      turnUrls: environment.turnUrls,
      turnSharedSecret: environment.turnSharedSecret,
      turnTtlSeconds: environment.turnTtlSeconds,
    }),
  }
}
