import React, { useEffect, useState } from 'react';
import { Globe, Play, CheckCircle2, KeyRound, Save, X, SlidersHorizontal } from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { IamSystem, IdentityProvider } from '../types/iam';

interface IdpAndOAuthSandboxProps {
  token: string;
  canWriteSystems?: boolean;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
}

const IDP_QUERY = `
  query IdpAndSystems {
    identityProviders {
      id
      name
      providerType
      issuerUrl
      authUrl
      tokenUrl
      userinfoUrl
      clientId
      scopes
      simulationMode
      enabled
      updatedAt
    }
    systems {
      id
      name
      slug
      clientId
      redirectUris
      jwtTtlSeconds
      signingAlg
      requireMfa
    }
  }
`;

export const IdpAndOAuthSandbox: React.FC<IdpAndOAuthSandboxProps> = ({
  token,
  canWriteSystems = false,
  onNotify,
}) => {
  const [idps, setIdps] = useState<IdentityProvider[]>([]);
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [editingIdp, setEditingIdp] = useState<IdentityProvider | null>(null);

  // OAuth 2.0 + PKCE Sandbox State
  const [sandboxClientId, setSandboxClientId] = useState('cid_secure_gate');
  const [sandboxEmail, setSandboxEmail] = useState('administrator@smarttarget.com.br');
  const [sandboxPassword, setSandboxPassword] = useState('Vektor@2026!');
  const [pkceVerifier, setPkceVerifier] = useState('isg_pkce_verifier_demo_99123');
  const [authCode, setAuthCode] = useState('');
  const [sandboxMfaToken, setSandboxMfaToken] = useState('');
  const [sandboxMfaCode, setSandboxMfaCode] = useState('');
  const [issuedAccessToken, setIssuedAccessToken] = useState('');
  const [decodedResult, setDecodedResult] = useState<Record<string, unknown> | null>(null);

  const loadIdps = async () => {
    try {
      const { data } = await gqlRequest<{ identityProviders: IdentityProvider[]; systems: IamSystem[] }>({
        token,
        query: IDP_QUERY,
        operationName: 'IdpAndSystems',
      });
      setIdps(data.identityProviders);
      setSystems(data.systems);
      if (data.systems[0]) setSandboxClientId(data.systems[0].clientId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar provedores externos.');
    }
  };

  useEffect(() => {
    void loadIdps();
  }, [token]);

  const handleSaveIdp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIdp) return;
    try {
      await gqlRequest({
        token,
        operationName: 'UpdateIdp',
        query: `
          mutation UpdateIdp($id: ID!, $input: IdpUpdateInput!) {
            updateIdentityProvider(id: $id, input: $input) { id name enabled }
          }
        `,
        variables: {
          id: editingIdp.id,
          input: {
            name: editingIdp.name,
            issuerUrl: editingIdp.issuerUrl,
            authUrl: editingIdp.authUrl,
            tokenUrl: editingIdp.tokenUrl,
            userinfoUrl: editingIdp.userinfoUrl,
            clientId: editingIdp.clientId,
            scopes: editingIdp.scopes,
            simulationMode: editingIdp.simulationMode,
            enabled: editingIdp.enabled,
          },
        },
      });
      onNotify(`Provedor ${editingIdp.name} atualizado via GraphQL.`);
      setEditingIdp(null);
      await loadIdps();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar provedor.');
    }
  };

  const computeS256Challenge = async (verifier: string): Promise<string> => {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(hash));
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const handleStep1Authorize = async () => {
    try {
      const challenge = await computeS256Challenge(pkceVerifier);
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: sandboxClientId,
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          email: sandboxEmail,
          password: sandboxPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro em /api/oauth/authorize');
      setAuthCode(data.code);
      if (data.requiresMfa) {
        setSandboxMfaToken(data.mfaToken);
        onNotify('Código OAuth gerado, aguardando validação 2FA antes da troca pelo JWT.');
      } else {
        setSandboxMfaToken('');
        onNotify('Código de autorização OAuth 2.0 + PKCE emitido com sucesso.');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Falha na etapa 1 OAuth.');
    }
  };

  const handleSandboxVerifyMfa = async () => {
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mfaToken: sandboxMfaToken,
          method: 'totp',
          code: sandboxMfaCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código 2FA inválido.');
      setSandboxMfaToken('');
      setSandboxMfaCode('');
      onNotify('Desafio 2FA concluído para o código OAuth! Prossiga para Etapa 2.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro 2FA Sandbox.');
    }
  };

  const handleStep2ExchangeToken = async () => {
    try {
      const res = await fetch('/api/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: authCode,
          client_id: sandboxClientId,
          code_verifier: pkceVerifier,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || 'Erro na troca OAuth.');
      setIssuedAccessToken(data.access_token);

      const decRes = await fetch('/api/auth/decode-jwt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.access_token }),
      });
      const decData = await decRes.json();
      setDecodedResult(decData);
      onNotify('JWT emitido via /api/oauth/token e validado contra JWKS!');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Falha na troca do código OAuth.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-xl font-semibold text-white">Provedores de Identidade</h1>
        <InfoTooltip text="Configure provedores Google, GitHub, OIDC genérico e Microsoft Entra ID / SAML em popups dedicados e teste o fluxo Authorization Code + PKCE ao vivo." />
      </div>

      {/* Identity Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {idps.map((idp) => (
          <div key={idp.id} className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-[#F6821F]" />
                <div>
                  <div className="text-sm font-semibold text-white">{idp.name}</div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {idp.providerType} · {idp.enabled ? 'habilitado' : 'desativado'} ·{' '}
                    {idp.simulationMode ? 'sandbox simulado' : 'OAuth em produção'}
                  </div>
                </div>
              </div>
              {canWriteSystems && (
                <button
                  type="button"
                  onClick={() => setEditingIdp({ ...idp })}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#090D16] border border-slate-700 hover:border-slate-500 text-slate-200 rounded transition-colors"
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Configurar</span>
                </button>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-800/70 truncate">
              <div className="truncate">Emissor: {idp.issuerUrl}</div>
              <div className="truncate">Client ID: {idp.clientId || 'não definido'}</div>
              <div className="truncate">Escopos: {idp.scopes}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Live OAuth 2.0 + PKCE Sandbox */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#F6821F]" />
            <h2 className="text-sm font-semibold text-white">
              Sandbox Interativo OAuth 2.0 (Authorization Code + PKCE S256)
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-400">/.well-known/jwks.json</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Sistema / Client ID</label>
              <select
                value={sandboxClientId}
                onChange={(e) => setSandboxClientId(e.target.value)}
                className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
              >
                {systems.map((s) => (
                  <option key={s.id} value={s.clientId}>
                    {s.name} ({s.clientId})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Usuário</label>
                <input
                  type="email"
                  value={sandboxEmail}
                  onChange={(e) => setSandboxEmail(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Senha</label>
                <input
                  type="password"
                  value={sandboxPassword}
                  onChange={(e) => setSandboxPassword(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">PKCE code_verifier</label>
              <input
                type="text"
                value={pkceVerifier}
                onChange={(e) => setPkceVerifier(e.target.value)}
                className="w-full bg-[#090D16] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleStep1Authorize}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded"
              >
                <Play className="w-3 h-3" />
                <span>1. Gerar Auth Code</span>
              </button>
              <button
                type="button"
                disabled={!authCode}
                onClick={handleStep2ExchangeToken}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#F6821F] disabled:opacity-40 text-slate-950 rounded"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>2. Trocar por JWT</span>
              </button>
            </div>

            {sandboxMfaToken && (
              <div className="p-3 rounded bg-amber-950/30 border border-amber-700/60 space-y-2">
                <div className="text-xs text-amber-300">2FA exigido para concluir este fluxo OAuth:</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sandboxMfaCode}
                    onChange={(e) => setSandboxMfaCode(e.target.value)}
                    placeholder="Código TOTP"
                    className="flex-1 bg-[#090D16] border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSandboxVerifyMfa}
                    className="px-3 py-1 text-xs font-semibold bg-amber-500 text-slate-950 rounded"
                  >
                    Validar
                  </button>
                </div>
              </div>
            )}

            {authCode && (
              <div className="text-[11px] font-mono text-slate-400 break-all bg-[#090D16] p-2.5 rounded border border-slate-800">
                code: {authCode}
              </div>
            )}
          </div>

          <div className="lg:col-span-7 space-y-3">
            <div className="text-xs font-medium text-slate-300">Token JWT Emitido e Claims Decodificadas</div>
            {decodedResult ? (
              <div className="space-y-2.5">
                <div className="bg-[#090D16] border border-slate-800 rounded p-2.5 text-[11px] font-mono text-slate-400 break-all max-h-20 overflow-y-auto">
                  {issuedAccessToken}
                </div>
                <pre className="bg-[#090D16] border border-slate-800 rounded p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-64">
                  {JSON.stringify(decodedResult, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="bg-[#090D16] border border-slate-800 rounded p-8 text-center text-xs text-slate-500">
                Execute as etapas 1 e 2 ao lado para gerar um código OAuth 2.0 com PKCE S256 e inspecionar o JWT
                validado pela chave pública JWKS.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Configure IdP Modal Popup */}
      {editingIdp && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Configurar Provedor Externo: {editingIdp.name}
                </h3>
                <p className="text-xs font-mono text-slate-400 mt-0.5">{editingIdp.providerType}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingIdp(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveIdp} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome de Exibição</label>
                  <input
                    type="text"
                    required
                    value={editingIdp.name}
                    onChange={(e) => setEditingIdp({ ...editingIdp, name: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Client ID</label>
                  <input
                    type="text"
                    value={editingIdp.clientId}
                    onChange={(e) => setEditingIdp({ ...editingIdp, clientId: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Issuer URL</label>
                  <input
                    type="text"
                    value={editingIdp.issuerUrl}
                    onChange={(e) => setEditingIdp({ ...editingIdp, issuerUrl: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Authorization URL</label>
                  <input
                    type="text"
                    value={editingIdp.authUrl}
                    onChange={(e) => setEditingIdp({ ...editingIdp, authUrl: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Token URL</label>
                  <input
                    type="text"
                    value={editingIdp.tokenUrl}
                    onChange={(e) => setEditingIdp({ ...editingIdp, tokenUrl: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">UserInfo URL</label>
                  <input
                    type="text"
                    value={editingIdp.userinfoUrl}
                    onChange={(e) => setEditingIdp({ ...editingIdp, userinfoUrl: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Scopes (OIDC / OAuth 2.0)</label>
                <input
                  type="text"
                  value={editingIdp.scopes}
                  onChange={(e) => setEditingIdp({ ...editingIdp, scopes: e.target.value })}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-slate-800 text-xs text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingIdp.enabled}
                    onChange={(e) => setEditingIdp({ ...editingIdp, enabled: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Provedor Habilitado</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingIdp.simulationMode}
                    onChange={(e) => setEditingIdp({ ...editingIdp, simulationMode: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Modo Simulação Interativa</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingIdp(null)}
                  className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
