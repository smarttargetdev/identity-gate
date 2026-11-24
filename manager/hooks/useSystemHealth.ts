/**
 * File: useSystemHealth.ts
 * Kind: TypeScript
 * Container: /manager/hooks
 * Summary: Hook React que monitora a latência recente e eventos SSE para classificar a saúde do sistema.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gqlRequest } from '../lib/graphqlClient';
import type { LatencyTrendPoint } from '../types/Identity';

export type SystemHealthLevel = 'healthy' | 'degraded' | 'critical' | 'loading';

export interface SystemHealthState {
  level: SystemHealthLevel;
  label: string;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  sampleCount: number;
  errorCount: number;
  latencyTrend: LatencyTrendPoint[];
}

interface RecentAuditSample {
  id: string;
  durationMs: number;
  status: string;
}

const AUDIT_HEALTH_QUERY = `
  query TopBarAuditHealth($limit: Int) {
    auditLogs(limit: $limit) {
      id
      durationMs
      status
    }
    systemHealth(limit: $limit) {
      latencyTrend {
        minuteIso
        avgLatencyMs
        maxLatencyMs
        sampleCount
      }
    }
  }
`;

const SYSTEM_HEALTH_QUERY = `
  query TopBarSystemHealth($limit: Int) {
    systemHealth(limit: $limit) {
      status
      avgLatencyMs
      maxLatencyMs
      sampleCount
      errorCount
      latencyTrend {
        minuteIso
        avgLatencyMs
        maxLatencyMs
        sampleCount
      }
    }
  }
`;

const SAMPLE_WINDOW = 50;

function createEmptyTenMinuteBuckets(nowMs = Date.now()): LatencyTrendPoint[] {
  const currentMinuteMs = Math.floor(nowMs / 60000) * 60000;
  return Array.from({ length: 10 }, (_, idx) => ({
    minuteIso: new Date(currentMinuteMs - (9 - idx) * 60000).toISOString(),
    avgLatencyMs: 0,
    maxLatencyMs: 0,
    sampleCount: 0,
  }));
}

function mergeSampleIntoTrend(
  prevTrend: LatencyTrendPoint[],
  durationMs: number,
  createdAtIso?: string
): LatencyTrendPoint[] {
  const nowMs = Date.now();
  const baseBuckets = createEmptyTenMinuteBuckets(nowMs);
  const existingMap = new Map<string, LatencyTrendPoint>();
  for (const b of prevTrend) {
    if (b.minuteIso) existingMap.set(b.minuteIso, b);
  }

  const nextBuckets = baseBuckets.map((b) => existingMap.get(b.minuteIso) ?? b);
  const sampleMs = createdAtIso ? new Date(createdAtIso).getTime() : nowMs;
  const targetMinuteIso = new Date(
    Math.floor((Number.isFinite(sampleMs) ? sampleMs : nowMs) / 60000) * 60000
  ).toISOString();

  const idx = nextBuckets.findIndex((b) => b.minuteIso === targetMinuteIso);
  if (idx >= 0) {
    const curr = nextBuckets[idx];
    const nextCount = curr.sampleCount + 1;
    const totalLatency = curr.avgLatencyMs * curr.sampleCount + durationMs;
    nextBuckets[idx] = {
      minuteIso: curr.minuteIso,
      avgLatencyMs: Number((totalLatency / nextCount).toFixed(2)),
      maxLatencyMs: Number(Math.max(curr.maxLatencyMs, durationMs).toFixed(2)),
      sampleCount: nextCount,
    };
  }
  return nextBuckets;
}

export function classifyLatency(avgLatencyMs: number): {
  level: Exclude<SystemHealthLevel, 'loading'>;
  label: string;
} {
  if (avgLatencyMs >= 300) {
    return { level: 'critical', label: 'Latência Crítica' };
  }
  if (avgLatencyMs >= 100) {
    return { level: 'degraded', label: 'Atenção' };
  }
  return { level: 'healthy', label: 'Saudável' };
}

export function useSystemHealth(params: {
  token: string | null;
  canReadAuditLogs: boolean;
  telemetryStreamEnabled?: boolean;
  refreshSignal?: number;
}): SystemHealthState {
  const { token, canReadAuditLogs, telemetryStreamEnabled = true, refreshSignal = 0 } = params;

  const [samples, setSamples] = useState<RecentAuditSample[] | null>(null);
  const [latencyTrend, setLatencyTrend] = useState<LatencyTrendPoint[]>([]);
  const seenSampleIdsRef = useRef<Set<string>>(new Set());
  const [fallbackHealth, setFallbackHealth] = useState<{
    avgLatencyMs: number;
    maxLatencyMs: number;
    sampleCount: number;
    errorCount: number;
  } | null>(null);

  const fetchHealth = useCallback(async () => {
    if (!token) return;
    try {
      if (canReadAuditLogs) {
        const { data } = await gqlRequest<{
          auditLogs: Array<{ id: string; durationMs: number; status: string }>;
          systemHealth?: { latencyTrend?: LatencyTrendPoint[] };
        }>({
          token,
          query: AUDIT_HEALTH_QUERY,
          operationName: 'TopBarAuditHealth',
          variables: { limit: SAMPLE_WINDOW },
          bypassCache: true,
          silentDiagnostics: true,
        });
        const mapped = (data.auditLogs || []).map((row) => ({
          id: row.id,
          durationMs: Number(row.durationMs || 0),
          status: row.status,
        }));
        seenSampleIdsRef.current = new Set(mapped.map((m) => m.id));
        setSamples(mapped);
        if (data.systemHealth?.latencyTrend) {
          setLatencyTrend(data.systemHealth.latencyTrend);
        }
      } else {
        const { data } = await gqlRequest<{
          systemHealth: {
            avgLatencyMs: number;
            maxLatencyMs: number;
            sampleCount: number;
            errorCount: number;
            latencyTrend: LatencyTrendPoint[];
          };
        }>({
          token,
          query: SYSTEM_HEALTH_QUERY,
          operationName: 'TopBarSystemHealth',
          variables: { limit: SAMPLE_WINDOW },
          bypassCache: true,
          silentDiagnostics: true,
        });
        setFallbackHealth(data.systemHealth);
        if (data.systemHealth.latencyTrend) {
          setLatencyTrend(data.systemHealth.latencyTrend);
        }
      }
    } catch {
      // Non-fatal background health check; retains last known measurement
    }
  }, [token, canReadAuditLogs]);

  useEffect(() => {
    if (!token) {
      setSamples(null);
      setFallbackHealth(null);
      setLatencyTrend([]);
      seenSampleIdsRef.current.clear();
      return;
    }

    fetchHealth();
    const interval = window.setInterval(fetchHealth, 20000);
    return () => window.clearInterval(interval);
  }, [token, refreshSignal, fetchHealth]);

  useEffect(() => {
    if (!token || !telemetryStreamEnabled) return;

    const es = new EventSource('/api/telemetry/stream');
    es.addEventListener('audit', (ev) => {
      if (!canReadAuditLogs) {
        void fetchHealth();
        return;
      }
      try {
        const raw = JSON.parse((ev as MessageEvent).data) as {
          id?: string;
          duration_ms?: number;
          status?: string;
          created_at?: string;
        };
        const sampleId = raw.id || `sse_${Date.now()}`;
        if (seenSampleIdsRef.current.has(sampleId)) return;
        seenSampleIdsRef.current.add(sampleId);
        if (seenSampleIdsRef.current.size > SAMPLE_WINDOW * 4) {
          const trimmed = Array.from(seenSampleIdsRef.current).slice(-SAMPLE_WINDOW * 2);
          seenSampleIdsRef.current = new Set(trimmed);
        }

        const durationMs = Number(raw.duration_ms ?? 0);
        const nextSample: RecentAuditSample = {
          id: sampleId,
          durationMs,
          status: raw.status || 'success',
        };
        setSamples((prev) => {
          if (!prev) return [nextSample];
          if (prev.some((item) => item.id === nextSample.id)) return prev;
          return [nextSample, ...prev].slice(0, SAMPLE_WINDOW);
        });
        setLatencyTrend((prev) => mergeSampleIntoTrend(prev, durationMs, raw.created_at));
      } catch {
        // Ignore malformed SSE payload
      }
    });

    return () => {
      es.close();
    };
  }, [token, telemetryStreamEnabled, canReadAuditLogs, fetchHealth]);

  return useMemo(() => {
    if (samples !== null) {
      const sampleCount = samples.length;
      if (sampleCount === 0) {
        return {
          level: 'healthy',
          label: 'Saudável',
          avgLatencyMs: 0,
          maxLatencyMs: 0,
          sampleCount: 0,
          errorCount: 0,
          latencyTrend,
        };
      }
      let sum = 0;
      let maxLatencyMs = 0;
      let errorCount = 0;
      for (const s of samples) {
        sum += s.durationMs;
        if (s.durationMs > maxLatencyMs) maxLatencyMs = s.durationMs;
        if (s.status === 'error') errorCount += 1;
      }
      const avgLatencyMs = Number((sum / sampleCount).toFixed(1));
      const classification = classifyLatency(avgLatencyMs);
      return {
        level: classification.level,
        label: classification.label,
        avgLatencyMs,
        maxLatencyMs: Number(maxLatencyMs.toFixed(1)),
        sampleCount,
        errorCount,
        latencyTrend,
      };
    }

    if (fallbackHealth !== null) {
      const avgLatencyMs = Number(fallbackHealth.avgLatencyMs.toFixed(1));
      const classification = classifyLatency(avgLatencyMs);
      return {
        level: classification.level,
        label: classification.label,
        avgLatencyMs,
        maxLatencyMs: Number(fallbackHealth.maxLatencyMs.toFixed(1)),
        sampleCount: fallbackHealth.sampleCount,
        errorCount: fallbackHealth.errorCount,
        latencyTrend,
      };
    }

    return {
      level: 'loading',
      label: 'Verificando',
      avgLatencyMs: null,
      maxLatencyMs: null,
      sampleCount: 0,
      errorCount: 0,
      latencyTrend,
    };
  }, [samples, fallbackHealth, latencyTrend]);
}
