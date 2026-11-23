import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { SystemErrorLog } from '../types/iam';

interface DetailedErrorLogProps {
  token: string;
  telemetryStreamEnabled?: boolean;
  onNotify: (msg: string) => void;
  onCountChange?: (count: number) => void;
}

const SYSTEM_ERROR_LOGS_QUERY = `
  query AdminSystemErrorLogs($limit: Int) {
    systemErrorLogs(limit: $limit) {
      id
      traceId
      errorName
      message
      stackTrace
      source
      operationOrRoute
      httpMethod
      statusCode
      actorMasked
      systemSlug
      metadataJson
      createdAt
    }
  }
`;

const TRIGGER_DIAGNOSTIC_EXCEPTION_MUTATION = `
  mutation TriggerDiagnosticException($message: String) {
    triggerDiagnosticException(message: $message) {
      id
      traceId
      errorName
      message
      stackTrace
      source
      operationOrRoute
      httpMethod
      statusCode
      actorMasked
      systemSlug
      metadataJson
      createdAt
    }
  }
`;

const CLEAR_SYSTEM_ERROR_LOGS_MUTATION = `
  mutation ClearSystemErrorLogs {
    clearSystemErrorLogs
  }
`;

export const DetailedErrorLog: React.FC<DetailedErrorLogProps> = ({
  token,
  telemetryStreamEnabled = true,
  onNotify,
  onCountChange,
}) => {
  const [logs, setLogs] = useState<SystemErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<'refresh' | 'simulate' | 'clear' | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const onCountChangeRef = useRef(onCountChange);

  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  useEffect(() => {
    if (!loading) {
      onCountChangeRef.current?.(logs.length);
    }
  }, [logs.length, loading]);

  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await gqlRequest<{ systemErrorLogs: SystemErrorLog[] }>({
          token,
          operationName: 'AdminSystemErrorLogs',
          query: SYSTEM_ERROR_LOGS_QUERY,
          variables: { limit: 10 },
          bypassCache: true,
        });
        const items = data.systemErrorLogs.slice(0, 10);
        setLogs(items);
        if (items.length > 0) {
          setExpandedIds((prev) =>
            Object.keys(prev).length === 0 ? { [items[0].id]: true } : prev
          );
        }
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao carregar log de exceções.');
      } finally {
        setLoading(false);
      }
    },
    [token, onNotify]
  );

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Listen to SSE system_error events for live exception updates
  useEffect(() => {
    if (!telemetryStreamEnabled) return;
    const es = new EventSource('/api/telemetry/stream');
    es.addEventListener('system_error', (ev) => {
      try {
        const raw = JSON.parse((ev as MessageEvent).data) as {
          id: string;
          trace_id: string;
          error_name: string;
          message: string;
          stack_trace: string;
          source: string;
          operation_or_route: string;
          http_method: string;
          status_code: number;
          actor_masked: string;
          system_slug: string | null;
          metadata_json: string;
          created_at: string;
        };
        const mapped: SystemErrorLog = {
          id: raw.id,
          traceId: raw.trace_id,
          errorName: raw.error_name,
          message: raw.message,
          stackTrace: raw.stack_trace,
          source: raw.source,
          operationOrRoute: raw.operation_or_route,
          httpMethod: raw.http_method,
          statusCode: raw.status_code,
          actorMasked: raw.actor_masked,
          systemSlug: raw.system_slug,
          metadataJson: raw.metadata_json,
          createdAt: raw.created_at,
        };
        setLogs((prev) => {
          if (prev.some((item) => item.id === mapped.id)) return prev;
          return [mapped, ...prev].slice(0, 10);
        });
        setExpandedIds((prev) => ({ ...prev, [mapped.id]: true }));
      } catch {
        // Ignore malformed SSE payload
      }
    });
    return () => {
      es.close();
    };
  }, [telemetryStreamEnabled]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const item of logs) next[item.id] = true;
    setExpandedIds(next);
  };

  const collapseAll = () => {
    setExpandedIds({});
  };

  const handleCopyStack = async (item: SystemErrorLog) => {
    const formatted = [
      `[${item.createdAt}] ${item.errorName} (${item.statusCode}) - ${item.message}`,
      `Trace ID: ${item.traceId} | Source: ${item.source} | Op: ${item.httpMethod ? `${item.httpMethod} ` : ''}${item.operationOrRoute || '-'}`,
      `Actor: ${item.actorMasked} | System: ${item.systemSlug || '-'}`,
      '',
      item.stackTrace,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedId(item.id);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === item.id ? null : curr));
      }, 2000);
    } catch {
      onNotify('Não foi possível copiar o rastreamento de stack para a área de transferência.');
    }
  };

  const handleRefresh = async () => {
    setBusyAction('refresh');
    try {
      await fetchLogs(true);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateException = async () => {
    setBusyAction('simulate');
    try {
      const { data } = await gqlRequest<{ triggerDiagnosticException: SystemErrorLog }>({
        token,
        operationName: 'TriggerDiagnosticException',
        query: TRIGGER_DIAGNOSTIC_EXCEPTION_MUTATION,
        variables: {
          message: 'Exceção de diagnóstico capturada para verificação de stack trace no console administrativo.',
        },
      });
      const created = data.triggerDiagnosticException;
      setLogs((prev) => [created, ...prev.filter((i) => i.id !== created.id)].slice(0, 10));
      setExpandedIds((prev) => ({ ...prev, [created.id]: true }));
      onNotify(`Exceção registrada com rastreamento completo (${created.traceId}).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao registrar exceção de diagnóstico.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearLogs = async () => {
    setBusyAction('clear');
    try {
      const { data } = await gqlRequest<{ clearSystemErrorLogs: number }>({
        token,
        operationName: 'ClearSystemErrorLogs',
        query: CLEAR_SYSTEM_ERROR_LOGS_MUTATION,
      });
      setLogs([]);
      setExpandedIds({});
      onNotify(`${data.clearSystemErrorLogs} registro(s) de exceção removido(s).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao limpar logs de exceções.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section
      aria-label="Log de Erros Detalhado"
      className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Bug className="w-4 h-4 text-[#F6821F] shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-white">Log de Erros Detalhado</h2>
            <InfoTooltip text="Exibe as últimas 10 exceções capturadas no backend (Express, GraphQL e processo Node.js) com rastreamento completo de stack." />
            <span className="px-2 py-0.5 rounded bg-[#090D16] border border-slate-800 text-[11px] font-mono tabular-nums text-slate-300">
              {logs.length} / 10
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {logs.length > 0 && (
            <>
              <button
                type="button"
                onClick={expandAll}
                className="px-2.5 py-1.5 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-md transition-colors"
              >
                Expandir todos
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="px-2.5 py-1.5 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-md transition-colors"
              >
                Recolher todos
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void handleSimulateException()}
            disabled={busyAction !== null}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-slate-200 rounded-md transition-colors"
          >
            <Zap className="w-3.5 h-3.5 text-[#F6821F]" />
            <span>{busyAction === 'simulate' ? 'Capturando...' : 'Simular Exceção'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={busyAction !== null}
            aria-label="Atualizar"
            title="Atualizar"
            className="relative group flex items-center justify-center p-1.5 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 disabled:opacity-50 border border-slate-700 text-slate-200 rounded-md transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
            <span
              role="tooltip"
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
            >
              Atualizar
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleClearLogs()}
            disabled={busyAction !== null || logs.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-[#090D16] hover:bg-red-950/50 hover:border-red-800/60 hover:text-red-300 disabled:opacity-40 border border-slate-700 text-slate-300 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpar</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">
          Carregando últimas 10 exceções do sistema via GraphQL...
        </div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-950/50 border border-emerald-800/50 text-emerald-400">
            <Terminal className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-slate-200">Nenhuma exceção registrada no sistema.</p>
          <p className="text-[11px] text-slate-400 max-w-md mx-auto">
            Erros não tratados do Express, falhas em resolvers GraphQL e exceções do processo Node.js aparecerão aqui
            automaticamente com rastreamento completo de stack.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80">
          {logs.map((item, idx) => {
            const isExpanded = Boolean(expandedIds[item.id]);
            const isCopied = copiedId === item.id;
            return (
              <div key={item.id} className="p-4 sm:px-6 space-y-3 hover:bg-slate-900/40 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    aria-expanded={isExpanded}
                    className="flex items-start gap-2.5 text-left min-w-0 flex-1 group"
                  >
                    <span className="mt-0.5 text-slate-400 group-hover:text-white shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0 space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-950/60 border border-red-800/60 text-red-300 font-mono text-[11px] font-semibold">
                          <AlertOctagon className="w-3 h-3 shrink-0" />
                          <span>{item.errorName}</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#090D16] border border-slate-700 text-[11px] font-mono tabular-nums text-amber-300">
                          {item.statusCode}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#090D16] border border-slate-800 text-[11px] font-mono text-slate-300">
                          {item.source}
                        </span>
                        {item.operationOrRoute && (
                          <span className="font-mono text-[11px] text-[#F6821F] truncate max-w-sm">
                            {item.httpMethod ? `${item.httpMethod} ` : ''}
                            {item.operationOrRoute}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-medium text-white break-words">{item.message}</p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400 tabular-nums">
                        <span>{new Date(item.createdAt).toLocaleString('pt-BR')}</span>
                        <span aria-hidden="true">·</span>
                        <span>trace: {item.traceId}</span>
                        <span aria-hidden="true">·</span>
                        <span>ator: {item.actorMasked}</span>
                        {item.systemSlug && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>sistema: {item.systemSlug}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyStack(item)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-md transition-colors shrink-0"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-300">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copiar Stack</span>
                      </>
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className="ml-6 rounded-md bg-[#090D16] border border-slate-800 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Rastreamento Completo de Stack</span>
                      {item.metadataJson && item.metadataJson !== '{}' && (
                        <span className="text-slate-500 truncate max-w-md">
                          meta: {item.metadataJson}
                        </span>
                      )}
                    </div>
                    <pre className="p-3 text-[11px] font-mono leading-relaxed text-red-200/90 overflow-x-auto whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
                      {item.stackTrace}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
