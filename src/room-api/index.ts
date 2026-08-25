import type { Router } from 'express';
import { PostgresRoomStore } from './internal/postgres-store.js';
import { buildRoomRouter } from './internal/router.js';
import { RoomService } from './internal/service.js';
import type { AdminDatabaseSnapshot, AdminSnapshotQuery, RateLimitPolicy, RateLimitResult, RoomStore } from './internal/types.js';

export type { AdminDatabaseSnapshot, AdminSnapshotQuery } from './internal/types.js';

export interface RoomApi {
  router: Router;
  adminSnapshot(query: AdminSnapshotQuery): Promise<AdminDatabaseSnapshot>;
  rateLimit(scope: string, identity: string, policy: RateLimitPolicy): Promise<RateLimitResult>;
  healthCheck(): Promise<void>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export function createRoomApi(options: { databaseUrl: string; participantCapacity: number; rateLimiting?: boolean }): RoomApi {
  const store: RoomStore = new PostgresRoomStore(options.databaseUrl, options.participantCapacity);
  const service = new RoomService(store, Date.now, options.rateLimiting ?? true);
  return {
    router: buildRoomRouter(service),
    adminSnapshot: (query) => store.adminSnapshot(query),
    rateLimit: (scope, identity, policy) => service.checkRateLimit(scope, identity, policy),
    healthCheck: () => service.healthCheck(),
    migrate: () => store.migrate(),
    close: () => store.close(),
  };
}
