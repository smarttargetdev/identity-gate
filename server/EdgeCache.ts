/**
 * File: EdgeCache.ts
 * Kind: TypeScript
 * Container: /server
 * Summary: Simulação de cache de borda e versionamento KV de permissões e políticas por sistema.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import crypto from 'node:crypto';
import { db, dbStats } from './Db.ts';

interface CacheEntry {
  key: string;
  payload: unknown;
  systemId: string;
  subjectId: string;
  expiresAtMs: number;
  createdAtMs: number;
  ttlSeconds: number;
}

const cacheStore = new Map<string, CacheEntry>();
const kvMemoryCache = new Map<string, number>();

export const edgeCacheStats = {
  hits: 0,
  misses: 0,
  bypasses: 0,
  purges: 0,
  kvReads: 0,
  hitLatenciesMs: [] as number[],
  missLatenciesMs: [] as number[],
};

function recordLatency(arr: number[], ms: number): void {
  arr.push(ms);
  if (arr.length > 500) {
    arr.shift();
  }
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

export function getKvUserPermVersion(userId: string): number {
  edgeCacheStats.kvReads += 1;
  const memKey = `u_ver:${userId}`;
  const cached = kvMemoryCache.get(memKey);
  if (cached !== undefined) return cached;

  dbStats.totalReads += 1;
  const row = db.prepare('SELECT perm_version FROM users WHERE id = ?').get(userId) as
    | { perm_version: number }
    | undefined;
  const ver = row?.perm_version ?? 1;
  kvMemoryCache.set(memKey, ver);
  return ver;
}

export function getKvSystemPolicyVersion(systemId: string): number {
  edgeCacheStats.kvReads += 1;
  const memKey = `s_ver:${systemId}`;
  const cached = kvMemoryCache.get(memKey);
  if (cached !== undefined) return cached;

  dbStats.totalReads += 1;
  const row = db.prepare('SELECT policy_version FROM systems WHERE id = ?').get(systemId) as
    | { policy_version: number }
    | undefined;
  const ver = row?.policy_version ?? 1;
  kvMemoryCache.set(memKey, ver);
  return ver;
}

export function bumpUserPermVersion(userId: string): number {
  const res = db
    .prepare('UPDATE users SET perm_version = perm_version + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), userId);
  dbStats.totalWrites += res.changes;

  const row = db.prepare('SELECT perm_version FROM users WHERE id = ?').get(userId) as
    | { perm_version: number }
    | undefined;
  const nextVer = row?.perm_version ?? 1;
  kvMemoryCache.set(`u_ver:${userId}`, nextVer);

  db.prepare('INSERT OR REPLACE INTO kv_store (kv_key, kv_value, updated_at) VALUES (?, ?, ?)').run(
    `u_ver:${userId}`,
    String(nextVer),
    new Date().toISOString()
  );

  // Evict entries for this user
  for (const [key, entry] of cacheStore.entries()) {
    if (entry.subjectId === userId) {
      cacheStore.delete(key);
      edgeCacheStats.purges += 1;
    }
  }
  return nextVer;
}

export function bumpSystemPolicyVersion(systemId: string): number {
  const res = db
    .prepare('UPDATE systems SET policy_version = policy_version + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), systemId);
  dbStats.totalWrites += res.changes;

  const row = db.prepare('SELECT policy_version FROM systems WHERE id = ?').get(systemId) as
    | { policy_version: number }
    | undefined;
  const nextVer = row?.policy_version ?? 1;
  kvMemoryCache.set(`s_ver:${systemId}`, nextVer);

  db.prepare('INSERT OR REPLACE INTO kv_store (kv_key, kv_value, updated_at) VALUES (?, ?, ?)').run(
    `s_ver:${systemId}`,
    String(nextVer),
    new Date().toISOString()
  );

  for (const [key, entry] of cacheStore.entries()) {
    if (entry.systemId === systemId) {
      cacheStore.delete(key);
      edgeCacheStats.purges += 1;
    }
  }
  return nextVer;
}

export function buildEdgeCacheKey(params: {
  operation: string;
  variablesJson: string;
  systemId: string;
  subjectId: string;
  roleScopeHash: string;
  userPermVer: number;
  sysPolVer: number;
}): string {
  const raw = [
    params.operation.replace(/\s+/g, ' ').trim(),
    params.variablesJson,
    params.systemId,
    params.subjectId,
    params.roleScopeHash,
    `uv:${params.userPermVer}`,
    `sv:${params.sysPolVer}`,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function computeEffectiveCacheTtl(policyTtlSeconds: number, jwtExpEpoch: number): number {
  if (policyTtlSeconds <= 0) return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const jwtRemaining = Math.max(0, jwtExpEpoch - nowSec);
  return Math.max(0, Math.min(policyTtlSeconds, jwtRemaining));
}

export function getEdgeCached(key: string): {
  hit: boolean;
  payload?: unknown;
  remainingTtlSeconds?: number;
} {
  const entry = cacheStore.get(key);
  if (!entry) return { hit: false };
  const now = Date.now();
  if (entry.expiresAtMs <= now) {
    cacheStore.delete(key);
    return { hit: false };
  }
  const remainingTtlSeconds = Math.max(0, Math.floor((entry.expiresAtMs - now) / 1000));
  return { hit: true, payload: entry.payload, remainingTtlSeconds };
}

export function setEdgeCached(params: {
  key: string;
  payload: unknown;
  systemId: string;
  subjectId: string;
  ttlSeconds: number;
}): void {
  if (params.ttlSeconds <= 0) return;
  const now = Date.now();
  cacheStore.set(params.key, {
    key: params.key,
    payload: params.payload,
    systemId: params.systemId,
    subjectId: params.subjectId,
    createdAtMs: now,
    expiresAtMs: now + params.ttlSeconds * 1000,
    ttlSeconds: params.ttlSeconds,
  });
}

export function recordEdgeCacheOutcome(
  status: 'HIT' | 'MISS' | 'BYPASS',
  durationMs: number
): void {
  if (status === 'HIT') {
    edgeCacheStats.hits += 1;
    recordLatency(edgeCacheStats.hitLatenciesMs, durationMs);
  } else if (status === 'MISS') {
    edgeCacheStats.misses += 1;
    recordLatency(edgeCacheStats.missLatenciesMs, durationMs);
  } else {
    edgeCacheStats.bypasses += 1;
  }
}

export function purgeAllEdgeCache(): number {
  const count = cacheStore.size;
  cacheStore.clear();
  kvMemoryCache.clear();
  edgeCacheStats.purges += count;
  return count;
}

export function purgeSystemEdgeCache(systemId: string): number {
  let removed = 0;
  for (const [key, entry] of cacheStore.entries()) {
    if (entry.systemId === systemId) {
      cacheStore.delete(key);
      removed += 1;
    }
  }
  edgeCacheStats.purges += removed;
  return removed;
}

export function getEdgeMetricsSnapshot() {
  const totalRequests = edgeCacheStats.hits + edgeCacheStats.misses;
  const hitRatio = totalRequests > 0 ? (edgeCacheStats.hits / totalRequests) * 100 : 100;
  const allLatencies = [...edgeCacheStats.hitLatenciesMs, ...edgeCacheStats.missLatenciesMs];
  const totalDbOps = dbStats.totalReads + dbStats.totalWrites;
  const readRatio = totalDbOps > 0 ? (dbStats.totalReads / totalDbOps) * 100 : 100;

  return {
    cacheHits: edgeCacheStats.hits,
    cacheMisses: edgeCacheStats.misses,
    cacheBypasses: edgeCacheStats.bypasses,
    cachePurges: edgeCacheStats.purges,
    cachedEntriesCount: cacheStore.size,
    cacheHitRatioPct: Number(hitRatio.toFixed(1)),
    kvVersionReads: edgeCacheStats.kvReads,
    p50LatencyMs: percentile(allLatencies, 50),
    p95LatencyMs: percentile(allLatencies, 95),
    avgHitLatencyMs:
      edgeCacheStats.hitLatenciesMs.length > 0
        ? Number(
            (
              edgeCacheStats.hitLatenciesMs.reduce((a, b) => a + b, 0) /
              edgeCacheStats.hitLatenciesMs.length
            ).toFixed(2)
          )
        : 0,
    avgMissLatencyMs:
      edgeCacheStats.missLatenciesMs.length > 0
        ? Number(
            (
              edgeCacheStats.missLatenciesMs.reduce((a, b) => a + b, 0) /
              edgeCacheStats.missLatenciesMs.length
            ).toFixed(2)
          )
        : 0,
    sqliteTotalReads: dbStats.totalReads,
    sqliteTotalWrites: dbStats.totalWrites,
    sqliteReadRatioPct: Number(readRatio.toFixed(1)),
    batchedAuditFlushes: dbStats.batchedFlushes,
    queuedAuditLogs: dbStats.queuedAuditLogs,
  };
}
