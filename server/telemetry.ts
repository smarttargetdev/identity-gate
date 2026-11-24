/**
 * File: telemetry.ts
 * Kind: TypeScript
 * Container: /server
 * Summary: Telemetria estruturada em tempo real via SSE, histórico de saúde do sistema e registro de exceções.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  db,
  dbStats,
  queueAuditLog,
  type AuditLogRow,
  type SystemErrorLogRow,
} from './db.ts';
import { hashSubjectForAudit, maskEmail, maskIp } from './cryptoAuth.ts';
import { getPlatformSettings } from './settings.ts';

export type HealthTransitionStatus = 'healthy' | 'degraded' | 'critical';

export interface SystemHealthEventRow {
  id: string;
  previous_status: HealthTransitionStatus | null;
  new_status: HealthTransitionStatus;
  avg_latency_ms: number;
  max_latency_ms: number;
  sample_count: number;
  error_count: number;
  reason: string;
  created_at: string;
}

const sseClients = new Set<Response>();
const HEALTH_WINDOW_SIZE = 50;
let rollingSamples: Array<{ durationMs: number; status: string }> | null = null;
let lastPersistedHealthStatus: HealthTransitionStatus | null = null;

function classifyStatus(avgLatencyMs: number): HealthTransitionStatus {
  if (avgLatencyMs >= 300) return 'critical';
  if (avgLatencyMs >= 100) return 'degraded';
  return 'healthy';
}

function buildTransitionReason(
  status: HealthTransitionStatus,
  avgLatencyMs: number,
  sampleCount: number
): string {
  if (status === 'critical') {
    return `Latência média atingiu ${avgLatencyMs.toFixed(1)}ms (≥ 300ms em ${sampleCount} amostras).`;
  }
  if (status === 'degraded') {
    return `Latência média elevada para ${avgLatencyMs.toFixed(1)}ms (100–299ms em ${sampleCount} amostras).`;
  }
  return `Latência média normalizada em ${avgLatencyMs.toFixed(1)}ms (< 100ms em ${sampleCount} amostras).`;
}

function ensureHealthMonitorInitialized(): void {
  if (rollingSamples === null) {
    const recent = db
      .prepare('SELECT duration_ms, status FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(HEALTH_WINDOW_SIZE) as Array<{ duration_ms: number; status: string }>;
    rollingSamples = recent.map((r) => ({
      durationMs: Number(r.duration_ms || 0),
      status: r.status,
    }));
  }
  if (lastPersistedHealthStatus === null) {
    const latest = db
      .prepare('SELECT new_status FROM system_health_events ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as { new_status: string } | undefined;
    if (latest?.new_status === 'healthy' || latest?.new_status === 'degraded' || latest?.new_status === 'critical') {
      lastPersistedHealthStatus = latest.new_status;
    }
  }
}

export function evaluateSystemHealthTransition(snapshot?: {
  avgLatencyMs: number;
  maxLatencyMs: number;
  sampleCount: number;
  errorCount: number;
  status?: HealthTransitionStatus;
}): SystemHealthEventRow | null {
  ensureHealthMonitorInitialized();

  let avgLatencyMs: number;
  let maxLatencyMs: number;
  let sampleCount: number;
  let errorCount: number;

  if (snapshot) {
    avgLatencyMs = Number(snapshot.avgLatencyMs.toFixed(2));
    maxLatencyMs = Number(snapshot.maxLatencyMs.toFixed(2));
    sampleCount = snapshot.sampleCount;
    errorCount = snapshot.errorCount;
  } else {
    const window = rollingSamples || [];
    sampleCount = window.length;
    if (sampleCount === 0) return null;
    let total = 0;
    let maxVal = 0;
    let errs = 0;
    for (const s of window) {
      total += s.durationMs;
      if (s.durationMs > maxVal) maxVal = s.durationMs;
      if (s.status === 'error') errs += 1;
    }
    avgLatencyMs = Number((total / sampleCount).toFixed(2));
    maxLatencyMs = Number(maxVal.toFixed(2));
    errorCount = errs;
  }

  const nextStatus = snapshot?.status ?? classifyStatus(avgLatencyMs);
  if (lastPersistedHealthStatus === nextStatus) {
    return null;
  }

  const event: SystemHealthEventRow = {
    id: `hlth_${crypto.randomUUID()}`,
    previous_status: lastPersistedHealthStatus,
    new_status: nextStatus,
    avg_latency_ms: avgLatencyMs,
    max_latency_ms: maxLatencyMs,
    sample_count: sampleCount,
    error_count: errorCount,
    reason: buildTransitionReason(nextStatus, avgLatencyMs, sampleCount),
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO system_health_events (
      id, previous_status, new_status, avg_latency_ms, max_latency_ms,
      sample_count, error_count, reason, created_at
    ) VALUES (
      @id, @previous_status, @new_status, @avg_latency_ms, @max_latency_ms,
      @sample_count, @error_count, @reason, @created_at
    )
  `).run(event);
  dbStats.totalWrites += 1;
  lastPersistedHealthStatus = nextStatus;

  const settings = getPlatformSettings();
  if (settings.telemetryStreamEnabled) {
    const sseData = `event: health_transition\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(sseData);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return event;
}

export function recordStructuredAudit(params: {
  actorId: string;
  actorEmail: string;
  systemId?: string | null;
  systemSlug?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  status: 'success' | 'denied' | 'error';
  cacheStatus?: string;
  durationMs?: number;
  ip?: string;
  details?: Record<string, unknown>;
}): AuditLogRow {
  const settings = getPlatformSettings();
  const maskPii = settings.piiMaskingEnabled;
  const entry: AuditLogRow = {
    id: `aud_${crypto.randomUUID()}`,
    trace_id: `tr_${crypto.randomBytes(6).toString('hex')}`,
    actor_hash: hashSubjectForAudit(params.actorId),
    actor_masked: maskPii ? maskEmail(params.actorEmail) : params.actorEmail,
    system_id: params.systemId ?? null,
    system_slug: params.systemSlug ?? null,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    status: params.status,
    cache_status: params.cacheStatus ?? 'BYPASS',
    duration_ms: Number((params.durationMs ?? 0).toFixed(2)),
    ip_masked: maskPii ? maskIp(params.ip) : String(params.ip || '0.0.0.0').replace(/^::ffff:/, ''),
    details_json: JSON.stringify(params.details ?? {}),
    created_at: new Date().toISOString(),
  };

  queueAuditLog(entry);

  ensureHealthMonitorInitialized();
  if (rollingSamples) {
    rollingSamples.unshift({ durationMs: entry.duration_ms, status: entry.status });
    if (rollingSamples.length > HEALTH_WINDOW_SIZE) {
      rollingSamples.length = HEALTH_WINDOW_SIZE;
    }
    evaluateSystemHealthTransition();
  }

  // Structured JSON log to stdout for edge log aggregation
  console.log(
    JSON.stringify({
      level: params.status === 'error' ? 'error' : params.status === 'denied' ? 'warn' : 'info',
      event: 'iam.audit',
      trace_id: entry.trace_id,
      action: entry.action,
      resource: `${entry.resource_type}:${entry.resource_id}`,
      system: entry.system_slug,
      actor_hash: entry.actor_hash,
      status: entry.status,
      cache_status: entry.cache_status,
      duration_ms: entry.duration_ms,
      timestamp: entry.created_at,
    })
  );

  // Real-time SSE push to connected admin monitors
  if (settings.telemetryStreamEnabled) {
    const sseData = `event: audit\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(sseData);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return entry;
}

export function broadcastMetricsSnapshot(snapshot: Record<string, unknown>): void {
  const sseData = `event: metrics\ndata: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(sseData);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function sseTelemetryHandler(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      connectedAt: new Date().toISOString(),
      activeStreams: sseClients.size,
      queuedLogs: dbStats.queuedAuditLogs,
    })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function getActiveSseCount(): number {
  return sseClients.size;
}

export function recordSystemException(
  err: unknown,
  context?: {
    source?: string;
    operationOrRoute?: string;
    httpMethod?: string;
    statusCode?: number;
    actorEmail?: string;
    systemSlug?: string | null;
    metadata?: Record<string, unknown>;
  }
): SystemErrorLogRow | null {
  try {
    const settings = getPlatformSettings();
    const errorObj = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    const errorName = errorObj.name || 'Error';
    const message = errorObj.message || 'Erro interno não especificado.';
    const stackTrace =
      errorObj.stack && errorObj.stack.trim().length > 0
        ? errorObj.stack
        : `${errorName}: ${message}\n    at <stack unavailable>`;

    const rawActor = context?.actorEmail || 'system';
    const actorMasked =
      rawActor === 'system' || rawActor === 'anonymous'
        ? rawActor
        : settings.piiMaskingEnabled
          ? maskEmail(rawActor)
          : rawActor;

    const entry: SystemErrorLogRow = {
      id: `err_${crypto.randomUUID()}`,
      trace_id: `tr_${crypto.randomBytes(6).toString('hex')}`,
      error_name: errorName.slice(0, 120),
      message: message.slice(0, 1000),
      stack_trace: stackTrace.slice(0, 12000),
      source: (context?.source || 'server').slice(0, 60),
      operation_or_route: (context?.operationOrRoute || '').slice(0, 200),
      http_method: (context?.httpMethod || '').slice(0, 16),
      status_code: Number.isFinite(context?.statusCode) ? Number(context?.statusCode) : 500,
      actor_masked: actorMasked,
      system_slug: context?.systemSlug ?? null,
      metadata_json: JSON.stringify(context?.metadata ?? {}),
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO system_error_logs (
        id, trace_id, error_name, message, stack_trace, source,
        operation_or_route, http_method, status_code, actor_masked,
        system_slug, metadata_json, created_at
      ) VALUES (
        @id, @trace_id, @error_name, @message, @stack_trace, @source,
        @operation_or_route, @http_method, @status_code, @actor_masked,
        @system_slug, @metadata_json, @created_at
      )
    `).run(entry);
    dbStats.totalWrites += 1;

    // Keep table bounded to the latest 100 exceptions
    db.prepare(`
      DELETE FROM system_error_logs
      WHERE id NOT IN (
        SELECT id FROM system_error_logs ORDER BY created_at DESC, rowid DESC LIMIT 100
      )
    `).run();

    const logPayload = JSON.stringify({
      level: entry.source === 'diagnostic' ? 'info' : 'error',
      event: entry.source === 'diagnostic' ? 'iam.diagnostic_exception' : 'iam.exception',
      trace_id: entry.trace_id,
      error_name: entry.error_name,
      message: entry.message,
      source: entry.source,
      operation_or_route: entry.operation_or_route,
      status_code: entry.status_code,
      timestamp: entry.created_at,
    });
    if (entry.source === 'diagnostic') {
      console.info(logPayload);
    } else {
      console.error(logPayload);
    }

    if (settings.telemetryStreamEnabled) {
      const sseData = `event: system_error\ndata: ${JSON.stringify(entry)}\n\n`;
      for (const client of sseClients) {
        try {
          client.write(sseData);
        } catch {
          sseClients.delete(client);
        }
      }
    }

    return entry;
  } catch (persistErr) {
    console.error('Failed to record system exception:', persistErr);
    return null;
  }
}

export function getRecentSystemErrors(limit = 10): SystemErrorLogRow[] {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  return db
    .prepare('SELECT * FROM system_error_logs ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(safeLimit) as SystemErrorLogRow[];
}

export function clearSystemErrors(): number {
  const result = db.prepare('DELETE FROM system_error_logs').run();
  dbStats.totalWrites += result.changes;
  return result.changes;
}
