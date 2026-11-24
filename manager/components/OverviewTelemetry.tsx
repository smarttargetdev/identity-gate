/**
 * File: OverviewTelemetry.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Painel de visão geral com KPIs, gráficos de usuários ativos e respostas, métricas de borda e alertas.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  RefreshCw,
  Trash2,
  Activity,
  Database,
  Zap,
  Radio,
  Users,
  KeyRound,
  ShieldAlert,
  TrendingUp,
  ServerCrash,
  AlertOctagon,
  Eye,
  X,
  CheckCheck,
  Timer,
  ArrowRight,
  ArrowLeft,
  History,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { AuditLogs } from './AuditLogs';
import { HealthHistoryPanel } from './HealthHistoryPanel';
import { InfoTooltip } from './InfoTooltip';
import type {
  AuditLog,
  ComplianceSummary,
  DiagnosticHeaders,
  EdgeMetrics,
  IamSystem,
  IamUser,
  SystemHealthEvent,
} from '../types/Identity';

export type OverviewSection =
  | 'overview'
  | 'overview-stats'
  | 'overview-trend'
  | 'overview-http'
  | 'overview-edge'
  | 'overview-health'
  | 'overview-alerts'
  | 'overview-audit';

interface OverviewTelemetryProps {
  token: string;
  section?: OverviewSection;
  canReadUsers?: boolean;
  canReadAuditLogs?: boolean;
  onNavigateSection?: (section: OverviewSection) => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
}

type RefreshIntervalOption = 10000 | 30000 | 60000 | 0;
type AlertCategoryFilter = 'all' | 'mfa' | 'auth' | 'rbac';

const OVERVIEW_BASE_QUERY = `
  query OverviewBaseTelemetry {
    edgeMetrics {
      cacheHits
      cacheMisses
      cacheBypasses
      cachePurges
      cachedEntriesCount
      cacheHitRatioPct
      kvVersionReads
      p50LatencyMs
      p95LatencyMs
      avgHitLatencyMs
      avgMissLatencyMs
      sqliteTotalReads
      sqliteTotalWrites
      sqliteReadRatioPct
      batchedAuditFlushes
      queuedAuditLogs
      activeSseStreams
    }
    complianceSummary {
      totalUsers
      anonymizedUsers
      activeConsents
      revokedConsents
      mfaAdoptedUsers
      totpUsers
      smsUsers
      piiMaskedLogsCount
    }
    systems {
      id
      name
      slug
    }
    me {
      id
      email
      displayName
      status
      totpEnabled
      phoneVerified
      mfaPreferredMethod
      permVersion
      lastLoginAt
      createdAt
      sessions {
        id
        systemId
        systemName
        authMethod
        ipMasked
        createdAt
        expiresAt
        revokedAt
      }
    }
    systemHealthHistory(limit: 50) {
      id
      previousStatus
      newStatus
      avgLatencyMs
      maxLatencyMs
      sampleCount
      errorCount
      reason
      createdAt
    }
  }
`;

const OVERVIEW_USERS_STATS_FIELDS = `
  users(limit: 200) {
    id
    email
    displayName
    status
    totpEnabled
    phoneVerified
    mfaPreferredMethod
    permVersion
    lastLoginAt
    createdAt
    sessions {
      id
      systemId
      systemName
      authMethod
      ipMasked
      createdAt
      expiresAt
      revokedAt
    }
  }
`;

const OVERVIEW_AUDIT_STATS_FIELDS = `
  auditLogs(limit: 200) {
    id
    traceId
    actorHash
    actorMasked
    systemId
    systemSlug
    action
    resourceType
    resourceId
    status
    cacheStatus
    durationMs
    ipMasked
    detailsJson
    createdAt
  }
`;

const OVERVIEW_ADMIN_STATS_QUERY = `
  query OverviewAdminKeyStats {
    ${OVERVIEW_USERS_STATS_FIELDS}
    ${OVERVIEW_AUDIT_STATS_FIELDS}
  }
`;

const OVERVIEW_USERS_ONLY_QUERY = `
  query OverviewUsersStats {
    ${OVERVIEW_USERS_STATS_FIELDS}
  }
`;

const OVERVIEW_AUDIT_ONLY_QUERY = `
  query OverviewAuditStats {
    ${OVERVIEW_AUDIT_STATS_FIELDS}
  }
`;

const SECTION_META: Record<OverviewSection, { title: string; tooltip: string }> = {
  overview: {
    title: 'Visão Geral',
    tooltip: 'Painel sintético consolidando estatísticas-chave, tendência de 24h, HTTP, borda/SQLite, saúde, alertas e auditoria.',
  },
  'overview-stats': {
    title: 'Estatísticas Gerais',
    tooltip: 'Detalhamento completo de usuários ativos, adoção de 2FA (TOTP/SMS), tokens JWT ativos e sessões por conta.',
  },
  'overview-trend': {
    title: 'Usuários Ativos',
    tooltip: 'Série horária das últimas 24 horas com usuários distintos, sessões ativas e eventos GraphQL/Auth registrados.',
  },
  'overview-http': {
    title: 'Respostas por Sistema',
    tooltip: 'Distribuição empilhada e taxas percentuais de respostas 2xx (Sucesso), 4xx (Negado) e 5xx (Erro) por sistema.',
  },
  'overview-edge': {
    title: 'Borda e Armazenamento',
    tooltip: 'Desempenho de Edge Cache, leituras/gravações SQLite WAL, versões KV e fila assíncrona de auditoria.',
  },
  'overview-health': {
    title: 'Histórico de Saúde do Sistema',
    tooltip: 'Registro completo de transições de latência entre Saudável (< 100ms), Atenção (100–299ms) e Crítica (≥ 300ms).',
  },
  'overview-alerts': {
    title: 'Alertas Recentes',
    tooltip: 'Monitoramento detalhado de tentativas de acesso não autorizadas, falhas de 2FA e bloqueios RBAC via SSE e GraphQL.',
  },
  'overview-audit': {
    title: 'Logs de Auditoria',
    tooltip: 'Trilha completa de auditoria LGPD-safe via GraphQL com busca, filtros avançados, exportação CSV e inspeção JSON.',
  },
};

interface KeyStatsState {
  activeUsers: number;
  totalUsers: number;
  mfaAdoptedUsers: number;
  totpUsers: number;
  smsUsers: number;
  validTokens: number;
  revokedOrExpiredTokens: number;
  recentWarnings: number;
  deniedCount: number;
  errorCount: number;
}

interface HourlyTrendPoint {
  hourDate: Date;
  label: string;
  activeUsers: number;
  activeSessions: number;
  eventsCount: number;
}

interface HttpStatusSystemRow {
  systemName: string;
  systemSlug: string;
  s2xx: number;
  s4xx: number;
  s5xx: number;
  total: number;
}

interface ActiveUsersTrendChartProps {
  data: HourlyTrendPoint[];
  diagnostics: DiagnosticHeaders | null;
  compact?: boolean;
  onDetail?: () => void;
}

const ActiveUsersTrendChart: React.FC<ActiveUsersTrendChartProps> = ({
  data,
  diagnostics,
  compact = false,
  onDetail,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(760);
  const [hovered, setHovered] = useState<{ point: HourlyTrendPoint; x: number; y: number } | null>(null);

  const chartHeight = compact ? 130 : 230;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth && nextWidth > 200) {
        setWidth(Math.floor(nextWidth));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const height = chartHeight;
    const margin = compact
      ? { top: 10, right: 14, bottom: 22, left: 30 }
      : { top: 16, right: 20, bottom: 28, left: 38 };
    const innerWidth = Math.max(120, width - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', compact ? 'activeUsersAreaGradCompact' : 'activeUsersAreaGradFull')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#F6821F').attr('stop-opacity', 0.28);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#F6821F').attr('stop-opacity', 0.01);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(data, (d) => d.hourDate) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerWidth]);

    const maxUsers = d3.max(data, (d) => d.activeUsers) ?? 0;
    const yMax = Math.max(4, Math.ceil(maxUsers * 1.25));
    const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

    const yTicks = yScale.ticks(compact ? 3 : 4);
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'rgba(148, 163, 184, 0.1)')
      .attr('stroke-dasharray', '3,3');

    const xAxis = d3
      .axisBottom<Date>(xScale)
      .ticks(compact ? 4 : 6)
      .tickFormat((d) => d3.timeFormat('%H:%M')(d));
    const yAxis = d3.axisLeft<number>(yScale).ticks(compact ? 3 : 4).tickFormat((d) => `${Math.round(d)}`);

    const xAxisG = g.append('g').attr('transform', `translate(0,${innerHeight})`).call(xAxis);
    xAxisG.selectAll('path, line').attr('stroke', 'rgba(148, 163, 184, 0.2)');
    xAxisG
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .style('font-family', '"JetBrains Mono", monospace')
      .style('font-size', '10px');

    const yAxisG = g.append('g').call(yAxis);
    yAxisG.selectAll('path, line').attr('stroke', 'rgba(148, 163, 184, 0.2)');
    yAxisG
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .style('font-family', '"JetBrains Mono", monospace')
      .style('font-size', '10px');

    const areaGen = d3
      .area<HourlyTrendPoint>()
      .x((d) => xScale(d.hourDate))
      .y0(innerHeight)
      .y1((d) => yScale(d.activeUsers))
      .curve(d3.curveMonotoneX);

    const lineGen = d3
      .line<HourlyTrendPoint>()
      .x((d) => xScale(d.hourDate))
      .y((d) => yScale(d.activeUsers))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', `url(#${compact ? 'activeUsersAreaGradCompact' : 'activeUsersAreaGradFull'})`)
      .attr('d', areaGen);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#F6821F')
      .attr('stroke-width', 2)
      .attr('d', lineGen);

    g.selectAll('circle.trend-dot')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'trend-dot')
      .attr('cx', (d) => xScale(d.hourDate))
      .attr('cy', (d) => yScale(d.activeUsers))
      .attr('r', compact ? 2 : 2.8)
      .attr('fill', '#090D16')
      .attr('stroke', '#F6821F')
      .attr('stroke-width', 1.5);

    const focusLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'rgba(246, 130, 31, 0.45)')
      .attr('stroke-dasharray', '2,2')
      .style('opacity', 0);

    const bisectDate = d3.bisector<HourlyTrendPoint, Date>((d) => d.hourDate).left;

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const hoveredDate = xScale.invert(mx);
        const idx = bisectDate(data, hoveredDate, 1);
        const d0 = data[idx - 1];
        const d1 = data[idx];
        const closest =
          !d1 || !d0
            ? d0 || d1
            : hoveredDate.getTime() - d0.hourDate.getTime() > d1.hourDate.getTime() - hoveredDate.getTime()
              ? d1
              : d0;

        if (!closest) return;
        const cx = xScale(closest.hourDate);
        const cy = yScale(closest.activeUsers);
        focusLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
        setHovered({ point: closest, x: margin.left + cx, y: margin.top + cy });
      })
      .on('mouseleave', () => {
        focusLine.style('opacity', 0);
        setHovered(null);
      });
  }, [data, width, chartHeight, compact]);

  const peakUsers = useMemo(() => Math.max(0, ...data.map((d) => d.activeUsers)), [data]);
  const currentUsers = data.length > 0 ? data[data.length - 1].activeUsers : 0;

  return (
    <section
      aria-label="Usuários Ativos"
      className={`bg-[#111827] border border-slate-800/90 rounded-lg ${compact ? 'p-4 space-y-2.5' : 'p-5 space-y-4'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#F6821F] shrink-0" />
          <h2 className="text-sm font-semibold text-white">Usuários Ativos</h2>
          <InfoTooltip text="Sessões ativas e acessos distintos registrados pelos resolvedores GraphQL nas últimas 24 horas." />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-400">
          <span>
            Atual: <strong className="text-white">{currentUsers}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Pico: <strong className="text-[#F6821F]">{peakUsers}</strong>
          </span>
          {!compact && diagnostics && (
            <>
              <span aria-hidden="true">·</span>
              <span className={diagnostics.cacheStatus === 'HIT' ? 'text-emerald-400' : 'text-amber-400'}>
                CF:{diagnostics.cacheStatus}
              </span>
              <span aria-hidden="true">·</span>
              <span>{diagnostics.durationMs.toFixed(1)}ms</span>
              <span aria-hidden="true">·</span>
              <span>SQL:{diagnostics.sqliteQueriesCount}</span>
            </>
          )}
          {onDetail && (
            <button
              type="button"
              onClick={onDetail}
              className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors ml-1"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="relative w-full">
        <svg ref={svgRef} width={width} height={chartHeight} className="w-full overflow-visible block" />

        {hovered && (
          <div
            style={{
              left: Math.min(Math.max(12, hovered.x + 12), Math.max(12, width - 190)),
              top: Math.max(8, hovered.y - 44),
            }}
            className="pointer-events-none absolute z-10 bg-[#090D16]/95 border border-slate-700 rounded-md px-3 py-2 text-[11px] font-mono tabular-nums shadow-xl space-y-0.5"
          >
            <div className="text-slate-400">{hovered.point.label}</div>
            <div className="text-white">
              Usuários ativos: <span className="text-[#F6821F] font-semibold">{hovered.point.activeUsers}</span>
            </div>
            <div className="text-slate-300">Sessões ativas: {hovered.point.activeSessions}</div>
            <div className="text-slate-400">Eventos GraphQL/Auth: {hovered.point.eventsCount}</div>
          </div>
        )}
      </div>
    </section>
  );
};

interface HttpStatusWidgetProps {
  data: HttpStatusSystemRow[];
  compact?: boolean;
  onDetail?: () => void;
}

const HttpStatusDistributionWidget: React.FC<HttpStatusWidgetProps> = ({
  data,
  compact = false,
  onDetail,
}) => {
  const totals = useMemo(() => {
    return data.reduce(
      (acc, row) => ({
        s2xx: acc.s2xx + row.s2xx,
        s4xx: acc.s4xx + row.s4xx,
        s5xx: acc.s5xx + row.s5xx,
      }),
      { s2xx: 0, s4xx: 0, s5xx: 0 }
    );
  }, [data]);

  return (
    <section
      aria-label="Respostas por Sistema"
      className={`bg-[#111827] border border-slate-800/90 rounded-lg ${compact ? 'p-4 space-y-2.5' : 'p-5 space-y-4'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <ServerCrash className="w-4 h-4 text-[#F6821F] shrink-0" />
          <h2 className="text-sm font-semibold text-white">Respostas por Sistema</h2>
          <InfoTooltip text="Distribuição de respostas 2xx (Sucesso), 4xx (Negado) e 5xx (Erro) entre todos os sistemas monitorados." />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-400">
          <span>
            2xx: <strong className="text-emerald-400">{totals.s2xx}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            4xx: <strong className="text-[#F6821F]">{totals.s4xx}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            5xx: <strong className="text-red-400">{totals.s5xx}</strong>
          </span>
          {onDetail && (
            <button
              type="button"
              onClick={onDetail}
              className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors ml-1"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className={`w-full ${compact ? 'h-[130px]' : 'h-[230px]'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 2 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.1)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="systemSlug"
              tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              tickLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: '"JetBrains Mono", monospace' }}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              tickLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.06)' }}
              contentStyle={{
                backgroundColor: '#090D16',
                borderColor: '#334155',
                borderRadius: '0.375rem',
                fontSize: '11px',
                fontFamily: '"JetBrains Mono", monospace',
                color: '#f1f5f9',
              }}
              labelFormatter={(_label, payload) => {
                const row = payload?.[0]?.payload as HttpStatusSystemRow | undefined;
                return row ? `${row.systemName} (${row.systemSlug})` : String(_label);
              }}
            />
            {!compact && (
              <Legend
                wrapperStyle={{
                  fontSize: '11px',
                  fontFamily: '"JetBrains Mono", monospace',
                  paddingTop: '4px',
                }}
              />
            )}
            <Bar dataKey="s2xx" name="2xx Sucesso" stackId="http" fill="#10b981" />
            <Bar dataKey="s4xx" name="4xx Negado" stackId="http" fill="#F6821F" />
            <Bar dataKey="s5xx" name="5xx Erro" stackId="http" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

interface RecentAlertsListProps {
  alerts: AuditLog[];
  unreadIds: Set<string>;
  sseConnected: boolean;
  refreshIntervalMs: RefreshIntervalOption;
  onMarkAllRead: () => void;
  expanded?: boolean;
  maxItems?: number;
  onDetail?: () => void;
}

function isSecurityAlertLog(log: Pick<AuditLog, 'status' | 'action'>): boolean {
  return (
    log.status === 'denied' ||
    log.status === 'error' ||
    /AUTH_LOGIN_FAILED|AUTH_MFA_VERIFY_FAILED|MFA_.*FAILED|UNAUTHORIZED|FORBIDDEN|DENIED|LOCKED/i.test(
      log.action
    )
  );
}

function classifyAlertCategory(action: string): Exclude<AlertCategoryFilter, 'all'> {
  if (/MFA/i.test(action)) return 'mfa';
  if (/LOGIN|AUTH/i.test(action)) return 'auth';
  return 'rbac';
}

function classifyAlertLabel(action: string): { title: string; tone: 'amber' | 'red' } {
  const cat = classifyAlertCategory(action);
  if (cat === 'mfa') {
    return { title: 'Falha de 2FA', tone: 'amber' };
  }
  if (cat === 'auth') {
    return { title: 'Tentativa de Acesso Não Autorizada', tone: 'red' };
  }
  return { title: 'Acesso Negado (RBAC / Política)', tone: 'amber' };
}

const RecentAlertsList: React.FC<RecentAlertsListProps> = ({
  alerts,
  unreadIds,
  sseConnected,
  refreshIntervalMs,
  onMarkAllRead,
  expanded = false,
  maxItems = 15,
  onDetail,
}) => {
  const [inspectingAlert, setInspectingAlert] = useState<AuditLog | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<AlertCategoryFilter>('all');

  const pollingLabel =
    refreshIntervalMs === 0
      ? 'Polling off'
      : refreshIntervalMs === 60000
        ? 'Polling 1min'
        : `Polling ${refreshIntervalMs / 1000}s`;

  const counts = useMemo(() => {
    let mfa = 0;
    let auth = 0;
    let rbac = 0;
    for (const a of alerts) {
      const cat = classifyAlertCategory(a.action);
      if (cat === 'mfa') mfa += 1;
      else if (cat === 'auth') auth += 1;
      else rbac += 1;
    }
    return { mfa, auth, rbac };
  }, [alerts]);

  const displayedAlerts = useMemo(() => {
    const filtered =
      categoryFilter === 'all'
        ? alerts
        : alerts.filter((a) => classifyAlertCategory(a.action) === categoryFilter);
    return filtered.slice(0, expanded ? 50 : maxItems);
  }, [alerts, categoryFilter, expanded, maxItems]);

  return (
    <section
      aria-label="Alertas Recentes de Segurança"
      className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <AlertOctagon
            className={`w-4 h-4 shrink-0 ${alerts.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}
          />
          <h2 className="text-sm font-semibold text-white">Alertas Recentes</h2>
          <InfoTooltip text="Monitoramento em tempo real de tentativas de acesso não autorizadas e falhas de autenticação 2FA." />
          {unreadIds.size > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-amber-400">
              · {unreadIds.size} novo{unreadIds.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
          {expanded && (
            <div className="flex flex-wrap items-center gap-1 font-sans mr-1">
              {(
                [
                  { id: 'all', label: `Todos (${alerts.length})` },
                  { id: 'auth', label: `Acesso (${counts.auth})` },
                  { id: 'mfa', label: `2FA (${counts.mfa})` },
                  { id: 'rbac', label: `RBAC (${counts.rbac})` },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCategoryFilter(opt.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                    categoryFilter === opt.id
                      ? 'bg-[#F6821F]/15 border-[#F6821F]/60 text-white'
                      : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <span>{sseConnected ? `SSE · ${pollingLabel}` : pollingLabel}</span>
          {unreadIds.size > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-sans font-medium bg-[#090D16] border border-slate-700 hover:border-slate-500 text-slate-200 rounded transition-colors"
            >
              <CheckCheck className="w-3 h-3 text-emerald-400" />
              <span>Marcar lidos</span>
            </button>
          )}
          {onDetail && (
            <button
              type="button"
              onClick={onDetail}
              className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {displayedAlerts.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-slate-500">
          Nenhuma tentativa de acesso não autorizada ou falha de 2FA detectada.
        </div>
      ) : (
        <div className={`divide-y divide-slate-800/60 ${expanded ? '' : 'max-h-56 overflow-y-auto'}`}>
          {displayedAlerts.map((alert) => {
            const meta = classifyAlertLabel(alert.action);
            const isUnread = unreadIds.has(alert.id);
            return (
              <div
                key={alert.id}
                onClick={() => setInspectingAlert(alert)}
                className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  isUnread ? 'bg-amber-950/20 hover:bg-amber-950/30' : 'hover:bg-slate-800/35'
                }`}
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        meta.tone === 'red' ? 'text-red-400' : 'text-amber-400'
                      }`}
                    >
                      {meta.title}
                    </span>
                    <span className="text-slate-500" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-200 truncate">{alert.action}</span>
                    {isUnread && (
                      <span className="font-mono text-[11px] text-amber-300">· NOVO</span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">
                    Ator {alert.actorMasked} · IP {alert.ipMasked} · {alert.systemSlug || 'global'}
                    {expanded ? ` · Trace ${alert.traceId}` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {new Date(alert.createdAt).toLocaleTimeString('pt-BR')}
                  </span>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setInspectingAlert(alert);
                    }}
                    title="Inspecionar Alerta"
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Popup Detail Inspector for Security Alert */}
      {inspectingAlert && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Alerta de Segurança · <span className="font-mono">{inspectingAlert.action}</span>
                </h3>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  {new Date(inspectingAlert.createdAt).toLocaleString('pt-BR')} · Trace {inspectingAlert.traceId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingAlert(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="bg-[#090D16] border border-slate-800 rounded-md p-3.5 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
              {JSON.stringify(
                {
                  ...inspectingAlert,
                  details: (() => {
                    try {
                      return JSON.parse(inspectingAlert.detailsJson);
                    } catch {
                      return inspectingAlert.detailsJson;
                    }
                  })(),
                },
                null,
                2
              )}
            </pre>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingAlert(null)}
                className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export const OverviewTelemetry: React.FC<OverviewTelemetryProps> = ({
  token,
  section = 'overview',
  canReadUsers = false,
  canReadAuditLogs = false,
  onNavigateSection,
  onNotify,
}) => {
  const [metrics, setMetrics] = useState<EdgeMetrics | null>(null);
  const [keyStats, setKeyStats] = useState<KeyStatsState | null>(null);
  const [systemsSnapshot, setSystemsSnapshot] = useState<Array<Pick<IamSystem, 'id' | 'name' | 'slug'>>>([]);
  const [usersSnapshot, setUsersSnapshot] = useState<IamUser[]>([]);
  const [logsSnapshot, setLogsSnapshot] = useState<AuditLog[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<AuditLog[]>([]);
  const [healthHistory, setHealthHistory] = useState<SystemHealthEvent[]>([]);
  const [unreadAlertIds, setUnreadAlertIds] = useState<Set<string>>(new Set());
  const [sseConnected, setSseConnected] = useState(false);
  const [lastDiag, setLastDiag] = useState<DiagnosticHeaders | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<RefreshIntervalOption>(10000);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const initialAlertsLoadedRef = useRef(false);
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  const computeWarningsFromLogs = (logs: Array<Pick<AuditLog, 'status' | 'action'>>) => {
    let deniedCount = 0;
    let errorCount = 0;
    let securityAlertCount = 0;

    for (const log of logs) {
      if (log.status === 'denied') deniedCount += 1;
      if (log.status === 'error') errorCount += 1;
      const isWarningAction =
        log.status !== 'success' || /FAILED|LOCKED|REVOKED|DENIED/i.test(log.action);
      if (isWarningAction) securityAlertCount += 1;
    }
    return { securityAlertCount, deniedCount, errorCount };
  };

  const loadData = useCallback(async () => {
    try {
      const { data: baseData, diagnostics: baseDiag } = await gqlRequest<{
        edgeMetrics: EdgeMetrics;
        complianceSummary: ComplianceSummary;
        systems: Array<Pick<IamSystem, 'id' | 'name' | 'slug'>>;
        me: IamUser | null;
        systemHealthHistory: SystemHealthEvent[];
      }>({
        token,
        query: OVERVIEW_BASE_QUERY,
        operationName: 'OverviewBaseTelemetry',
      });
      setMetrics(baseData.edgeMetrics);
      setSystemsSnapshot(baseData.systems || []);
      setHealthHistory(baseData.systemHealthHistory || []);
      setLastDiag(baseDiag);

      const nowMs = Date.now();
      let activeUsers = Math.max(
        0,
        baseData.complianceSummary.totalUsers - baseData.complianceSummary.anonymizedUsers
      );
      let validTokens = 0;
      let revokedOrExpiredTokens = 0;
      let recentWarnings = 0;
      let deniedCount = 0;
      let errorCount = 0;

      if (canReadUsers || canReadAuditLogs) {
        try {
          let usersList: IamUser[] | null = null;
          let logsList: AuditLog[] | null = null;

          if (canReadUsers && canReadAuditLogs) {
            const { data: adminData, diagnostics: adminDiag } = await gqlRequest<{
              users: IamUser[];
              auditLogs: AuditLog[];
            }>({
              token,
              query: OVERVIEW_ADMIN_STATS_QUERY,
              operationName: 'OverviewAdminKeyStats',
            });
            setLastDiag(adminDiag);
            usersList = adminData.users;
            logsList = adminData.auditLogs;
          } else if (canReadUsers) {
            const { data: usersData, diagnostics: usersDiag } = await gqlRequest<{
              users: IamUser[];
            }>({
              token,
              query: OVERVIEW_USERS_ONLY_QUERY,
              operationName: 'OverviewUsersStats',
            });
            setLastDiag(usersDiag);
            usersList = usersData.users;
          } else if (canReadAuditLogs) {
            const { data: auditData, diagnostics: auditDiag } = await gqlRequest<{
              auditLogs: AuditLog[];
            }>({
              token,
              query: OVERVIEW_AUDIT_ONLY_QUERY,
              operationName: 'OverviewAuditStats',
            });
            setLastDiag(auditDiag);
            logsList = auditData.auditLogs;
          }

          if (usersList) {
            setUsersSnapshot(usersList);
            activeUsers = usersList.filter((u) => u.status === 'active').length;
            for (const u of usersList) {
              for (const s of u.sessions || []) {
                if (!s.revokedAt && Date.parse(s.expiresAt) > nowMs) {
                  validTokens += 1;
                } else {
                  revokedOrExpiredTokens += 1;
                }
              }
            }
          } else {
            if (baseData.me) {
              setUsersSnapshot([baseData.me]);
            }
            for (const s of baseData.me?.sessions || []) {
              if (!s.revokedAt && Date.parse(s.expiresAt) > nowMs) {
                validTokens += 1;
              } else {
                revokedOrExpiredTokens += 1;
              }
            }
          }

          if (logsList) {
            setLogsSnapshot(logsList);
            const extractedAlerts = logsList.filter(isSecurityAlertLog);
            setRecentAlerts(extractedAlerts);

            if (!initialAlertsLoadedRef.current) {
              for (const a of extractedAlerts) {
                seenAlertIdsRef.current.add(a.id);
              }
              initialAlertsLoadedRef.current = true;
            } else {
              const newlyDetected = extractedAlerts.filter((a) => !seenAlertIdsRef.current.has(a.id));
              if (newlyDetected.length > 0) {
                for (const a of newlyDetected) {
                  seenAlertIdsRef.current.add(a.id);
                }
                setUnreadAlertIds((prev) => {
                  const next = new Set(prev);
                  for (const a of newlyDetected) next.add(a.id);
                  return next;
                });
                const newest = newlyDetected[0];
                const meta = classifyAlertLabel(newest.action);
                onNotifyRef.current(
                  `Alerta em tempo real: ${meta.title} (${newest.actorMasked} · ${newest.ipMasked})`,
                  'warning'
                );
              }
            }

            const warnSummary = computeWarningsFromLogs(logsList);
            recentWarnings = warnSummary.securityAlertCount;
            deniedCount = warnSummary.deniedCount;
            errorCount = warnSummary.errorCount;
          }
        } catch {
          if (baseData.me) {
            setUsersSnapshot([baseData.me]);
          }
          for (const s of baseData.me?.sessions || []) {
            if (!s.revokedAt && Date.parse(s.expiresAt) > nowMs) {
              validTokens += 1;
            } else {
              revokedOrExpiredTokens += 1;
            }
          }
        }
      } else {
        if (baseData.me) {
          setUsersSnapshot([baseData.me]);
        }
        for (const s of baseData.me?.sessions || []) {
          if (!s.revokedAt && Date.parse(s.expiresAt) > nowMs) {
            validTokens += 1;
          } else {
            revokedOrExpiredTokens += 1;
          }
        }
      }

      setKeyStats({
        activeUsers,
        totalUsers: baseData.complianceSummary.totalUsers,
        mfaAdoptedUsers: baseData.complianceSummary.mfaAdoptedUsers,
        totpUsers: baseData.complianceSummary.totpUsers,
        smsUsers: baseData.complianceSummary.smsUsers,
        validTokens,
        revokedOrExpiredTokens,
        recentWarnings,
        deniedCount,
        errorCount,
      });
    } catch (err) {
      onNotifyRef.current(err instanceof Error ? err.message : 'Erro ao carregar telemetria GraphQL.', 'error');
    }
  }, [token, canReadUsers, canReadAuditLogs]);

  useEffect(() => {
    void loadData();

    const es = new EventSource('/api/telemetry/stream');
    es.addEventListener('connected', () => setSseConnected(true));
    es.addEventListener('audit', (ev) => {
      try {
        const raw = JSON.parse((ev as MessageEvent).data) as {
          id: string;
          trace_id: string;
          actor_hash: string;
          actor_masked: string;
          system_id: string | null;
          system_slug: string | null;
          action: string;
          resource_type: string;
          resource_id: string;
          status: 'success' | 'denied' | 'error';
          cache_status: string;
          duration_ms: number;
          ip_masked: string;
          details_json: string;
          created_at: string;
        };
        const mapped: AuditLog = {
          id: raw.id,
          traceId: raw.trace_id,
          actorHash: raw.actor_hash,
          actorMasked: raw.actor_masked,
          systemId: raw.system_id,
          systemSlug: raw.system_slug,
          action: raw.action,
          resourceType: raw.resource_type,
          resourceId: raw.resource_id,
          status: raw.status,
          cacheStatus: raw.cache_status,
          durationMs: raw.duration_ms,
          ipMasked: raw.ip_masked,
          detailsJson: raw.details_json,
          createdAt: raw.created_at,
        };

        setLogsSnapshot((prev) =>
          prev.some((item) => item.id === mapped.id) ? prev : [mapped, ...prev.slice(0, 199)]
        );

        if (isSecurityAlertLog(mapped) && !seenAlertIdsRef.current.has(mapped.id)) {
          seenAlertIdsRef.current.add(mapped.id);
          setRecentAlerts((prev) => [mapped, ...prev.slice(0, 49)]);
          setUnreadAlertIds((prev) => {
            const next = new Set(prev);
            next.add(mapped.id);
            return next;
          });
          const meta = classifyAlertLabel(mapped.action);
          onNotifyRef.current(
            `Alerta em tempo real: ${meta.title} (${mapped.actorMasked} · ${mapped.ipMasked})`,
            'warning'
          );
        }
      } catch {
        // ignore malformed stream payload
      }
    });
    es.addEventListener('health_transition', (ev) => {
      try {
        const raw = JSON.parse((ev as MessageEvent).data) as {
          id: string;
          previous_status: 'healthy' | 'degraded' | 'critical' | null;
          new_status: 'healthy' | 'degraded' | 'critical';
          avg_latency_ms: number;
          max_latency_ms: number;
          sample_count: number;
          error_count: number;
          reason: string;
          created_at: string;
        };
        const mapped: SystemHealthEvent = {
          id: raw.id,
          previousStatus: raw.previous_status,
          newStatus: raw.new_status,
          avgLatencyMs: raw.avg_latency_ms,
          maxLatencyMs: raw.max_latency_ms,
          sampleCount: raw.sample_count,
          errorCount: raw.error_count,
          reason: raw.reason,
          createdAt: raw.created_at,
        };
        setHealthHistory((prev) =>
          prev.some((item) => item.id === mapped.id) ? prev : [mapped, ...prev].slice(0, 50)
        );
      } catch {
        // ignore malformed health_transition payload
      }
    });
    es.onerror = () => setSseConnected(false);

    return () => {
      es.close();
    };
  }, [loadData]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const pollTimer = window.setInterval(() => {
      void loadData();
    }, refreshIntervalMs);
    return () => window.clearInterval(pollTimer);
  }, [refreshIntervalMs, loadData]);

  const handleLogsUpdated = useCallback((updatedLogs: AuditLog[]) => {
    setLogsSnapshot(updatedLogs);
    setRecentAlerts(updatedLogs.filter(isSecurityAlertLog));
    const warnSummary = computeWarningsFromLogs(updatedLogs);
    setKeyStats((prev) =>
      prev
        ? {
            ...prev,
            recentWarnings: warnSummary.securityAlertCount,
            deniedCount: warnSummary.deniedCount,
            errorCount: warnSummary.errorCount,
          }
        : prev
    );
  }, []);

  const activeUsers24hTrend = useMemo<HourlyTrendPoint[]>(() => {
    const now = new Date();
    const currentHourStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0
    ).getTime();

    const buckets: HourlyTrendPoint[] = [];
    for (let offset = 23; offset >= 0; offset -= 1) {
      const startMs = currentHourStart - offset * 3600 * 1000;
      const endMs = startMs + 3600 * 1000;
      const hourDate = new Date(startMs);
      const label = d3.timeFormat('%d/%m %H:00')(hourDate);

      const distinctActors = new Set<string>();
      let activeSessions = 0;
      let eventsCount = 0;

      for (const user of usersSnapshot) {
        let userActiveInBucket = false;
        for (const ses of user.sessions || []) {
          const sesStart = Date.parse(ses.createdAt);
          const sesEnd = ses.revokedAt ? Date.parse(ses.revokedAt) : Date.parse(ses.expiresAt);
          if (!Number.isNaN(sesStart) && !Number.isNaN(sesEnd) && sesStart <= endMs && sesEnd >= startMs) {
            activeSessions += 1;
            userActiveInBucket = true;
          }
        }
        if (user.lastLoginAt) {
          const loginMs = Date.parse(user.lastLoginAt);
          if (!Number.isNaN(loginMs) && loginMs >= startMs && loginMs <= endMs) {
            userActiveInBucket = true;
          }
        }
        if (userActiveInBucket) {
          distinctActors.add(user.id);
        }
      }

      for (const log of logsSnapshot) {
        const logMs = Date.parse(log.createdAt);
        if (!Number.isNaN(logMs) && logMs >= startMs && logMs <= endMs) {
          eventsCount += 1;
          if (log.actorHash && log.actorHash !== 'anonymous') {
            distinctActors.add(log.actorHash);
          }
        }
      }

      buckets.push({
        hourDate,
        label,
        activeUsers: distinctActors.size,
        activeSessions,
        eventsCount,
      });
    }

    return buckets;
  }, [usersSnapshot, logsSnapshot]);

  const httpStatusBySystem24h = useMemo<HttpStatusSystemRow[]>(() => {
    const cutoffMs = Date.now() - 24 * 3600 * 1000;
    const map = new Map<string, HttpStatusSystemRow>();

    for (const sys of systemsSnapshot) {
      map.set(sys.slug, {
        systemName: sys.name,
        systemSlug: sys.slug,
        s2xx: 0,
        s4xx: 0,
        s5xx: 0,
        total: 0,
      });
    }

    for (const log of logsSnapshot) {
      const logMs = Date.parse(log.createdAt);
      if (Number.isNaN(logMs) || logMs < cutoffMs) continue;

      const slug = log.systemSlug || 'global';
      if (!map.has(slug)) {
        map.set(slug, {
          systemName: slug === 'global' ? 'Identity Secure Gate (ISG) Global' : slug,
          systemSlug: slug,
          s2xx: 0,
          s4xx: 0,
          s5xx: 0,
          total: 0,
        });
      }
      const entry = map.get(slug)!;
      if (log.status === 'success') entry.s2xx += 1;
      else if (log.status === 'denied') entry.s4xx += 1;
      else entry.s5xx += 1;
      entry.total += 1;
    }

    return Array.from(map.values());
  }, [systemsSnapshot, logsSnapshot]);

  const handlePurgeCache = async () => {
    try {
      const { data } = await gqlRequest<{ purgeEdgeCache: number }>({
        token,
        query: `mutation PurgeAll { purgeEdgeCache }`,
        operationName: 'PurgeAll',
      });
      onNotify(`Cache de borda invalidado (${data.purgeEdgeCache} entradas removidas).`, 'success');
      setRefreshTick((t) => t + 1);
      void loadData();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Sem permissão para purgar cache.', 'error');
    }
  };

  const handleRefreshAll = () => {
    setRefreshTick((t) => t + 1);
    void loadData();
  };

  const go = (target: OverviewSection) => {
    onNavigateSection?.(target);
  };

  const sectionInfo = SECTION_META[section];
  const nowMs = Date.now();

  const renderHeaderControls = () => (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        {section !== 'overview' && onNavigateSection && (
          <button
            type="button"
            onClick={() => go('overview')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white rounded-md transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Visão Geral</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold text-white">{sectionInfo.title}</h1>
          <InfoTooltip text={sectionInfo.tooltip} />
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
        <div
          title="Atualização"
          className="relative group flex-1 min-w-0 flex items-center gap-1.5 bg-[#111827] border border-slate-700/80 rounded-md px-2.5 py-2"
        >
          <Timer className="w-3.5 h-3.5 text-[#F6821F] shrink-0" />
          <select
            id="overview-refresh-interval"
            aria-label="Atualização"
            title="Atualização"
            value={refreshIntervalMs}
            onChange={(e) => setRefreshIntervalMs(Number(e.target.value) as RefreshIntervalOption)}
            className="w-full flex-1 min-w-0 bg-transparent text-xs font-mono text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value={10000} className="bg-[#090D16]">10 segundos</option>
            <option value={30000} className="bg-[#090D16]">30 segundos</option>
            <option value={60000} className="bg-[#090D16]">60 segundos</option>
            <option value={0} className="bg-[#090D16]">Desativado</option>
          </select>
          <span
            role="tooltip"
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
          >
            Atualização
          </span>
        </div>
        <button
          type="button"
          onClick={handleRefreshAll}
          aria-label="Atualizar"
          title="Atualizar"
          className="relative group flex items-center justify-center p-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 rounded-md transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span
            role="tooltip"
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
          >
            Atualizar
          </span>
        </button>
        <button
          type="button"
          onClick={handlePurgeCache}
          aria-label="Limpar"
          title="Limpar"
          className="relative group flex items-center justify-center p-2 text-xs font-medium bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span
            role="tooltip"
            className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
          >
            Limpar
          </span>
        </button>
      </div>
    </div>
  );

  // Detailed Submenu: Estatísticas-Chave
  if (section === 'overview-stats') {
    return (
      <div className="space-y-6">
        {renderHeaderControls()}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Usuários Ativos</span>
              <Users className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {keyStats ? keyStats.activeUsers : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {keyStats ? `de ${keyStats.totalUsers} cadastrados` : 'Consultando GraphQL...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Adoção de 2FA</span>
              <ShieldCheck className="w-4 h-4 text-[#F6821F]" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {keyStats ? keyStats.mfaAdoptedUsers : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {keyStats ? `${keyStats.totpUsers} TOTP · ${keyStats.smsUsers} SMS` : 'Consultando GraphQL...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Tokens JWT Válidos</span>
              <KeyRound className="w-4 h-4 text-sky-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {keyStats ? keyStats.validTokens : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {keyStats ? `${keyStats.revokedOrExpiredTokens} revogados ou expirados` : 'Consultando GraphQL...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Alertas de Segurança</span>
              <ShieldAlert className={`w-4 h-4 ${keyStats && keyStats.recentWarnings > 0 ? 'text-amber-400' : 'text-slate-400'}`} />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {keyStats ? keyStats.recentWarnings : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {keyStats ? `${keyStats.deniedCount} negados · ${keyStats.errorCount} erros` : 'Consultando GraphQL...'}
            </div>
          </div>
        </div>

        <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#F6821F]" />
              <h2 className="text-sm font-semibold text-white">Inventário de Usuários, 2FA e Sessões JWT</h2>
              <InfoTooltip text="Detalhamento por usuário de status da conta, métodos 2FA configurados, versão de permissão e tokens ativos." />
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-400">
              {usersSnapshot.length} conta{usersSnapshot.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#090D16]/70 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Usuário</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">2FA (TOTP / SMS)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Sessões Ativas</th>
                  <th className="py-2.5 px-4 font-medium text-right">Expiradas/Revogadas</th>
                  <th className="py-2.5 px-4 font-medium text-right">perm_ver</th>
                  <th className="py-2.5 px-4 font-medium text-right">Último Acesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {usersSnapshot.map((u) => {
                  const sessions = u.sessions || [];
                  const activeCount = sessions.filter((s) => !s.revokedAt && Date.parse(s.expiresAt) > nowMs).length;
                  const inactiveCount = sessions.length - activeCount;
                  return (
                    <tr key={u.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-white">{u.displayName}</div>
                        <div className="text-[11px] font-mono text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        <span className={u.status === 'active' ? 'text-emerald-400' : 'text-red-400'}>
                          {u.status === 'active' ? 'Ativo' : 'Bloqueado'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                        {u.totpEnabled ? 'TOTP' : '—'} · {u.phoneVerified ? 'SMS' : '—'} ({u.mfaPreferredMethod})
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-400">
                        {activeCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {inactiveCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                        v{u.permVersion}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : 'Nunca'}
                      </td>
                    </tr>
                  );
                })}
                {usersSnapshot.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Nenhum dado de usuário carregado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // Detailed Submenu: Tendência (24h)
  if (section === 'overview-trend') {
    const totalEvents24h = activeUsers24hTrend.reduce((acc, p) => acc + p.eventsCount, 0);
    const peakSessions = Math.max(0, ...activeUsers24hTrend.map((p) => p.activeSessions));
    const avgUsers =
      activeUsers24hTrend.length > 0
        ? (activeUsers24hTrend.reduce((acc, p) => acc + p.activeUsers, 0) / activeUsers24hTrend.length).toFixed(1)
        : '0.0';

    return (
      <div className="space-y-6">
        {renderHeaderControls()}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Média Horária de Usuários Ativos</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">{avgUsers}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Pico de Sessões Simultâneas (24h)</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-[#F6821F]">{peakSessions}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Eventos GraphQL / Auth (24h)</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-emerald-400">{totalEvents24h}</div>
          </div>
        </div>

        <ActiveUsersTrendChart data={activeUsers24hTrend} diagnostics={lastDiag} />

        <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#F6821F]" />
              <h2 className="text-sm font-semibold text-white">Detalhamento por Janela Horária (24 Pontos)</h2>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#090D16] border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Janela Horária</th>
                  <th className="py-2.5 px-4 font-medium text-right">Usuários Ativos</th>
                  <th className="py-2.5 px-4 font-medium text-right">Sessões Ativas</th>
                  <th className="py-2.5 px-4 font-medium text-right">Eventos GraphQL/Auth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                {[...activeUsers24hTrend].reverse().map((pt) => (
                  <tr key={pt.label} className="hover:bg-slate-800/30">
                    <td className="py-2 px-4 text-slate-300">{pt.label}</td>
                    <td className="py-2 px-4 text-right text-white font-semibold">{pt.activeUsers}</td>
                    <td className="py-2 px-4 text-right text-[#F6821F]">{pt.activeSessions}</td>
                    <td className="py-2 px-4 text-right text-slate-300">{pt.eventsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // Detailed Submenu: Códigos HTTP (24h)
  if (section === 'overview-http') {
    const totals = httpStatusBySystem24h.reduce(
      (acc, r) => ({
        s2xx: acc.s2xx + r.s2xx,
        s4xx: acc.s4xx + r.s4xx,
        s5xx: acc.s5xx + r.s5xx,
        total: acc.total + r.total,
      }),
      { s2xx: 0, s4xx: 0, s5xx: 0, total: 0 }
    );
    const successPct = totals.total > 0 ? ((totals.s2xx / totals.total) * 100).toFixed(1) : '100.0';

    return (
      <div className="space-y-6">
        {renderHeaderControls()}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Total de Requisições (24h)</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">{totals.total}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Respostas 2xx (Sucesso)</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-emerald-400">{totals.s2xx}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Respostas 4xx (Negado)</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-[#F6821F]">{totals.s4xx}</div>
          </div>
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-1">
            <div className="text-xs text-slate-400">Respostas 5xx (Erro) · Taxa 2xx</div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-red-400">
              {totals.s5xx} <span className="text-sm text-slate-400">({successPct}%)</span>
            </div>
          </div>
        </div>

        <HttpStatusDistributionWidget data={httpStatusBySystem24h} />

        <section className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center gap-2">
            <ServerCrash className="w-4 h-4 text-[#F6821F]" />
            <h2 className="text-sm font-semibold text-white">Detalhamento de Códigos HTTP por Sistema</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#090D16]/70 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Sistema</th>
                  <th className="py-2.5 px-4 font-medium">Slug</th>
                  <th className="py-2.5 px-4 font-medium text-right">2xx Sucesso</th>
                  <th className="py-2.5 px-4 font-medium text-right">4xx Negado</th>
                  <th className="py-2.5 px-4 font-medium text-right">5xx Erro</th>
                  <th className="py-2.5 px-4 font-medium text-right">Total</th>
                  <th className="py-2.5 px-4 font-medium text-right">Taxa 2xx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                {httpStatusBySystem24h.map((row) => {
                  const rate = row.total > 0 ? ((row.s2xx / row.total) * 100).toFixed(1) : '100.0';
                  return (
                    <tr key={row.systemSlug} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 font-sans font-medium text-white">{row.systemName}</td>
                      <td className="py-2.5 px-4 text-slate-400">{row.systemSlug}</td>
                      <td className="py-2.5 px-4 text-right text-emerald-400">{row.s2xx}</td>
                      <td className="py-2.5 px-4 text-right text-[#F6821F]">{row.s4xx}</td>
                      <td className="py-2.5 px-4 text-right text-red-400">{row.s5xx}</td>
                      <td className="py-2.5 px-4 text-right text-white font-semibold">{row.total}</td>
                      <td className="py-2.5 px-4 text-right text-slate-300">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // Detailed Submenu: Borda & SQLite WAL
  if (section === 'overview-edge') {
    return (
      <div className="space-y-6">
        {renderHeaderControls()}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Taxa de Acerto no Cache</span>
              <Zap className="w-3.5 h-3.5 text-[#F6821F]" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {metrics ? `${metrics.cacheHitRatioPct}%` : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {metrics ? `${metrics.cacheHits} HIT · ${metrics.cacheMisses} MISS` : 'Carregando...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Latência GraphQL (p50 / p95)</span>
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {metrics ? `${metrics.p50LatencyMs} / ${metrics.p95LatencyMs} ms` : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {metrics ? `HIT ${metrics.avgHitLatencyMs}ms · MISS ${metrics.avgMissLatencyMs}ms` : 'Carregando...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Perfil SQLite WAL (Leitura)</span>
              <Database className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {metrics ? `${metrics.sqliteReadRatioPct}%` : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {metrics ? `${metrics.sqliteTotalReads} leituras · ${metrics.sqliteTotalWrites} gravações` : 'Carregando...'}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Versões KV & Streams SSE</span>
              <Radio className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="font-mono tabular-nums text-2xl font-semibold text-white">
              {metrics ? `${metrics.kvVersionReads}` : '—'}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400">
              {metrics ? `${metrics.batchedAuditFlushes} lotes · ${metrics.activeSseStreams} streams SSE` : 'Carregando...'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Zap className="w-4 h-4 text-[#F6821F]" />
              <h2 className="text-sm font-semibold text-white">Edge Cache & Workers KV</h2>
            </div>
            <dl className="divide-y divide-slate-800/60 text-xs">
              {[
                ['Cache Hits', metrics?.cacheHits ?? '—'],
                ['Cache Misses', metrics?.cacheMisses ?? '—'],
                ['Cache Bypasses (Mutations / Sem Cache)', metrics?.cacheBypasses ?? '—'],
                ['Expurgos Executados (Purges)', metrics?.cachePurges ?? '—'],
                ['Entradas Ativas em Memória', metrics?.cachedEntriesCount ?? '—'],
                ['Leituras de Versão KV (u_ver / s_ver)', metrics?.kvVersionReads ?? '—'],
                ['Latência Média em Cache HIT', metrics ? `${metrics.avgHitLatencyMs} ms` : '—'],
                ['Latência Média em Cache MISS', metrics ? `${metrics.avgMissLatencyMs} ms` : '—'],
              ].map(([label, value]) => (
                <div key={String(label)} className="py-2 flex items-center justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="font-mono tabular-nums text-white font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <Database className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-white">SQLite WAL & Fila Assíncrona de Auditoria</h2>
            </div>
            <dl className="divide-y divide-slate-800/60 text-xs">
              {[
                ['Total de Leituras SQLite', metrics?.sqliteTotalReads ?? '—'],
                ['Total de Gravações SQLite', metrics?.sqliteTotalWrites ?? '—'],
                ['Proporção de Leitura (Read Ratio)', metrics ? `${metrics.sqliteReadRatioPct}%` : '—'],
                ['Percentil p50 GraphQL', metrics ? `${metrics.p50LatencyMs} ms` : '—'],
                ['Percentil p95 GraphQL', metrics ? `${metrics.p95LatencyMs} ms` : '—'],
                ['Lotes de Auditoria Gravados (Flushes)', metrics?.batchedAuditFlushes ?? '—'],
                ['Eventos Aguardando Flush na Fila', metrics?.queuedAuditLogs ?? '—'],
                ['Clientes Conectados no Stream SSE', metrics?.activeSseStreams ?? '—'],
              ].map(([label, value]) => (
                <div key={String(label)} className="py-2 flex items-center justify-between gap-4">
                  <dt className="text-slate-400">{label}</dt>
                  <dd className="font-mono tabular-nums text-white font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    );
  }

  // Detailed Submenu: Histórico de Saúde
  if (section === 'overview-health') {
    return (
      <div className="space-y-6">
        {renderHeaderControls()}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-emerald-800/50 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-emerald-300">Saudável</div>
              <div className="text-[11px] font-mono text-slate-400">Latência média &lt; 100 ms</div>
            </div>
          </div>
          <div className="bg-[#111827] border border-amber-700/50 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-amber-300">Atenção</div>
              <div className="text-[11px] font-mono text-slate-400">Latência média 100–299 ms</div>
            </div>
          </div>
          <div className="bg-[#111827] border border-red-800/50 rounded-lg p-4 flex items-center gap-3">
            <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-red-300">Crítica</div>
              <div className="text-[11px] font-mono text-slate-400">Latência média ≥ 300 ms</div>
            </div>
          </div>
        </div>

        <HealthHistoryPanel events={healthHistory} sseConnected={sseConnected} expanded />
      </div>
    );
  }

  // Detailed Submenu: Alertas Recentes
  if (section === 'overview-alerts') {
    return (
      <div className="space-y-6">
        {renderHeaderControls()}
        {canReadAuditLogs ? (
          <RecentAlertsList
            alerts={recentAlerts}
            unreadIds={unreadAlertIds}
            sseConnected={sseConnected}
            refreshIntervalMs={refreshIntervalMs}
            onMarkAllRead={() => setUnreadAlertIds(new Set())}
            expanded
          />
        ) : (
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 text-xs text-slate-400">
            Acesso restrito: a permissão <span className="font-mono text-slate-200">iam:audit:read</span> é necessária para visualizar alertas de segurança.
          </div>
        )}
      </div>
    );
  }

  // Detailed Submenu: Logs de Auditoria
  if (section === 'overview-audit') {
    return (
      <div className="space-y-6">
        {renderHeaderControls()}
        {canReadAuditLogs ? (
          <AuditLogs
            token={token}
            canReadUsers={canReadUsers}
            onNotify={onNotify}
            refreshSignal={refreshTick}
            onLogsUpdated={handleLogsUpdated}
          />
        ) : (
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 text-xs text-slate-400">
            Acesso restrito: a permissão <span className="font-mono text-slate-200">iam:audit:read</span> é necessária para consultar logs de auditoria.
          </div>
        )}
      </div>
    );
  }

  // Synthetic Overview ('overview'): ALL sections on a single page in the most synthetic form possible
  const compactAuditRows = logsSnapshot.slice(0, 5);
  const compactHealthRows = healthHistory.slice(0, 3);

  return (
    <div className="space-y-4">
      {renderHeaderControls()}

      {/* 1. Estatísticas Gerais (Sintético) */}
      <section aria-label="Estatísticas Gerais" className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#F6821F]" />
            <h2 className="text-sm font-semibold text-white">Estatísticas Gerais</h2>
            <InfoTooltip text="Resumo ao vivo de usuários ativos, tokens JWT válidos e alertas recentes de segurança." />
          </div>
          {onNavigateSection && (
            <button
              type="button"
              onClick={() => go('overview-stats')}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-slate-400">Usuários Ativos</div>
              <div className="font-mono tabular-nums text-xl font-semibold text-white">
                {keyStats ? keyStats.activeUsers : '—'}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                {keyStats ? `${keyStats.totalUsers} total · ${keyStats.mfaAdoptedUsers} 2FA` : '...'}
              </div>
            </div>
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-slate-400">Tokens JWT Válidos</div>
              <div className="font-mono tabular-nums text-xl font-semibold text-white">
                {keyStats ? keyStats.validTokens : '—'}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                {keyStats ? `${keyStats.revokedOrExpiredTokens} revogados/exp.` : '...'}
              </div>
            </div>
            <KeyRound className="w-4 h-4 text-[#F6821F] shrink-0" />
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-slate-400">Alertas de Segurança</div>
              <div className="font-mono tabular-nums text-xl font-semibold text-white">
                {keyStats ? keyStats.recentWarnings : '—'}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                {keyStats ? `${keyStats.deniedCount} negados · ${keyStats.errorCount} erros` : '...'}
              </div>
            </div>
            <ShieldAlert
              className={`w-4 h-4 shrink-0 ${
                keyStats && keyStats.recentWarnings > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}
            />
          </div>
        </div>
      </section>

      {/* 2 & 3. Tendência (24h) + Códigos HTTP (24h) Compactos */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ActiveUsersTrendChart
          data={activeUsers24hTrend}
          diagnostics={lastDiag}
          compact
          onDetail={onNavigateSection ? () => go('overview-trend') : undefined}
        />
        <HttpStatusDistributionWidget
          data={httpStatusBySystem24h}
          compact
          onDetail={onNavigateSection ? () => go('overview-http') : undefined}
        />
      </div>

      {/* 4. Borda e Armazenamento (Sintético) */}
      <section aria-label="Borda e Armazenamento" className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#F6821F]" />
            <h2 className="text-sm font-semibold text-white">Borda e Armazenamento</h2>
            <InfoTooltip text="Indicadores condensados de Edge Cache HIT, latências GraphQL p50/p95, leitura SQLite WAL e KV/SSE." />
          </div>
          {onNavigateSection && (
            <button
              type="button"
              onClick={() => go('overview-edge')}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Cache HIT</span>
              <Zap className="w-3 h-3 text-[#F6821F]" />
            </div>
            <div className="font-mono tabular-nums text-lg font-semibold text-white mt-0.5">
              {metrics ? `${metrics.cacheHitRatioPct}%` : '—'}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 truncate">
              {metrics ? `${metrics.cacheHits} HIT · ${metrics.cacheMisses} MISS` : '...'}
            </div>
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Latência (p50/p95)</span>
              <Activity className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="font-mono tabular-nums text-lg font-semibold text-white mt-0.5">
              {metrics ? `${metrics.p50LatencyMs}/${metrics.p95LatencyMs}ms` : '—'}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 truncate">
              {metrics ? `HIT ${metrics.avgHitLatencyMs}ms · MISS ${metrics.avgMissLatencyMs}ms` : '...'}
            </div>
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>SQLite WAL Leitura</span>
              <Database className="w-3 h-3 text-sky-400" />
            </div>
            <div className="font-mono tabular-nums text-lg font-semibold text-white mt-0.5">
              {metrics ? `${metrics.sqliteReadRatioPct}%` : '—'}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 truncate">
              {metrics ? `${metrics.sqliteTotalReads}R · ${metrics.sqliteTotalWrites}W` : '...'}
            </div>
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-md px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>KV & Auditoria</span>
              <Radio className="w-3 h-3 text-slate-400" />
            </div>
            <div className="font-mono tabular-nums text-lg font-semibold text-white mt-0.5">
              {metrics ? `${metrics.kvVersionReads}` : '—'}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 truncate">
              {metrics ? `${metrics.batchedAuditFlushes} lotes · ${metrics.activeSseStreams} SSE` : '...'}
            </div>
          </div>
        </div>
      </section>

      {/* 5 & 6. Histórico de Saúde + Alertas Recentes (Sintéticos em 2 colunas) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section aria-label="Histórico de Saúde (Resumo)" className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#F6821F]" />
              <h2 className="text-sm font-semibold text-white">Histórico de Saúde</h2>
              <InfoTooltip text="Últimas transições de latência do sistema persistidas no banco." />
              <span className="text-[11px] font-mono tabular-nums text-slate-400">· {healthHistory.length}</span>
            </div>
            {onNavigateSection && (
              <button
                type="button"
                onClick={() => go('overview-health')}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors"
              >
                <span>Detalhar</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {compactHealthRows.length === 0 ? (
            <div className="px-4 py-5 text-center text-xs text-slate-500">Nenhuma transição registrada.</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {compactHealthRows.map((ev) => (
                <div key={ev.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span
                        className={
                          ev.newStatus === 'critical'
                            ? 'text-red-400'
                            : ev.newStatus === 'degraded'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        {ev.newStatus === 'critical' ? 'Crítica' : ev.newStatus === 'degraded' ? 'Atenção' : 'Saudável'}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300 truncate">{ev.reason}</span>
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                    {ev.avgLatencyMs.toFixed(1)}ms · {new Date(ev.createdAt).toLocaleTimeString('pt-BR')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <RecentAlertsList
          alerts={recentAlerts}
          unreadIds={unreadAlertIds}
          sseConnected={sseConnected}
          refreshIntervalMs={refreshIntervalMs}
          onMarkAllRead={() => setUnreadAlertIds(new Set())}
          maxItems={3}
          onDetail={canReadAuditLogs && onNavigateSection ? () => go('overview-alerts') : undefined}
        />
      </div>

      {/* 7. Eventos de Auditoria (Sintético: últimos 5 registros) */}
      <section aria-label="Eventos de Auditoria" className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#F6821F]" />
            <h2 className="text-sm font-semibold text-white">Eventos de Auditoria</h2>
            <InfoTooltip text="Resumo dos 5 eventos de auditoria mais recentes. Abra o submenu para filtros completos, busca e CSV." />
          </div>
          {canReadAuditLogs && onNavigateSection && (
            <button
              type="button"
              onClick={() => go('overview-audit')}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#F6821F] hover:text-amber-300 transition-colors"
            >
              <span>Detalhar</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
        {compactAuditRows.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-slate-500">
            Nenhum evento de auditoria recente disponível para este perfil.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#090D16]/60 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="py-2 px-4 font-medium">Horário</th>
                  <th className="py-2 px-4 font-medium">Ação</th>
                  <th className="py-2 px-4 font-medium">Ator</th>
                  <th className="py-2 px-4 font-medium">Sistema</th>
                  <th className="py-2 px-4 font-medium">Status</th>
                  <th className="py-2 px-4 font-medium text-right">Duração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
                {compactAuditRows.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-4 tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleTimeString('pt-BR')}
                    </td>
                    <td className="py-2 px-4 text-slate-200 truncate max-w-[220px]">{log.action}</td>
                    <td className="py-2 px-4 text-slate-400 truncate max-w-[180px]">{log.actorMasked}</td>
                    <td className="py-2 px-4 text-slate-400 whitespace-nowrap">{log.systemSlug || 'global'}</td>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <span
                        className={
                          log.status === 'success'
                            ? 'text-emerald-400'
                            : log.status === 'denied'
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }
                      >
                        {log.status === 'success' ? 'Sucesso' : log.status === 'denied' ? 'Negado' : 'Erro'}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-slate-300 whitespace-nowrap">
                      {log.durationMs.toFixed(2)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
