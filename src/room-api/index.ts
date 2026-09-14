import { buildRoomRequestHandler } from './internal/fetch-handler.js'
import { createRoomObserver } from './internal/observability.js'
import { PostgresRoomStore } from './internal/postgres-store.js'
import { RoomService } from './internal/service.js'
import type {
  AdminDatabaseSnapshot,
  AdminSnapshotQuery,
  RateLimitPolicy,
  RateLimitResult,
  RoomStore,
} from './internal/types.js'

export type { AdminDatabaseSnapshot, AdminSnapshotQuery } from './internal/types.js'

export interface RoomApi {
  handleRequest(request: Request, clientIdentity: string): Promise<Response>
  adminSnapshot(query: AdminSnapshotQuery): Promise<AdminDatabaseSnapshot>
  rateLimit(scope: string, identity: string, policy: RateLimitPolicy): Promise<RateLimitResult>
  healthCheck(): Promise<void>
  migrate(): Promise<void>
  close(): Promise<void>
}

export function createRoomApi(options: {
  databaseUrl: string
  observability?: boolean
  observabilitySecret?: string
  participantCapacity: number
  rateLimiting?: boolean
}): RoomApi {
  const store: RoomStore = new PostgresRoomStore(options.databaseUrl, options.participantCapacity)
  const observer = options.observability
    ? createRoomObserver(options.observabilitySecret ?? options.databaseUrl)
    : undefined
  const service = new RoomService(store, Date.now, options.rateLimiting ?? true, observer)
  return {
    handleRequest: buildRoomRequestHandler(service),
    adminSnapshot: (query) => store.adminSnapshot(query),
    rateLimit: (scope, identity, policy) => service.checkRateLimit(scope, identity, policy),
    healthCheck: () => service.healthCheck(),
    migrate: () => store.migrate(),
    close: () => store.close(),
  }
}
