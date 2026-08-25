import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SignalKind } from '../../signaling/index.js';

const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  passwordHash: text('password_hash'),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  expiresAt: timestampColumn('expires_at').notNull(),
  closedAt: timestampColumn('closed_at'),
});

export const roomParticipants = pgTable('room_participants', {
  id: text('id').notNull(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  isHost: boolean('is_host').notNull().default(false),
  joinedAt: timestampColumn('joined_at').notNull().defaultNow(),
  lastSeenAt: timestampColumn('last_seen_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.id] }),
  index('room_participants_presence_idx').on(table.roomId, table.lastSeenAt),
]);

export const roomSignals = pgTable('room_signals', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  roomId: text('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull(),
  recipientId: text('recipient_id').notNull(),
  kind: text('kind').$type<SignalKind>().notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  expiresAt: timestampColumn('expires_at').notNull(),
}, (table) => [
  check('room_signals_kind_check', sql`${table.kind} in ('description', 'candidate')`),
  index('room_signals_recipient_idx').on(table.roomId, table.recipientId, table.id),
  foreignKey({
    name: 'room_signals_sender_fk',
    columns: [table.roomId, table.senderId],
    foreignColumns: [roomParticipants.roomId, roomParticipants.id],
  }).onDelete('cascade'),
  foreignKey({
    name: 'room_signals_recipient_fk',
    columns: [table.roomId, table.recipientId],
    foreignColumns: [roomParticipants.roomId, roomParticipants.id],
  }).onDelete('cascade'),
]);

export const requestRateLimits = pgTable('request_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStartedAt: timestampColumn('window_started_at').notNull(),
  expiresAt: timestampColumn('expires_at').notNull(),
}, (table) => [
  index('request_rate_limits_expiry_idx').on(table.expiresAt),
]);
