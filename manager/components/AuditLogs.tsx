import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  RefreshCw,
  Eye,
  X,
  Radio,
  Filter,
  Download,
  ArrowUpDown,
  RotateCcw,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { AuditLog, DiagnosticHeaders, IamSystem } from '../types/iam';

export interface AuditLogsProps {
  token: string;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
  refreshSignal?: number;
  onLogsUpdated?: (logs: AuditLog[]) => void;
}

const AUDIT_FILTERS_STORAGE_KEY = 'vektor_audit_filters_v1';

interface PersistedAuditFilters {
  searchTerm: string;
  systemFilter: string;
  statusFilter: StatusFilter;
  actionFilter: string;
  resourceFilter: string;
  timeWindow: TimeWindowFilter;
  recordLimit: number;
}

const AUDIT_USERS_QUERY = `
  query AuditUsersLookup {
    users(limit: 200) {
      id
      displayName
      email
    }
  }
`;

async function computeAuditActorHash(userId: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return '';
  const data = new TextEncoder().encode(`audit:${userId}`);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

const AUDIT_LOGS_QUERY = `
  query AdminAuditLogs($systemId: ID, $action: String, $limit: Int) {
    systems {
      id
      name
      slug
    }
    auditLogs(systemId: $systemId, action: $action, limit: $limit) {
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
  }
`;

type StatusFilter = 'all' | 'success' | 'denied' | 'error';
type TimeWindowFilter = 'all' | '1h' | '24h' | '7d';
type SortField = 'createdAt' | 'durationMs';
type SortDirection = 'desc' | 'asc';

function translateStatus(status: AuditLog['status']): string {
  if (status === 'success') return 'Sucesso';
  if (status === 'denied') return 'Negado';
  return 'Erro';
}

function readPersistedFilters(): Partial<PersistedAuditFilters> {
  try {
    const raw = sessionStorage.getItem(AUDIT_FILTERS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedAuditFilters>;
  } catch {
    return {};
  }
}

export const AuditLogs: React.FC<AuditLogsProps> = ({
  token,
  onNotify,
  refreshSignal = 0,
  onLogsUpdated,
}) => {
  const initialFilters = useMemo(() => readPersistedFilters(), []);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [actorDirectory, setActorDirectory] = useState<Record<string, { displayName: string; email: string }>>({});
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticHeaders | null>(null);

  // Query & Filter State (persisted across tab switches and exports)
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm ?? '');
  const [systemFilter, setSystemFilter] = useState(initialFilters.systemFilter ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilters.statusFilter ?? 'all');
  const [actionFilter, setActionFilter] = useState(initialFilters.actionFilter ?? '');
  const [resourceFilter, setResourceFilter] = useState(initialFilters.resourceFilter ?? '');
  const [timeWindow, setTimeWindow] = useState<TimeWindowFilter>(initialFilters.timeWindow ?? 'all');
  const [recordLimit, setRecordLimit] = useState<number>(initialFilters.recordLimit ?? 100);

  // Sorting State
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Master/Details Popup State
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const payload: PersistedAuditFilters = {
        searchTerm,
        systemFilter,
        statusFilter,
        actionFilter,
        resourceFilter,
        timeWindow,
        recordLimit,
      };
      sessionStorage.setItem(AUDIT_FILTERS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota issues
    }
  }, [searchTerm, systemFilter, statusFilter, actionFilter, resourceFilter, timeWindow, recordLimit]);

  useEffect(() => {
    let active = true;
    gqlRequest<{ users: Array<{ id: string; displayName: string; email: string }> }>({
      token,
      query: AUDIT_USERS_QUERY,
      operationName: 'AuditUsersLookup',
      silentDiagnostics: true,
    })
      .then(async ({ data }) => {
        if (!active) return;
        const entries = await Promise.all(
          (data.users || []).map(async (u) => {
            const hash = await computeAuditActorHash(u.id);
            return [hash, { displayName: u.displayName, email: u.email }] as const;
          })
        );
        if (!active) return;
        const nextMap: Record<string, { displayName: string; email: string }> = {};
        for (const [hash, meta] of entries) {
          if (hash) nextMap[hash] = meta;
        }
        setActorDirectory(nextMap);
      })
      .catch(() => {
        // User may lack iam:users:read; fall back to actorMasked matching
      });
    return () => {
      active = false;
    };
  }, [token]);

  const loadAuditTrail = useCallback(
    async (bypassCache = false) => {
      setLoading(true);
      try {
        const { data, diagnostics: diag } = await gqlRequest<{
          systems: IamSystem[];
          auditLogs: AuditLog[];
        }>({
          token,
          query: AUDIT_LOGS_QUERY,
          operationName: 'AdminAuditLogs',
          bypassCache,
          variables: {
            systemId: systemFilter || undefined,
            action: actionFilter || undefined,
            limit: recordLimit,
          },
        });
        setSystems(data.systems || []);
        setLogs(data.auditLogs || []);
        setDiagnostics(diag);
        onLogsUpdated?.(data.auditLogs || []);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao consultar registros de auditoria via GraphQL.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [token, systemFilter, actionFilter, recordLimit, onLogsUpdated, onNotify]
  );

  useEffect(() => {
    void loadAuditTrail(false);
  }, [loadAuditTrail, refreshSignal]);

  // Real-time SSE updates appended to the audit trail
  useEffect(() => {
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
        setLogs((prev) => {
          if (prev.some((item) => item.id === mapped.id)) return prev;
          const next = [mapped, ...prev.slice(0, recordLimit - 1)];
          onLogsUpdated?.(next);
          return next;
        });
      } catch {
        // Ignore malformed SSE payload
      }
    });
    es.onerror = () => setSseConnected(false);
    return () => es.close();
  }, [recordLimit, onLogsUpdated]);

  const availableResourceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.resourceType) set.add(log.resourceType);
    }
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const nowMs = Date.now();
    const cutoffMs =
      timeWindow === '1h'
        ? nowMs - 3600 * 1000
        : timeWindow === '24h'
          ? nowMs - 24 * 3600 * 1000
          : timeWindow === '7d'
            ? nowMs - 7 * 24 * 3600 * 1000
            : null;

    const list = logs.filter((log) => {
      if (statusFilter !== 'all' && log.status !== statusFilter) return false;
      if (systemFilter && log.systemId !== systemFilter) return false;
      if (actionFilter && !log.action.toLowerCase().includes(actionFilter.toLowerCase())) return false;
      if (resourceFilter && log.resourceType !== resourceFilter) return false;
      if (cutoffMs !== null) {
        const ts = Date.parse(log.createdAt);
        if (Number.isNaN(ts) || ts < cutoffMs) return false;
      }
      if (!q) return true;
      const resolvedActor = actorDirectory[log.actorHash];
      return (
        log.action.toLowerCase().includes(q) ||
        log.traceId.toLowerCase().includes(q) ||
        log.actorMasked.toLowerCase().includes(q) ||
        (resolvedActor?.displayName.toLowerCase().includes(q) ?? false) ||
        (resolvedActor?.email.toLowerCase().includes(q) ?? false) ||
        log.resourceType.toLowerCase().includes(q) ||
        log.resourceId.toLowerCase().includes(q) ||
        (log.systemSlug || '').toLowerCase().includes(q) ||
        log.ipMasked.toLowerCase().includes(q) ||
        log.detailsJson.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'durationMs') {
        return (a.durationMs - b.durationMs) * mul;
      }
      return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * mul;
    });
  }, [logs, actorDirectory, searchTerm, statusFilter, systemFilter, actionFilter, resourceFilter, timeWindow, sortField, sortDir]);

  const statusSummary = useMemo(() => {
    return filteredLogs.reduce(
      (acc, log) => {
        if (log.status === 'success') acc.success += 1;
        else if (log.status === 'denied') acc.denied += 1;
        else acc.error += 1;
        return acc;
      },
      { success: 0, denied: 0, error: 0 }
    );
  }, [filteredLogs]);

  const hasActiveFilters =
    Boolean(searchTerm) ||
    Boolean(systemFilter) ||
    statusFilter !== 'all' ||
    Boolean(actionFilter) ||
    Boolean(resourceFilter) ||
    timeWindow !== 'all';

  const handleResetFilters = () => {
    setSearchTerm('');
    setSystemFilter('');
    setStatusFilter('all');
    setActionFilter('');
    setResourceFilter('');
    setTimeWindow('all');
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleExportCsv = () => {
    const header = [
      'id',
      'createdAt',
      'traceId',
      'action',
      'status',
      'cacheStatus',
      'durationMs',
      'systemSlug',
      'resourceType',
      'resourceId',
      'actorName',
      'actorMasked',
      'ipMasked',
    ].join(',');
    const escapeCell = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((log) =>
      [
        log.id,
        log.createdAt,
        log.traceId,
        log.action,
        log.status,
        log.cacheStatus,
        log.durationMs.toFixed(2),
        log.systemSlug || 'global',
        log.resourceType,
        log.resourceId,
        actorDirectory[log.actorHash]?.displayName || '',
        log.actorMasked,
        log.ipMasked,
      ]
        .map(escapeCell)
        .join(',')
    );
    const csv = `\uFEFF${[header, ...rows].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `isg-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Exportados ${filteredLogs.length} registros de auditoria em CSV.`, 'success');
  };

  const handleCopyJson = async (log: AuditLog) => {
    try {
      const parsedDetails = (() => {
        try {
          return JSON.parse(log.detailsJson);
        } catch {
          return log.detailsJson;
        }
      })();
      await navigator.clipboard.writeText(JSON.stringify({ ...log, details: parsedDetails }, null, 2));
      setCopiedId(log.id);
      window.setTimeout(() => setCopiedId((curr) => (curr === log.id ? null : curr)), 2000);
    } catch {
      onNotify('Não foi possível copiar o JSON para a área de transferência.', 'error');
    }
  };

  return (
    <section
      aria-label="Logs de Auditoria"
      className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header & Actions */}
      <div className="px-5 py-4 border-b border-slate-800/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#F6821F]" />
                <h2 className="text-sm font-semibold text-white">Logs de Auditoria</h2>
                <InfoTooltip text="Trilha de auditoria LGPD-safe consultada via GraphQL com stream SSE em tempo real, filtros multi-faceta e exportação CSV." />
              </div>
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                <Radio className={`w-3.5 h-3.5 ${sseConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{sseConnected ? 'SSE ao vivo' : 'SSE offline'}</span>
                {diagnostics && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={diagnostics.cacheStatus === 'HIT' ? 'text-emerald-400' : 'text-amber-400'}>
                      CF:{diagnostics.cacheStatus}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{diagnostics.durationMs.toFixed(1)}ms</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">SQL:{diagnostics.sqliteQueriesCount}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white rounded-md transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar Filtros</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredLogs.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#090D16] hover:bg-slate-800 disabled:opacity-40 border border-slate-700/80 text-slate-200 rounded-md transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
            <button
              type="button"
              onClick={() => void loadAuditTrail(true)}
              aria-label="Atualizar"
              title="Atualizar"
              className="relative group flex items-center justify-center p-2 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700/80 text-slate-200 rounded-md transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span
                role="tooltip"
                className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
              >
                Atualizar
              </span>
            </button>
          </div>
        </div>

        {/* Search & Multi-Facet Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
          <div className="lg:col-span-4 relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              aria-label="Buscar registros de auditoria por usuário ou ação"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por usuário, ação, trace, ator, recurso ou IP..."
              className="w-full bg-[#090D16] border border-slate-700/80 rounded-md pl-8 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#F6821F]"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Limpar busca"
                title="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="lg:col-span-2 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              aria-label="Filtrar por sistema"
              value={systemFilter}
              onChange={(e) => setSystemFilter(e.target.value)}
              className="w-full bg-[#090D16] border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#F6821F]"
            >
              <option value="">Todos os sistemas</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              aria-label="Filtrar por status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full bg-[#090D16] border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#F6821F]"
            >
              <option value="all">Todos os status</option>
              <option value="success">Sucesso</option>
              <option value="denied">Negado</option>
              <option value="error">Erro</option>
            </select>
          </div>

          <div className="lg:col-span-2">
            <select
              aria-label="Filtrar por categoria de ação"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full bg-[#090D16] border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#F6821F]"
            >
              <option value="">Todas as ações</option>
              <option value="LOGIN">Autenticação / Login</option>
              <option value="MFA">2FA / MFA</option>
              <option value="OAUTH">OAuth 2.0 / Token</option>
              <option value="USER">Usuários</option>
              <option value="SYSTEM">Sistemas</option>
              <option value="ROLE">RBAC / Roles</option>
              <option value="LGPD">LGPD / Consentimento</option>
              <option value="CACHE">Cache Borda</option>
            </select>
          </div>

          <div className="lg:col-span-2 flex items-center gap-2">
            <select
              aria-label="Filtrar por tipo de recurso"
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              className="w-full bg-[#090D16] border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#F6821F]"
            >
              <option value="">Todos os recursos</option>
              {availableResourceTypes.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary & Window Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] font-mono tabular-nums text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Exibindo <strong className="text-white">{filteredLogs.length}</strong> de {logs.length} registros
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400">{statusSummary.success} sucesso</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400">{statusSummary.denied} negado</span>
            <span aria-hidden="true">·</span>
            <span className="text-red-400">{statusSummary.error} erro</span>
          </div>

          <div className="flex items-center gap-2 font-sans">
            <select
              aria-label="Período"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value as TimeWindowFilter)}
              className="bg-[#090D16] border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-[#F6821F]"
            >
              <option value="all">Todo o período</option>
              <option value="1h">Última 1 hora</option>
              <option value="24h">Últimas 24 horas</option>
              <option value="7d">Últimos 7 dias</option>
            </select>
            <select
              aria-label="Limite de registros GraphQL"
              value={recordLimit}
              onChange={(e) => setRecordLimit(Number(e.target.value))}
              className="bg-[#090D16] border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-[#F6821F]"
            >
              <option value={50}>50 registros</option>
              <option value={100}>100 registros</option>
              <option value={200}>200 registros</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audit Trail Table */}
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#111827] border-b border-slate-800 text-[11px] text-slate-400 z-10">
            <tr>
              <th className="py-2.5 px-4 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort('createdAt')}
                  className="inline-flex items-center gap-1 hover:text-white transition-colors"
                >
                  <span>Horário</span>
                  <ArrowUpDown className={`w-3 h-3 ${sortField === 'createdAt' ? 'text-[#F6821F]' : ''}`} />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium">Evento / Trace</th>
              <th className="py-2.5 px-4 font-medium">Recurso</th>
              <th className="py-2.5 px-4 font-medium">Ator (PII Mascarado)</th>
              <th className="py-2.5 px-4 font-medium">Sistema</th>
              <th className="py-2.5 px-4 font-medium">Status / Cache</th>
              <th className="py-2.5 px-4 font-medium text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('durationMs')}
                  className="inline-flex items-center gap-1 hover:text-white transition-colors"
                >
                  <span>Duração</span>
                  <ArrowUpDown className={`w-3 h-3 ${sortField === 'durationMs' ? 'text-[#F6821F]' : ''}`} />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium text-right">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs">
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  Consultando trilha de auditoria via GraphQL...
                </td>
              </tr>
            ) : filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  Nenhum registro encontrado para os filtros aplicados.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="hover:bg-slate-800/35 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                    <div>{new Date(log.createdAt).toLocaleTimeString('pt-BR')}</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(log.createdAt).toLocaleDateString('pt-BR')}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-mono text-slate-100">{log.action}</div>
                    <div className="text-[11px] font-mono text-slate-500">{log.traceId}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-300">
                    <div>{log.resourceType}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[140px]">{log.resourceId}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-300">
                    <div>
                      {log.actorMasked}
                      {actorDirectory[log.actorHash]?.displayName && (
                        <span className="font-sans text-[11px] text-slate-400 ml-1.5">
                          ({actorDirectory[log.actorHash].displayName})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">{log.ipMasked}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                    {log.systemSlug || 'global'}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap font-mono">
                    <span
                      className={
                        log.status === 'success'
                          ? 'text-emerald-400'
                          : log.status === 'denied'
                            ? 'text-amber-400'
                            : 'text-red-400'
                      }
                    >
                      {translateStatus(log.status)}
                    </span>
                    <span className="text-slate-500"> · {log.cacheStatus}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                    {log.durationMs.toFixed(2)} ms
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedLog(log);
                      }}
                      title="Inspecionar Registro de Auditoria"
                      className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Master/Details Popup Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Detalhes do Registro · <span className="font-mono">{selectedLog.action}</span>
                </h3>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Trace {selectedLog.traceId} · LGPD PII-Safe ·{' '}
                  {new Date(selectedLog.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                aria-label="Fechar detalhes"
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Ator Mascarado</div>
                <div className="font-mono text-white mt-0.5 truncate">{selectedLog.actorMasked}</div>
              </div>
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">IP Mascarado</div>
                <div className="font-mono text-white mt-0.5">{selectedLog.ipMasked}</div>
              </div>
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Status / Cache</div>
                <div className="font-mono text-white mt-0.5">
                  {translateStatus(selectedLog.status)} · {selectedLog.cacheStatus}
                </div>
              </div>
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Duração</div>
                <div className="font-mono tabular-nums text-white mt-0.5">
                  {selectedLog.durationMs.toFixed(2)} ms
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Sistema</div>
                <div className="font-mono text-slate-200 mt-0.5">{selectedLog.systemSlug || 'global'}</div>
              </div>
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Recurso</div>
                <div className="font-mono text-slate-200 mt-0.5 truncate">
                  {selectedLog.resourceType} · {selectedLog.resourceId}
                </div>
              </div>
              <div className="bg-[#090D16] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 text-[11px]">Hash do Ator</div>
                <div className="font-mono text-slate-200 mt-0.5 truncate">{selectedLog.actorHash}</div>
              </div>
            </div>

            <pre className="bg-[#090D16] border border-slate-800 rounded-md p-3.5 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
              {JSON.stringify(
                {
                  ...selectedLog,
                  details: (() => {
                    try {
                      return JSON.parse(selectedLog.detailsJson);
                    } catch {
                      return selectedLog.detailsJson;
                    }
                  })(),
                },
                null,
                2
              )}
            </pre>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCopyJson(selectedLog)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md"
              >
                {copiedId === selectedLog.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar JSON</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
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
