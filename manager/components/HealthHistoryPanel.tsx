/**
 * File: HealthHistoryPanel.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Linha do tempo das transições de saúde e latência do sistema registradas pelo backend.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  History,
} from 'lucide-react';
import { InfoTooltip } from './InfoTooltip';
import type { SystemHealthEvent } from '../domains/Identity';

interface HealthHistoryPanelProps {
  events: SystemHealthEvent[];
  sseConnected: boolean;
  expanded?: boolean;
}

type StatusFilter = 'all' | 'critical' | 'degraded' | 'healthy';

const STATUS_META: Record<
  'healthy' | 'degraded' | 'critical',
  {
    label: string;
    textClass: string;
    bgClass: string;
    borderClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  healthy: {
    label: 'Saudável',
    textClass: 'text-emerald-300',
    bgClass: 'bg-emerald-950/50',
    borderClass: 'border-emerald-700/60',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Atenção',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-950/50',
    borderClass: 'border-amber-700/60',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Crítica',
    textClass: 'text-red-300',
    bgClass: 'bg-red-950/50',
    borderClass: 'border-red-700/60',
    icon: AlertOctagon,
  },
};

export const HealthHistoryPanel: React.FC<HealthHistoryPanelProps> = ({
  events,
  sseConnected,
  expanded = false,
}) => {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((ev) => ev.newStatus === filter || ev.previousStatus === filter);
  }, [events, filter]);

  const counts = useMemo(() => {
    let critical = 0;
    let degraded = 0;
    let healthy = 0;
    for (const ev of events) {
      if (ev.newStatus === 'critical') critical += 1;
      else if (ev.newStatus === 'degraded') degraded += 1;
      else healthy += 1;
    }
    return { critical, degraded, healthy };
  }, [events]);

  return (
    <section
      aria-label="Histórico de Saúde do Sistema"
      className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-[#F6821F] shrink-0" />
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Histórico de Saúde do Sistema</h2>
            <InfoTooltip text="Transições persistidas entre Saudável (< 100ms), Atenção (100–299ms) e Crítica (≥ 300ms)." />
            <span className="text-[11px] font-mono tabular-nums text-slate-400">
              · {events.length} registro{events.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400 mr-1">
            {sseConnected ? 'SSE ao vivo' : 'Via GraphQL'}
          </span>
          {(
            [
              { id: 'all', label: `Todos (${events.length})` },
              { id: 'critical', label: `Crítica (${counts.critical})` },
              { id: 'degraded', label: `Atenção (${counts.degraded})` },
              { id: 'healthy', label: `Saudável (${counts.healthy})` },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilter(opt.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                filter === opt.id
                  ? 'bg-[#F6821F]/15 border-[#F6821F]/60 text-white'
                  : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="px-5 py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <Activity className="w-3.5 h-3.5 text-slate-500" />
          <span>Nenhuma transição de saúde encontrada para o filtro selecionado.</span>
        </div>
      ) : (
        <div className={`divide-y divide-slate-800/60 ${expanded ? '' : 'max-h-72 overflow-y-auto'}`}>
          {filteredEvents.map((ev) => {
            const nextMeta = STATUS_META[ev.newStatus] ?? STATUS_META.healthy;
            const NextIcon = nextMeta.icon;
            const prevMeta = ev.previousStatus ? STATUS_META[ev.previousStatus] : null;

            return (
              <div
                key={ev.id}
                className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-800/30 transition-colors"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {prevMeta ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium ${prevMeta.bgClass} ${prevMeta.borderClass} ${prevMeta.textClass}`}
                      >
                        {prevMeta.label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-slate-700 bg-[#090D16] text-[11px] font-medium text-slate-300">
                        Inicial
                      </span>
                    )}

                    <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />

                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold ${nextMeta.bgClass} ${nextMeta.borderClass} ${nextMeta.textClass}`}
                    >
                      <NextIcon className="w-3 h-3 shrink-0" />
                      <span>{nextMeta.label}</span>
                    </span>

                    <span className="text-slate-300 text-xs">{ev.reason}</span>
                  </div>

                  <div className="text-[11px] font-mono tabular-nums text-slate-400">
                    Média {ev.avgLatencyMs.toFixed(1)}ms · Máx {ev.maxLatencyMs.toFixed(1)}ms ·{' '}
                    {ev.sampleCount} amostra{ev.sampleCount === 1 ? '' : 's'}
                    {ev.errorCount > 0 ? ` · ${ev.errorCount} erro(s)` : ''}
                  </div>
                </div>

                <div className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                  {new Date(ev.createdAt).toLocaleString('pt-BR')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
