import path from 'node:path';
import { and, count, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { SignalEnvelope, SignalKind } from '../../signaling/index.js';
import { requestRateLimits, roomParticipants, rooms, roomSignals } from './schema.js';
import { withUniqueGuestName } from './guest-name.js';
import type { AdminSnapshotQuery, JoinStoreResult, RateLimitPolicy, RoomStore, StoredParticipant, StoredRoom } from './types.js';

const PARTICIPANT_STALE_MS = 60_000;
const SIGNAL_TTL_MS = 2 * 60_000;
const RETENTION_MS = 60 * 60_000;

type RoomDatabase = NodePgDatabase<{
  rooms: typeof rooms;
  roomParticipants: typeof roomParticipants;
  roomSignals: typeof roomSignals;
  requestRateLimits: typeof requestRateLimits;
}>;

export class PostgresRoomStore implements RoomStore {
  private readonly pool: Pool;
  private readonly database: RoomDatabase;
  private lastRateLimitCleanupAt = 0;

  constructor(connectionString: string, private readonly participantCapacity: number) {
    this.pool = new Pool({ connectionString: secureConnectionString(connectionString), max: 5, idleTimeoutMillis: 10_000 });
    this.database = drizzle(this.pool, { schema: { rooms, roomParticipants, roomSignals, requestRateLimits } });
  }

  async migrate() {
    const lock = await this.pool.connect();
    try {
      await lock.query(`select pg_advisory_lock(hashtext('mise-schema-migrations'))`);
      await migrate(this.database, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
    } finally {
      await lock.query(`select pg_advisory_unlock(hashtext('mise-schema-migrations'))`).catch(() => {});
      lock.release();
    }
  }

  async createRoom(room: StoredRoom, host: StoredParticipant) {
    const now = Date.now();
    await this.database.transaction(async (transaction) => {
      await transaction.delete(roomSignals).where(lt(roomSignals.expiresAt, new Date(now)));
      await transaction.delete(rooms).where(or(
        lt(rooms.expiresAt, new Date(now - RETENTION_MS)),
        lt(rooms.closedAt, new Date(now - RETENTION_MS)),
      ));
      await transaction.insert(rooms).values({
        id: room.id,
        hostId: room.hostId,
        passwordHash: room.passwordHash,
        expiresAt: new Date(room.expiresAt),
      });
      await insertParticipant(transaction, host);
    });
  }

  async getRoom(roomId: string) {
    const [room] = await this.database.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    return room ? mapRoom(room) : undefined;
  }

  async joinRoom(roomId: string, participant: StoredParticipant, now: number): Promise<JoinStoreResult> {
    return this.database.transaction(async (transaction) => {
      const [room] = await transaction
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), isNull(rooms.closedAt), gt(rooms.expiresAt, new Date(now))))
        .for('update');
      if (!room) return { status: 'unavailable' };

      await transaction.delete(roomParticipants).where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.isHost, false),
        lt(roomParticipants.lastSeenAt, new Date(now - PARTICIPANT_STALE_MS)),
      ));
      const members = await transaction
        .select()
        .from(roomParticipants)
        .where(eq(roomParticipants.roomId, roomId))
        .orderBy(roomParticipants.joinedAt);
      if (members.length >= this.participantCapacity) return { status: 'full' };

      const existing = members.map(mapParticipant);
      const assignedParticipant = withUniqueGuestName(participant, existing);
      await insertParticipant(transaction, assignedParticipant);
      return { status: 'joined', participant: assignedParticipant, participants: existing };
    });
  }

  async authenticate(roomId: string, participantId: string, expectedTokenHash: string, now: number) {
    const [participant] = await this.database
      .select({ participant: roomParticipants })
      .from(roomParticipants)
      .innerJoin(rooms, eq(rooms.id, roomParticipants.roomId))
      .where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.id, participantId),
        eq(roomParticipants.tokenHash, expectedTokenHash),
        gte(roomParticipants.lastSeenAt, new Date(now - PARTICIPANT_STALE_MS)),
        isNull(rooms.closedAt),
        gt(rooms.expiresAt, new Date(now)),
      ))
      .limit(1);
    return participant ? mapParticipant(participant.participant) : undefined;
  }

  async heartbeat(roomId: string, participantId: string, expectedTokenHash: string, now: number, roomExpiresAt: number) {
    return this.database.transaction(async (transaction) => {
      const activeRoom = transaction
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(
          eq(rooms.id, roomParticipants.roomId),
          isNull(rooms.closedAt),
          gt(rooms.expiresAt, new Date(now)),
        ));
      const [participant] = await transaction
        .update(roomParticipants)
        .set({ lastSeenAt: new Date(now) })
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.id, participantId),
          eq(roomParticipants.tokenHash, expectedTokenHash),
          gte(roomParticipants.lastSeenAt, new Date(now - PARTICIPANT_STALE_MS)),
          exists(activeRoom),
        ))
        .returning({ isHost: roomParticipants.isHost });
      if (!participant) return false;
      if (participant.isHost) {
        await transaction.update(rooms)
          .set({ expiresAt: new Date(roomExpiresAt) })
          .where(and(eq(rooms.id, roomId), isNull(rooms.closedAt)));
      }
      return true;
    });
  }

  async leaveRoom(roomId: string, participantId: string, expectedTokenHash: string) {
    const deleted = await this.database.delete(roomParticipants).where(and(
      eq(roomParticipants.roomId, roomId),
      eq(roomParticipants.id, participantId),
      eq(roomParticipants.tokenHash, expectedTokenHash),
      eq(roomParticipants.isHost, false),
    )).returning({ id: roomParticipants.id });
    return deleted.length === 1;
  }

  async kickParticipant(roomId: string, hostId: string, expectedTokenHash: string, participantId: string) {
    return this.database.transaction(async (transaction) => {
      const hostExists = transaction.select({ id: roomParticipants.id }).from(roomParticipants).where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.id, hostId),
        eq(roomParticipants.tokenHash, expectedTokenHash),
        eq(roomParticipants.isHost, true),
      ));
      const deleted = await transaction.delete(roomParticipants).where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.id, participantId),
        eq(roomParticipants.isHost, false),
        exists(hostExists),
      )).returning({ id: roomParticipants.id });
      return deleted.length === 1;
    });
  }

  async closeRoom(roomId: string, participantId: string, expectedTokenHash: string) {
    const hostExists = this.database.select({ id: roomParticipants.id }).from(roomParticipants).where(and(
      eq(roomParticipants.roomId, rooms.id),
      eq(roomParticipants.id, participantId),
      eq(roomParticipants.tokenHash, expectedTokenHash),
      eq(roomParticipants.isHost, true),
      eq(rooms.hostId, roomParticipants.id),
    ));
    const closed = await this.database.update(rooms)
      .set({ closedAt: new Date() })
      .where(and(eq(rooms.id, roomId), isNull(rooms.closedAt), exists(hostExists)))
      .returning({ id: rooms.id });
    return closed.length === 1;
  }

  async appendSignal(input: {
    roomId: string;
    senderId: string;
    recipientId: string;
    kind: SignalKind;
    payload: unknown;
    now: number;
  }) {
    const result = await this.database.execute(sql`
      insert into ${roomSignals} (
        room_id, sender_id, recipient_id, kind, payload, expires_at
      )
      select ${input.roomId}, ${input.senderId}, ${input.recipientId}, ${input.kind},
        ${JSON.stringify(input.payload)}::jsonb, ${new Date(input.now + SIGNAL_TTL_MS)}
      where exists (
        select 1 from ${roomParticipants}
        where ${roomParticipants.roomId} = ${input.roomId} and ${roomParticipants.id} = ${input.senderId}
      ) and exists (
        select 1 from ${roomParticipants}
        where ${roomParticipants.roomId} = ${input.roomId} and ${roomParticipants.id} = ${input.recipientId}
      )
    `);
    return result.rowCount === 1;
  }

  async readSignals(roomId: string, participantId: string, after: number, now: number) {
    const signals = await this.database.select().from(roomSignals).where(and(
      eq(roomSignals.roomId, roomId),
      eq(roomSignals.recipientId, participantId),
      gt(roomSignals.id, after),
      gt(roomSignals.expiresAt, new Date(now)),
    )).orderBy(roomSignals.id).limit(100);
    return signals.map((signal): SignalEnvelope => ({
      id: signal.id,
      senderId: signal.senderId,
      recipientId: signal.recipientId,
      kind: signal.kind,
      payload: signal.payload,
    }));
  }

  async consumeRateLimit(key: string, policy: RateLimitPolicy, now: number) {
    const current = new Date(now);
    const nextExpiry = new Date(now + policy.windowMs);
    if (now - this.lastRateLimitCleanupAt >= RETENTION_MS) {
      await this.database.delete(requestRateLimits).where(lt(requestRateLimits.expiresAt, new Date(now - RETENTION_MS)));
      this.lastRateLimitCleanupAt = now;
    }
    const [row] = await this.database.insert(requestRateLimits)
      .values({ key, count: 1, windowStartedAt: current, expiresAt: nextExpiry })
      .onConflictDoUpdate({
        target: requestRateLimits.key,
        set: {
          count: sql`case when ${requestRateLimits.expiresAt} <= ${current}
            then 1 else ${requestRateLimits.count} + 1 end`,
          windowStartedAt: sql`case when ${requestRateLimits.expiresAt} <= ${current}
            then ${current} else ${requestRateLimits.windowStartedAt} end`,
          expiresAt: sql`case when ${requestRateLimits.expiresAt} <= ${current}
            then ${nextExpiry} else ${requestRateLimits.expiresAt} end`,
        },
      })
      .returning({ count: requestRateLimits.count, expiresAt: requestRateLimits.expiresAt });
    const count = row.count;
    const expiresAt = row.expiresAt.getTime();
    return {
      allowed: count <= policy.limit,
      remaining: Math.max(0, policy.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1_000)),
    };
  }

  async healthCheck() {
    await this.database.execute(sql`select 1`);
  }

  async adminSnapshot(query: AdminSnapshotQuery) {
    const now = Date.now();
    const nowDate = new Date(now);
    const activeRoomsWhere = and(isNull(rooms.closedAt), gt(rooms.expiresAt, nowDate));
    const pastRoomsWhere = or(isNotNull(rooms.closedAt), lte(rooms.expiresAt, nowDate));
    const [[storedRooms], [activeRooms], [storedParticipants], [activeParticipants], [storedSignals], [activeSignals]] = await Promise.all([
      this.database.select({ value: count() }).from(rooms),
      this.database.select({ value: count() }).from(rooms).where(activeRoomsWhere),
      this.database.select({ value: count() }).from(roomParticipants),
      this.database.select({ value: count() }).from(roomParticipants).innerJoin(rooms, eq(rooms.id, roomParticipants.roomId)).where(and(
        activeRoomsWhere,
        gte(roomParticipants.lastSeenAt, new Date(now - PARTICIPANT_STALE_MS)),
      )),
      this.database.select({ value: count() }).from(roomSignals),
      this.database.select({ value: count() }).from(roomSignals).where(gt(roomSignals.expiresAt, nowDate)),
    ]);
    const counts = {
      activeRooms: Number(activeRooms.value),
      pastRooms: Number(storedRooms.value) - Number(activeRooms.value),
      activeParticipants: Number(activeParticipants.value),
      storedParticipants: Number(storedParticipants.value),
      activeSignals: Number(activeSignals.value),
      storedSignals: Number(storedSignals.value),
      storedRooms: Number(storedRooms.value),
    };
    const total = query.view === 'sessions'
      ? query.state === 'active' ? counts.activeRooms : counts.pastRooms
      : query.view === 'participants' ? counts.storedParticipants
        : query.view === 'signals' ? counts.storedSignals : counts.activeRooms;
    const pages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(Math.max(1, query.page), pages);
    const offset = (page - 1) * query.pageSize;
    const roomRows = query.view === 'overview'
      ? await this.database.select().from(rooms).where(activeRoomsWhere).orderBy(desc(rooms.createdAt)).limit(5)
      : query.view === 'sessions'
        ? await this.database.select().from(rooms)
          .where(query.state === 'active' ? activeRoomsWhere : pastRoomsWhere)
          .orderBy(desc(rooms.createdAt)).limit(query.pageSize).offset(offset)
        : [];
    const participantRows = query.view === 'participants'
      ? await this.database.select({ participant: roomParticipants, roomExpiresAt: rooms.expiresAt, roomClosedAt: rooms.closedAt })
        .from(roomParticipants).innerJoin(rooms, eq(rooms.id, roomParticipants.roomId))
        .orderBy(desc(roomParticipants.joinedAt)).limit(query.pageSize).offset(offset)
      : [];
    const signalRows = query.view === 'signals'
      ? await this.database.select().from(roomSignals).orderBy(desc(roomSignals.createdAt)).limit(query.pageSize).offset(offset)
      : [];
    const roomIds = roomRows.map(({ id }) => id);
    const [participantCounts, signalCounts] = roomIds.length ? await Promise.all([
      this.database.select({ roomId: roomParticipants.roomId, value: count() }).from(roomParticipants)
        .where(inArray(roomParticipants.roomId, roomIds)).groupBy(roomParticipants.roomId),
      this.database.select({ roomId: roomSignals.roomId, value: count() }).from(roomSignals)
        .where(inArray(roomSignals.roomId, roomIds)).groupBy(roomSignals.roomId),
    ]) : [[], []];
    const participantCountByRoom = new Map(participantCounts.map((row) => [row.roomId, Number(row.value)]));
    const signalCountByRoom = new Map(signalCounts.map((row) => [row.roomId, Number(row.value)]));
    return {
      generatedAt: now,
      counts,
      page,
      pages,
      total,
      rooms: roomRows.map((room) => ({
        id: room.id,
        hostId: room.hostId,
        protected: room.passwordHash !== null,
        createdAt: room.createdAt.getTime(),
        expiresAt: room.expiresAt.getTime(),
        closedAt: room.closedAt?.getTime() ?? null,
        participantCount: participantCountByRoom.get(room.id) ?? 0,
        signalCount: signalCountByRoom.get(room.id) ?? 0,
      })),
      participants: participantRows.map(({ participant, roomExpiresAt, roomClosedAt }) => ({
        id: participant.id,
        roomId: participant.roomId,
        name: participant.name,
        isHost: participant.isHost,
        joinedAt: participant.joinedAt.getTime(),
        lastSeenAt: participant.lastSeenAt.getTime(),
        active: roomClosedAt === null && roomExpiresAt.getTime() > now
          && participant.lastSeenAt.getTime() >= now - PARTICIPANT_STALE_MS,
      })),
      signals: signalRows.map((signal) => ({
        id: signal.id,
        roomId: signal.roomId,
        senderId: signal.senderId,
        recipientId: signal.recipientId,
        kind: signal.kind,
        payloadBytes: Buffer.byteLength(JSON.stringify(signal.payload)),
        createdAt: signal.createdAt.getTime(),
        expiresAt: signal.expiresAt.getTime(),
      })),
    };
  }

  async close() {
    await this.pool.end();
  }
}

type RoomTransaction = Parameters<Parameters<RoomDatabase['transaction']>[0]>[0];

async function insertParticipant(transaction: RoomTransaction, participant: StoredParticipant) {
  await transaction.insert(roomParticipants).values({
    id: participant.id,
    roomId: participant.roomId,
    name: participant.name,
    tokenHash: participant.tokenHash,
    isHost: participant.isHost,
    lastSeenAt: new Date(participant.lastSeenAt),
  });
}

function mapRoom(room: typeof rooms.$inferSelect): StoredRoom {
  return {
    id: room.id,
    hostId: room.hostId,
    passwordHash: room.passwordHash,
    expiresAt: room.expiresAt.getTime(),
    closed: room.closedAt !== null,
  };
}

function mapParticipant(participant: typeof roomParticipants.$inferSelect): StoredParticipant {
  return {
    id: participant.id,
    roomId: participant.roomId,
    name: participant.name,
    tokenHash: participant.tokenHash,
    isHost: participant.isHost,
    lastSeenAt: participant.lastSeenAt.getTime(),
  };
}

function secureConnectionString(connectionString: string) {
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
