/**
 * File: GraphqlClient.ts
 * Kind: TypeScript
 * Container: /manager/libraries
 * Summary: Cliente GraphQL autenticado com captura de cabeçalhos de diagnóstico de cache e consultas SQLite.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import type { DiagnosticHeaders } from '../domains/Identity';

export type DiagnosticListener = (diag: DiagnosticHeaders) => void;

const listeners = new Set<DiagnosticListener>();

export function subscribeDiagnostics(fn: DiagnosticListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function gqlRequest<T>(params: {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  bypassCache?: boolean;
  silentDiagnostics?: boolean;
}): Promise<{ data: T; diagnostics: DiagnosticHeaders }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.token}`,
  };
  if (params.bypassCache) {
    headers['x-bypass-cache'] = 'true';
  }

  const res = await fetch('/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: params.query,
      variables: params.variables,
      operationName: params.operationName,
    }),
  });

  const diagnostics: DiagnosticHeaders = {
    cacheStatus: res.headers.get('CF-Cache-Status') || 'BYPASS',
    cacheKey: res.headers.get('X-Cache-Key') || '-',
    ttlRemaining: Number(res.headers.get('X-Cache-TTL-Remaining') || 0),
    durationMs: Number(res.headers.get('X-Query-Duration-Ms') || 0),
    sqliteQueriesCount: Number(res.headers.get('X-SQLite-Queries-Count') || 0),
    operation: res.headers.get('X-GraphQL-Operation') || params.operationName || 'query',
    timestamp: new Date().toISOString(),
  };

  if (!params.silentDiagnostics) {
    for (const fn of listeners) {
      fn(diagnostics);
    }
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (res.status === 401) {
    throw new Error('UNAUTHENTICATED');
  }
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message);
  }
  if (!json.data) {
    throw new Error('Resposta GraphQL vazia.');
  }
  return { data: json.data, diagnostics };
}
