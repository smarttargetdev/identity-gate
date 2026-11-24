/**
 * File: TokenGate.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Portal de emissão direta de tokens JWT e validação de identidade no console e na rota /obter-token.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import type { ExecutionEnvironment, PublicPlatformConfig } from '../types/Identity';
import { BrandHeaderLogo } from './BrandHeaderLogo';
import { VersionBadge } from './VersionBadge';

interface PublicSystemItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  clientId: string;
  redirectUris: string[];
  jwtTtlSeconds: number;
  signingAlg: string;
  requireMfa: boolean;
  allowedMfaMethods: string[];
  allowedIdps: string[];
  edgeCacheTtl: number;
}

interface MfaPendingState {
  mfaToken: string;
  availableMethods: string[];
  preferredMethod: string;
  phoneMasked: string | null;
  systemName: string;
}

interface IssuedTokenResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  system: {
    id: string;
    name: string;
    slug: string;
    signingAlg?: string;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
    permissions: string[];
    claims: Record<string, unknown>;
  };
  decoded?: {
    validSignature: boolean;
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    secondsRemaining: number;
  } | null;
}

interface BootstrapParams {
  system?: string;
  redirectUri?: string;
  state?: string;
}

interface TokenGateProps {
  standalone?: boolean;
  onNotify?: (msg: string) => void;
}

const QUICK_ACCOUNTS = [
  {
    id: 'admin',
    label: 'Administrador Global',
    email: 'administrator@smarttarget.com.br',
    password: 'Vektor@2026!',
  },
  {
    id: 'clara',
    label: 'Operador do Sistema',
    email: 'operator@smarttarget.com.br',
    password: 'Clara@2026!',
  },
] as const;

function readInitialRequestParams(): BootstrapParams {
  let postBootstrap: BootstrapParams = {};
  if (typeof document !== 'undefined') {
    const el = document.getElementById('isg-token-portal-bootstrap');
    if (el?.textContent) {
      try {
        postBootstrap = JSON.parse(el.textContent) as BootstrapParams;
      } catch {
        postBootstrap = {};
      }
    }
  }

  let querySystem = '';
  let queryRedirect = '';
  let queryState = '';
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search);
    querySystem = (
      sp.get('sistema') ||
      sp.get('system') ||
      sp.get('systemSlug') ||
      sp.get('system_slug') ||
      sp.get('clientId') ||
      sp.get('client_id') ||
      ''
    ).trim();
    queryRedirect = (sp.get('redirectUri') || sp.get('redirect_uri') || sp.get('callbackUrl') || '').trim();
    queryState = (sp.get('state') || '').trim();
  }

  return {
    system: (postBootstrap.system || querySystem || '').trim() || undefined,
    redirectUri: (postBootstrap.redirectUri || queryRedirect || '').trim() || undefined,
    state: (postBootstrap.state || queryState || '').trim() || undefined,
  };
}

export const TokenGate: React.FC<TokenGateProps> = ({ standalone = false, onNotify }) => {
  const initialParams = useMemo(() => readInitialRequestParams(), []);
  const lockedSystemParam = standalone ? initialParams.system || '' : initialParams.system || '';
  const hasLockedSystem = Boolean(lockedSystemParam);

  const [systems, setSystems] = useState<PublicSystemItem[]>([]);
  const [systemsLoaded, setSystemsLoaded] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [platformName, setPlatformName] = useState('Identity Secure Gate');
  const [executionEnvironment, setExecutionEnvironment] = useState<ExecutionEnvironment | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaPending, setMfaPending] = useState<MfaPendingState | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'sms' | 'backup_code'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [smsPreview, setSmsPreview] = useState<string | null>(null);

  const [issuedResult, setIssuedResult] = useState<IssuedTokenResult | null>(null);
  const [copiedField, setCopiedField] = useState<'jwt' | 'json' | 'url' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [systemDropdownOpen, setSystemDropdownOpen] = useState(false);
  const systemComboRef = useRef<HTMLDivElement>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userComboRef = useRef<HTMLDivElement>(null);
  const userInputRef = useRef<HTMLInputElement>(null);
  const suppressFocusOpenRef = useRef(false);

  // Embedded helper state for testing autonomous GET / POST launches
  const [testSystemSlug, setTestSystemSlug] = useState('identity-gate');

  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (systemComboRef.current && !systemComboRef.current.contains(ev.target as Node)) {
        setSystemDropdownOpen(false);
      }
      if (userComboRef.current && !userComboRef.current.contains(ev.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetch('/api/public/systems')
      .then((r) => r.json())
      .then((data: { platformConfig?: PublicPlatformConfig; systems?: PublicSystemItem[] }) => {
        const loadedSystems = data.systems || [];
        setSystemsLoaded(true);
        if (lockedSystemParam) {
          const needle = lockedSystemParam.toLowerCase();
          const matched = loadedSystems.find(
            (s) =>
              s.slug.toLowerCase() === needle ||
              s.id.toLowerCase() === needle ||
              s.clientId.toLowerCase() === needle ||
              s.name.toLowerCase() === needle
          );
          setSystems(matched ? [matched] : []);
          setSelectedSlug(matched ? matched.slug : '');
        } else {
          setSystems(loadedSystems);
          if (loadedSystems.length > 0) {
            setSelectedSlug((curr) =>
              loadedSystems.some((s) => s.slug === curr) ? curr : loadedSystems[0].slug
            );
            setTestSystemSlug(loadedSystems[0].slug);
          }
        }

        const cfg = data.platformConfig;
        const env: ExecutionEnvironment = cfg?.executionEnvironment || 'Desenvolvimento';
        setExecutionEnvironment(env);
        if (cfg?.platformName) {
          setPlatformName(cfg.platformName);
        }
        if (env === 'Desenvolvimento') {
          setEmail((curr) => curr || 'administrator@smarttarget.com.br');
          setPassword((curr) => curr || 'Vektor@2026!');
        }
      })
      .catch(() => {
        setSystemsLoaded(true);
        setExecutionEnvironment('Desenvolvimento');
      });
  }, [lockedSystemParam]);

  const currentSystem = useMemo(
    () => systems.find((s) => s.slug === selectedSlug) || null,
    [systems, selectedSlug]
  );

  const lockedSystemInvalid = hasLockedSystem && systemsLoaded && !currentSystem;

  const showDemoPanel = executionEnvironment !== null && executionEnvironment !== 'Produção';
  const matchedQuickAccount = showDemoPanel
    ? QUICK_ACCOUNTS.find((acc) => acc.email.toLowerCase() === email.trim().toLowerCase())
    : undefined;
  const isQuickAccount = Boolean(matchedQuickAccount);

  const handleSelectQuickAccount = (acc: (typeof QUICK_ACCOUNTS)[number]) => {
    setMfaPending(null);
    setError(null);
    setEmail(acc.email);
    setPassword(acc.password);
    setUserDropdownOpen(false);
  };

  const handleEmailInputChange = (nextValue: string) => {
    const nextMatched = showDemoPanel
      ? QUICK_ACCOUNTS.find((acc) => acc.email.toLowerCase() === nextValue.trim().toLowerCase())
      : undefined;
    setEmail(nextValue);
    setUserDropdownOpen(false);
    setPassword(nextMatched ? nextMatched.password : '');
  };

  const handleSwitchToManualEntry = () => {
    suppressFocusOpenRef.current = true;
    setEmail('');
    setPassword('');
    setError(null);
    setUserDropdownOpen(false);
    window.setTimeout(() => {
      userInputRef.current?.focus();
      window.setTimeout(() => {
        suppressFocusOpenRef.current = false;
      }, 50);
    }, 0);
  };

  const finalizeTokenResult = async (data: IssuedTokenResult) => {
    let decoded: IssuedTokenResult['decoded'] = null;
    try {
      const decRes = await fetch('/api/auth/decode-jwt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.accessToken }),
      });
      if (decRes.ok) {
        decoded = await decRes.json();
      }
    } catch {
      decoded = null;
    }

    const result: IssuedTokenResult = {
      ...data,
      decoded,
    };
    setIssuedResult(result);
    setMfaPending(null);
    setMfaCode('');
    onNotify?.(`Token JWT gerado para ${data.user.email} (${data.system.slug}).`);
  };

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedSystemInvalid || !selectedSlug) {
      setError('Selecione ou informe um sistema ativo válido.');
      return;
    }
    setLoading(true);
    setError(null);
    setSmsPreview(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, systemSlug: selectedSlug }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha na autenticação.');
      }

      if (data.requiresMfa) {
        setMfaPending({
          mfaToken: data.mfaToken,
          availableMethods: data.availableMethods,
          preferredMethod: data.preferredMethod,
          phoneMasked: data.phoneMasked,
          systemName: data.system?.name || selectedSlug,
        });
        const pref = data.preferredMethod;
        setMfaMethod(pref === 'sms' || pref === 'totp' || pref === 'backup_code' ? pref : 'totp');
        return;
      }

      await finalizeTokenResult({
        accessToken: data.accessToken,
        tokenType: data.tokenType || 'Bearer',
        expiresIn: data.expiresIn,
        expiresAt: data.expiresAt,
        system: data.system,
        user: data.user,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendSmsOtp = async () => {
    if (!mfaPending) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken: mfaPending.mfaToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao enviar SMS OTP.');
      setSmsPreview(data.sandboxCodePreview || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar SMS.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPending) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mfaToken: mfaPending.mfaToken,
          method: mfaMethod,
          code: mfaCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código 2FA inválido.');

      await finalizeTokenResult({
        accessToken: data.accessToken,
        tokenType: data.tokenType || 'Bearer',
        expiresIn: data.expiresIn,
        expiresAt: data.expiresAt,
        system: data.system,
        user: data.user,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na verificação 2FA.');
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text: string, field: 'jwt' | 'json' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((curr) => (curr === field ? null : curr));
      }, 2000);
    } catch {
      onNotify?.('Não foi possível copiar para a área de transferência.');
    }
  };

  const authorizedRedirectUri = useMemo(() => {
    if (!initialParams.redirectUri || !currentSystem) return null;
    if (currentSystem.redirectUris.includes(initialParams.redirectUri)) {
      return initialParams.redirectUri;
    }
    return null;
  }, [initialParams.redirectUri, currentSystem]);

  const handleDeliverCallback = () => {
    if (!issuedResult || !authorizedRedirectUri) return;
    const hashParams = new URLSearchParams({
      access_token: issuedResult.accessToken,
      token_type: issuedResult.tokenType,
      expires_in: String(issuedResult.expiresIn),
    });
    if (initialParams.state) {
      hashParams.set('state', initialParams.state);
    }
    window.location.href = `${authorizedRedirectUri}#${hashParams.toString()}`;
  };

  const jsonReturnPayload = issuedResult
    ? JSON.stringify(
        {
          access_token: issuedResult.accessToken,
          token_type: issuedResult.tokenType,
          expires_in: issuedResult.expiresIn,
          expires_at: issuedResult.expiresAt,
          system: issuedResult.system,
          user: issuedResult.user,
          ...(initialParams.state ? { state: initialParams.state } : {}),
        },
        null,
        2
      )
    : '';

  const readonlySystemText = currentSystem ? currentSystem.name : lockedSystemParam;

  const authCard = (
    <div className="w-full bg-[#111827] border border-slate-800/90 rounded-lg p-6 sm:p-7 space-y-6">
      {issuedResult ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-800/80">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Token JWT Gerado com Sucesso</span>
              </div>
              <h2 className="font-display text-xl font-semibold text-white">
                {issuedResult.system.name} ({issuedResult.system.slug})
              </h2>
              <p className="text-xs text-slate-400">
                Autenticado como <span className="font-mono text-slate-200">{issuedResult.user.email}</span> ·
                Expiração em{' '}
                <span className="font-mono tabular-nums text-slate-200">
                  {new Date(issuedResult.expiresAt).toLocaleString('pt-BR')}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIssuedResult(null);
                setError(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Gerar Novo Token</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-300">Access Token (JWT)</label>
              <div className="flex items-center gap-2">
                {issuedResult.decoded && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono ${
                      issuedResult.decoded.validSignature
                        ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                        : 'bg-red-950/60 border-red-800/60 text-red-300'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>
                      {issuedResult.decoded.validSignature ? 'Assinatura Válida' : 'Assinatura Inválida'} ·{' '}
                      {String(issuedResult.decoded.header.alg || issuedResult.system.signingAlg || 'RS256')}
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void copyText(issuedResult.accessToken, 'jwt')}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded transition-colors"
                >
                  {copiedField === 'jwt' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'jwt' ? 'JWT Copiado' : 'Copiar JWT'}</span>
                </button>
              </div>
            </div>
            <textarea
              readOnly
              rows={4}
              value={issuedResult.accessToken}
              aria-label="Token JWT gerado"
              className="w-full bg-[#090D16] border border-slate-800 rounded-md p-3 text-xs font-mono text-emerald-300 break-all focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#090D16] border border-slate-800 rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Claims Decodificadas (JWT Payload)</span>
                <span className="tabular-nums text-slate-500">TTL {issuedResult.expiresIn}s</span>
              </div>
              <pre className="p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(issuedResult.decoded?.payload ?? issuedResult.user, null, 2)}
              </pre>
            </div>

            <div className="bg-[#090D16] border border-slate-800 rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Retorno JSON</span>
                <button
                  type="button"
                  onClick={() => void copyText(jsonReturnPayload, 'json')}
                  className="inline-flex items-center gap-1 text-[#F6821F] hover:text-[#ff983f]"
                >
                  {copiedField === 'json' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'json' ? 'Copiado' : 'Copiar JSON'}</span>
                </button>
              </div>
              <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-64 overflow-y-auto">
                {jsonReturnPayload}
              </pre>
            </div>
          </div>

          {authorizedRedirectUri && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-md bg-[#090D16] border border-slate-800">
              <div className="min-w-0">
                <div className="text-xs font-medium text-white">Callback Autorizado Detectado</div>
                <div className="text-[11px] font-mono text-slate-400 truncate">{authorizedRedirectUri}</div>
              </div>
              <button
                type="button"
                onClick={handleDeliverCallback}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Retornar Token para Aplicação</span>
              </button>
            </div>
          )}
        </div>
      ) : !mfaPending ? (
        <>
          <div className="space-y-1.5 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2 text-xs font-medium text-[#F6821F]">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Controle de Acesso</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-white">
              Validação de Identidade
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {hasLockedSystem
                ? 'O sistema de destino foi definido pelos parâmetros da requisição e está bloqueado para alteração.'
                : 'Selecione o sistema e informe as credenciais do usuário'}
            </p>
          </div>

          <form onSubmit={handleSubmitCredentials} className="space-y-4">
            <div ref={systemComboRef} className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="token-system-field" className="block text-xs font-medium text-slate-300">
                  Sistema
                </label>
                {hasLockedSystem && (
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-[#F6821F]" />
                    <span>Definido via requisição (somente leitura)</span>
                  </span>
                )}
              </div>

              <button
                id="token-system-field"
                type="button"
                role="combobox"
                disabled={hasLockedSystem}
                aria-disabled={hasLockedSystem}
                aria-expanded={!hasLockedSystem && systemDropdownOpen}
                aria-haspopup="listbox"
                aria-controls="token-system-listbox"
                onClick={() => {
                  if (!hasLockedSystem) setSystemDropdownOpen((prev) => !prev);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSystemDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 border rounded-md px-3.5 py-2.5 text-sm text-left transition-colors focus:outline-none ${
                  hasLockedSystem
                    ? 'bg-[#090D16]/60 border-slate-800 text-slate-300 cursor-not-allowed opacity-75'
                    : 'bg-[#090D16] border-slate-700/80 hover:border-slate-600 text-slate-100 focus:border-[#F6821F]'
                }`}
              >
                <span className="truncate">
                  {currentSystem
                    ? currentSystem.name
                    : hasLockedSystem && !systemsLoaded
                      ? 'Carregando sistema...'
                      : hasLockedSystem
                        ? lockedSystemParam
                        : 'Selecione um sistema'}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                    !hasLockedSystem && systemDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {!hasLockedSystem && systemDropdownOpen && (
                <div
                  id="token-system-listbox"
                  role="listbox"
                  aria-labelledby="token-system-field"
                  className="absolute z-30 left-0 right-0 mt-1.5 bg-[#090D16] border border-slate-700/90 rounded-md shadow-xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-slate-800/60"
                >
                  {systems.map((sys) => {
                    const isSelected = sys.slug === selectedSlug;
                    return (
                      <button
                        key={sys.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          setSelectedSlug(sys.slug);
                          setError(null);
                          setSystemDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-[#F6821F]/15 text-white'
                            : 'hover:bg-slate-800/60 text-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{sys.name}</div>
                          <div className="text-[11px] font-mono text-[#F6821F] truncate">{sys.slug}</div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#F6821F] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {lockedSystemInvalid && (
              <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-950/40 border border-amber-700/60 text-xs text-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Sistema <strong className="font-mono">{lockedSystemParam}</strong> não encontrado ou desativado.
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-md bg-red-950/40 border border-red-800/60 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div ref={userComboRef} className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="token-user-input" className="block text-xs font-medium text-slate-300">
                  Usuário
                </label>
                {isQuickAccount && matchedQuickAccount && (
                  <span className="text-[11px] text-[#F6821F] font-medium">{matchedQuickAccount.label}</span>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  ref={userInputRef}
                  id="token-user-input"
                  type="email"
                  required
                  role="combobox"
                  aria-expanded={userDropdownOpen}
                  aria-autocomplete="list"
                  value={email}
                  onChange={(e) => handleEmailInputChange(e.target.value)}
                  onFocus={() => {
                    if (suppressFocusOpenRef.current) {
                      suppressFocusOpenRef.current = false;
                      return;
                    }
                    if (showDemoPanel) setUserDropdownOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setUserDropdownOpen(false);
                  }}
                  placeholder="Digite o e-mail do usuário"
                  className="w-full bg-[#090D16] border border-slate-700/80 rounded-md pl-3.5 pr-16 py-2.5 text-sm text-white focus:outline-none focus:border-[#F6821F]"
                />
                <div className="absolute right-2 flex items-center gap-1">
                  {email && (
                    <button
                      type="button"
                      onClick={handleSwitchToManualEntry}
                      title="Limpar e digitar manualmente"
                      className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {showDemoPanel && (
                    <button
                      type="button"
                      onClick={() => setUserDropdownOpen((prev) => !prev)}
                      aria-label="Abrir opções de usuário"
                      className="p-1 text-slate-400 hover:text-white rounded transition-colors"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  )}
                </div>
              </div>

              {userDropdownOpen && (
                <div className="absolute z-30 left-0 right-0 mt-1.5 bg-[#090D16] border border-slate-700/90 rounded-md shadow-xl overflow-hidden">
                  {showDemoPanel && (
                    <>
                      <div className="px-3 py-1.5 text-[11px] font-medium text-[#F6821F] bg-slate-900/80 border-b border-slate-800/80">
                        Contas de Demonstração
                      </div>
                      <div className="divide-y divide-slate-800/60">
                        {QUICK_ACCOUNTS.map((acc) => {
                          const isSelected = matchedQuickAccount?.id === acc.id;
                          return (
                            <button
                              key={acc.id}
                              type="button"
                              onClick={() => handleSelectQuickAccount(acc)}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                                isSelected
                                  ? 'bg-[#F6821F]/15 text-white'
                                  : 'hover:bg-slate-800/60 text-slate-200'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-medium truncate">{acc.label}</div>
                                <div className="text-[11px] font-mono text-slate-400 truncate">{acc.email}</div>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-[#F6821F] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={handleSwitchToManualEntry}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-[#F6821F] hover:text-[#ff983f] hover:bg-slate-800/60 border-t border-slate-800/80 transition-colors"
                  >
                    Digitar credenciais...
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="token-password-input" className="block text-xs font-medium text-slate-300">
                  Senha
                </label>
                {isQuickAccount && (
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-slate-500" />
                    <span>Preenchimento automático</span>
                  </span>
                )}
              </div>
              <input
                id="token-password-input"
                type="password"
                required
                readOnly={isQuickAccount}
                value={password}
                onChange={(e) => {
                  if (!isQuickAccount) setPassword(e.target.value);
                }}
                placeholder="••••••••"
                className={`w-full border rounded-md px-3.5 py-2.5 text-sm focus:outline-none ${
                  isQuickAccount
                    ? 'bg-[#090D16]/60 border-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-[#090D16] border-slate-700/80 text-white focus:border-[#F6821F]'
                }`}
              />
            </div>

            <button
              type="submit"
              disabled={loading || lockedSystemInvalid || !selectedSlug}
              className="w-full flex items-center justify-center gap-2 bg-[#F6821F] hover:bg-[#e27316] disabled:opacity-50 text-slate-950 font-semibold text-sm py-2.5 px-4 rounded-md transition-colors whitespace-nowrap"
            >
              <span>{loading ? 'Autenticando...' : 'Autenticar'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {(executionEnvironment || currentSystem) && (
            <>
              <hr className="border-0 border-t border-slate-800/80" />
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th colSpan={2} scope="colgroup" className="pb-2 text-left font-medium text-[#F6821F]">
                      Sistema: {currentSystem ? currentSystem.slug : selectedSlug || lockedSystemParam || '—'}
                      {executionEnvironment ? ` (${executionEnvironment})` : ''}
                    </th>
                  </tr>
                </thead>
                {currentSystem && (
                  <tbody>
                    <tr>
                      <th scope="row" className="py-0.5 pr-4 text-left font-normal text-white">
                        Algorítimo de Assinatura
                      </th>
                      <td className="py-0.5 text-right font-mono tabular-nums text-slate-400">
                        {currentSystem.signingAlg}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="py-0.5 pr-4 text-left font-normal text-white">
                        Expiração do Token
                      </th>
                      <td className="py-0.5 text-right font-mono tabular-nums text-slate-400">
                        {currentSystem.jwtTtlSeconds}s
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="py-0.5 pr-4 text-left font-normal text-white">
                        Expiração do Cache
                      </th>
                      <td className="py-0.5 text-right font-mono tabular-nums text-slate-400">
                        {currentSystem.edgeCacheTtl}s
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="py-0.5 pr-4 text-left font-normal text-white">
                        Autenticação Segura
                      </th>
                      <td className="py-0.5 text-right font-mono text-slate-400">
                        {(() => {
                          const labels: Record<string, string> = {
                            totp: '2FA (TOTP)',
                            sms: 'SMS',
                            backup_code: 'Código de Backup',
                          };
                          const methods = (currentSystem.allowedMfaMethods || []).map(
                            (m) => labels[m.toLowerCase()] || m.toUpperCase()
                          );
                          const reqLabel = currentSystem.requireMfa ? 'Obrigatório' : 'Opcional';
                          return methods.length > 0
                            ? `${methods.join(', ')} (${reqLabel})`
                            : reqLabel;
                        })()}
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </>
          )}
        </>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800/80">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-[#F6821F]">
                <Lock className="w-3.5 h-3.5" />
                <span>Verificação 2FA Necessária</span>
              </div>
              <h2 className="font-display text-lg font-semibold text-white">
                Confirme o segundo fator para {mfaPending.systemName}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setMfaPending(null);
                setMfaCode('');
                setError(null);
              }}
              className="text-xs text-slate-400 hover:text-white"
            >
              Voltar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {mfaPending.availableMethods.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => {
                  setMfaMethod(method as 'totp' | 'sms' | 'backup_code');
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  mfaMethod === method
                    ? 'bg-[#F6821F]/15 border-[#F6821F] text-white'
                    : 'bg-[#090D16] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {method === 'totp' ? 'TOTP' : method === 'sms' ? 'SMS OTP' : 'Código de Backup'}
              </button>
            ))}
          </div>

          {mfaMethod === 'sms' && (
            <div className="p-3 rounded-md bg-[#090D16] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-[#F6821F]" />
                  <span>Destino: {mfaPending.phoneMasked || 'Telefone verificado'}</span>
                </span>
                <button
                  type="button"
                  onClick={handleSendSmsOtp}
                  disabled={loading}
                  className="px-2.5 py-1 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700 text-white rounded"
                >
                  Enviar SMS
                </button>
              </div>
              {smsPreview && (
                <div className="text-xs font-mono text-emerald-400">
                  Código Sandbox: <strong>{smsPreview}</strong>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-red-950/40 border border-red-800/60 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleVerifyMfa} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Código de Verificação</label>
              <input
                type="text"
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={mfaMethod === 'backup_code' ? 'XXXX-XXXX' : '000000'}
                className="w-full bg-[#090D16] border border-slate-700/80 rounded-md px-3.5 py-2.5 text-center text-base font-mono tracking-widest text-white focus:outline-none focus:border-[#F6821F]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#F6821F] hover:bg-[#e27316] disabled:opacity-50 text-slate-950 font-semibold text-sm py-2.5 px-4 rounded-md transition-colors"
            >
              {loading ? 'Validando...' : 'Validar 2FA e Gerar JWT'}
            </button>
          </form>
        </div>
      )}
    </div>
  );

  if (standalone) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col justify-between">
        <header className="min-h-14 py-1.5 px-6 border-b border-slate-800/80 bg-[#090D16] flex items-center justify-between gap-6 shrink-0">
          <BrandHeaderLogo platformName={platformName} />
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <a
              href="/"
              className="px-3 py-1.5 rounded-md bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors whitespace-nowrap"
            >
              Console IAM
            </a>
          </div>
        </header>

        <main className="w-full px-6 my-auto py-10">
          <div className="max-w-2xl w-full mx-auto">{authCard}</div>
        </main>

        <footer className="w-full px-6 py-4 border-t border-slate-800/60 flex items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>{platformName} · Portal Autônomo de Token JWT</span>
            <VersionBadge />
          </div>
          <span>© 2026, Smart Target</span>
        </footer>
      </div>
    );
  }

  const getUrlWithSystem = `/obter-token?sistema=${encodeURIComponent(testSystemSlug)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-white">Obter Token</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Autenticação direta e retorno de token JWT, com acesso autônomo via GET ou POST em{' '}
            <span className="font-mono text-slate-300">/obter-token</span>.
          </p>
        </div>

        <a
          href="/obter-token"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 rounded-md transition-colors whitespace-nowrap"
        >
          <ExternalLink className="w-3.5 h-3.5 text-[#F6821F]" />
          <span>Abrir Tela Autônoma</span>
        </a>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7">{authCard}</div>

        <aside className="xl:col-span-5 bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-semibold text-white">Integração Autônoma (GET / POST)</h2>
            <span className="text-[11px] font-mono text-[#F6821F]">/obter-token</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Envie o parâmetro <span className="font-mono text-slate-200">sistema</span> (ou{' '}
            <span className="font-mono text-slate-200">system</span>) via query string GET ou corpo POST para travar o
            campo de sistema como somente leitura na tela autônoma.
          </p>

          <div>
            <label htmlFor="test-launch-system" className="block text-xs font-medium text-slate-300 mb-1.5">
              Sistema para testar abertura autônoma
            </label>
            <select
              id="test-launch-system"
              value={testSystemSlug}
              onChange={(e) => setTestSystemSlug(e.target.value)}
              className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
            >
              {systems.map((sys) => (
                <option key={sys.id} value={sys.slug}>
                  {sys.name} ({sys.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>Via GET (parâmetro na URL)</span>
              <button
                type="button"
                onClick={() => void copyText(`${window.location.origin}${getUrlWithSystem}`, 'url')}
                className="text-[#F6821F] hover:text-[#ff983f] inline-flex items-center gap-1"
              >
                {copiedField === 'url' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'url' ? 'Copiado' : 'Copiar URL'}</span>
              </button>
            </div>
            <div className="p-2.5 rounded bg-[#090D16] border border-slate-800 text-[11px] font-mono text-slate-300 break-all">
              GET {getUrlWithSystem}
            </div>
            <a
              href={getUrlWithSystem}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#F6821F]" />
              <span>Abrir via GET com sistema travado</span>
            </a>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="text-[11px] font-mono text-slate-400">Via POST (payload JSON ou form-urlencoded)</div>
            <pre className="p-2.5 rounded bg-[#090D16] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
              {`POST /obter-token\n{\n  "sistema": "${testSystemSlug}"\n}`}
            </pre>
            <form method="POST" action="/obter-token" target="_blank">
              <input type="hidden" name="sistema" value={testSystemSlug} />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#090D16] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-[#F6821F]" />
                <span>Abrir via POST com sistema travado</span>
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
};
