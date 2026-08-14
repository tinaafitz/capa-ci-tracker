/**
 * Post-write hooks (trigger replacements).
 *
 * Replaces Postgres triggers (set_updated_at, record_status_change,
 * notify_new_build_failure, notify_new_activity) with in-process
 * function calls and an EventEmitter for downstream agent subscriptions.
 *
 * These hooks are called by the API router after database writes.
 * They are free of HTTP/Express dependencies -- only the db, uuid,
 * and EventEmitter are used.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db/connection.js';

// ---------------------------------------------------------------------------
// Event emitter -- agents (Phase 3) will subscribe to these events
// ---------------------------------------------------------------------------

export const dbEvents = new EventEmitter();

// ---------------------------------------------------------------------------
// Ticket status ordering for detecting forward/backward transitions
// ---------------------------------------------------------------------------

const STATUS_ORDER: Record<string, number> = {
  new:               0,
  investigating:     1,
  root_caused:       2,
  fix_in_progress:   3,
  resolved:          4,
  verified:          5,
};

// ---------------------------------------------------------------------------
// afterBuildInsert
//
// Called after every INSERT on the builds table.
// If the build status is 'failure', emits a 'build_failure' event.
// ---------------------------------------------------------------------------

export function afterBuildInsert(build: Record<string, unknown>): void {
  if (build.status === 'failure') {
    dbEvents.emit('build_failure', {
      build_id: build.id,
      job_name: build.job_name,
      source: build.source,
    });
  }
}

// ---------------------------------------------------------------------------
// afterActivityInsert
//
// Called after every INSERT on the activities table.
// Emits a 'new_activity' event for downstream consumers (notify agent).
// ---------------------------------------------------------------------------

export function afterActivityInsert(activity: Record<string, unknown>): void {
  dbEvents.emit('new_activity', {
    activity_id: activity.id,
    activity_type: activity.activity_type,
  });
}

// ---------------------------------------------------------------------------
// beforeTicketUpdate
//
// Called before PATCH on support_tickets when status is being changed.
// Replaces the Postgres record_status_change() trigger:
//   1. Auto-sets resolved_at / verified_at timestamps on forward transitions
//   2. Clears resolved_at / verified_at on backward transitions
//   3. Inserts a status-change activity record
//
// Mutates `newData` in place to inject resolved_at / verified_at changes
// so they are included in the UPDATE statement the router builds.
// ---------------------------------------------------------------------------

export function beforeTicketUpdate(
  oldTicket: Record<string, unknown>,
  newData: Record<string, unknown>,
): void {
  const oldStatus = oldTicket.status as string;
  const newStatus = newData.status as string;

  // No status change -- nothing to do
  if (oldStatus === newStatus) return;

  const now = new Date().toISOString();
  const oldOrd = STATUS_ORDER[oldStatus] ?? -1;
  const newOrd = STATUS_ORDER[newStatus] ?? -1;

  // --- Forward transitions: set timestamps ---

  if (newStatus === 'resolved' && oldStatus !== 'resolved') {
    newData.resolved_at = now;
  }

  if (newStatus === 'verified' && oldStatus !== 'verified') {
    newData.verified_at = now;
  }

  // --- Backward transitions: clear timestamps ---

  // Moving back from resolved (ord 4) to something earlier
  if (oldOrd >= STATUS_ORDER['resolved'] && newOrd < STATUS_ORDER['resolved']) {
    newData.resolved_at = null;
  }

  // Moving back from verified (ord 5) to something earlier
  if (oldOrd >= STATUS_ORDER['verified'] && newOrd < STATUS_ORDER['verified']) {
    newData.verified_at = null;
  }

  // --- Insert status-change activity record ---

  const activityId = uuidv4();
  const ticketId = oldTicket.id as string;
  const title = `Status changed to ${newStatus}`;
  const description = `Ticket moved from ${oldStatus} to ${newStatus}`;
  const metadata = JSON.stringify({ old_status: oldStatus, new_status: newStatus, ticket_id: ticketId });

  db.prepare(
    `INSERT INTO activities (id, activity_type, title, description, ticket_id, actor, metadata, created_at)
     VALUES (?, 'ticket_updated', ?, ?, ?, 'system', ?, ?)`
  ).run(activityId, title, description, ticketId, metadata, now);

  // Emit new_activity event for the status-change activity we just inserted
  dbEvents.emit('new_activity', {
    activity_id: activityId,
    activity_type: 'ticket_updated',
  });
}

// ---------------------------------------------------------------------------
// setUpdatedAt
//
// Simple helper called by the router before any UPDATE.
// Mutates data in place to set updated_at to the current timestamp.
// ---------------------------------------------------------------------------

export function setUpdatedAt(data: Record<string, unknown>): void {
  data.updated_at = new Date().toISOString();
}
