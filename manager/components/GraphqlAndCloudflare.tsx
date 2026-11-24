/**
 * File: GraphqlAndCloudflare.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Console interativa GraphQL e exportação de pacote pronto para Cloudflare Workers e D1.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Play, Download, Code2, Zap, RefreshCw } from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { DiagnosticHeaders } from '../types/Identity';

interface GraphqlAndCloudflareProps {
  token: string;
  onNotify: (msg: string) => void;
}

interface CloudflareFile {
  path: string;
  language: string;
  description: string;
  content: string;
}

const PRESET_QUERIES: Record<string, string> = {
  'Sistemas & Roles (Batched)': `query EdgeSystemsAndRoles {
  systems {
    id
    name
    slug
    jwtTtlSeconds
    edgeCacheTtl
    requireMfa
    policyVersion
    userCount
    roles {
      id
      name
      claims { claimKey claimValue valueType }
    }
  }
}`,
  'Usuários Multi-Sistema (Zero N+1)': `query EdgeUsersBatched {
  users(limit: 20) {
    id
    email
    displayName
    permVersion
    totpEnabled
    phoneVerified
    bindings {
      systemSlug
      roleName
      permissions
    }
  }
}`,
  'Meu Perfil & Consentimentos': `query MyIdentityAndLgpd {
  me {
    id
    email
    displayName
    totpEnabled
    phoneVerified
    mfaPreferredMethod
    consents {
      systemName
      policyVersion
      granted
      purposes
    }
  }
}`,
};

export const GraphqlAndCloudflare: React.FC<GraphqlAndCloudflareProps> = ({ token, onNotify }) => {
  const [queryText, setQueryText] = useState(PRESET_QUERIES['Sistemas & Roles (Batched)']);
  const [resultText, setResultText] = useState('');
  const [lastDiag, setLastDiag] = useState<DiagnosticHeaders | null>(null);
  const [cfFiles, setCfFiles] = useState<CloudflareFile[]>([]);
  const [bundleFilename, setBundleFilename] = useState('isg-cloudflare-d1-bundle');
  const [activeFilePath, setActiveFilePath] = useState('src/worker.ts');

  const fetchBundle = useCallback(async () => {
    try {
      const res = await fetch('/api/cloudflare/bundle', { cache: 'no-store' });
      const data = await res.json();
      setCfFiles(data.files || []);
      if (data.bundleFilename) {
        setBundleFilename(data.bundleFilename);
      }
    } catch {
      // ignore network error
    }
  }, []);

  useEffect(() => {
    void fetchBundle();
  }, [fetchBundle]);

  const executeQuery = async (bypassCache = false) => {
    try {
      const { data, diagnostics } = await gqlRequest<unknown>({
        token,
        query: queryText,
        bypassCache,
      });
      setLastDiag(diagnostics);
      setResultText(JSON.stringify(data, null, 2));
    } catch (err) {
      setResultText(JSON.stringify({ error: err instanceof Error ? err.message : 'Erro GraphQL' }, null, 2));
    }
  };

  const activeFile = cfFiles.find((f) => f.path === activeFilePath) || cfFiles[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-xl font-semibold text-white">Infraestrutura e Borda</h1>
        <InfoTooltip text="Teste o cache distribuído sensível à expiração JWT e baixe o pacote pronto para deploy na borda da Cloudflare." />
      </div>

      {/* GraphQL Explorer with Live Cache & SQLite Read Counter */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(PRESET_QUERIES).map(([label, q]) => (
              <button
                key={label}
                type="button"
                onClick={() => setQueryText(q)}
                className="px-2.5 py-1 text-xs bg-[#090D16] border border-slate-800 hover:border-slate-600 text-slate-300 rounded"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void executeQuery(true)}
              className="px-3 py-1.5 text-xs border border-slate-700 text-slate-300 hover:text-white rounded"
            >
              Forçar MISS
            </button>
            <button
              type="button"
              onClick={() => void executeQuery(false)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Executar Query (Cache Borda)</span>
            </button>
          </div>
        </div>

        {lastDiag && (
          <div className="flex flex-wrap items-center gap-4 px-3.5 py-2.5 bg-[#090D16] border border-slate-800 rounded text-xs font-mono tabular-nums">
            <span className={lastDiag.cacheStatus === 'HIT' ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
              CF-Cache-Status: {lastDiag.cacheStatus}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-200">Duração: {lastDiag.durationMs.toFixed(2)} ms</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-200">Consultas SQLite: {lastDiag.sqliteQueriesCount}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">TTL Restante (cap JWT): {lastDiag.ttlRemaining}s</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500">Key: {lastDiag.cacheKey}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <textarea
            rows={13}
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            className="w-full bg-[#090D16] border border-slate-800 rounded-md p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-[#F6821F]"
          />
          <pre className="bg-[#090D16] border border-slate-800 rounded-md p-3 text-xs font-mono text-sky-300 overflow-auto max-h-[290px]">
            {resultText || '// Execute a query duas vezes seguidas para observar MISS -> HIT (0 consultas SQLite).'}
          </pre>
        </div>
      </div>

      {/* Cloudflare Workers + D1 + KV Deployment Package */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-4 h-4 text-[#F6821F]" />
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Pacote Pronto Cloudflare Workers + D1 + Workers KV</h2>
              <InfoTooltip text="Manifesto Wrangler, migração D1 com índices de cobertura e Worker com Cache API limitada ao exp do JWT. Parametrizado em Configurações > Infraestrutura." />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void fetchBundle();
                onNotify('Scripts de infraestrutura atualizados com os parâmetros atuais.');
              }}
              aria-label="Atualizar scripts"
              title="Atualizar scripts"
              className="p-2 text-xs text-slate-300 hover:text-white bg-[#090D16] border border-slate-700/80 rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <a
              href="/api/cloudflare/download"
              download={`${bundleFilename}.zip`}
              onClick={() => onNotify(`Download do pacote ${bundleFilename}.zip iniciado.`)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar Pacote .ZIP</span>
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {cfFiles.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActiveFilePath(f.path)}
              className={`px-3 py-1.5 text-xs font-mono rounded-md border transition-colors ${
                activeFile?.path === f.path
                  ? 'bg-slate-800 border-[#F6821F] text-white'
                  : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.path}
            </button>
          ))}
        </div>

        {activeFile && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Zap className="w-3.5 h-3.5 text-[#F6821F]" />
              <span>{activeFile.description}</span>
            </div>
            <pre className="bg-[#090D16] border border-slate-800 rounded-md p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-96 leading-relaxed">
              {activeFile.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
