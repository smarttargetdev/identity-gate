/**
 * File: SystemSettings.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Painel administrativo de configurações globais de tokens, segurança, borda, auditoria e privacidade.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  Code2,
  Database,
  FileCode2,
  Globe,
  KeyRound,
  Layers,
  Lock,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { gqlRequest } from '../libraries/GraphqlClient';
import { playHealthAlertSound } from '../libraries/HealthAlertAudio';
import { DetailedErrorLog } from './DetailedErrorLog';
import { InfoTooltip } from './InfoTooltip';
import type { ExecutionEnvironment, PlatformSystemSettings } from '../domains/Identity';

interface SystemSettingsProps {
  token: string;
  isSuperAdmin: boolean;
  onNotify: (msg: string) => void;
  onSettingsUpdated?: (settings: PlatformSystemSettings) => void;
}

type SettingsTab = 'environment' | 'infra' | 'auth' | 'edge' | 'compliance' | 'errors';

const SYSTEM_SETTINGS_QUERY = `
  query AdminSystemSettings {
    systemSettings {
      executionEnvironment
      platformName
      jwtIssuer
      appBaseUrl
      defaultJwtTtlSeconds
      defaultSigningAlg
      sessionWarningSeconds
      oauthCodeTtlSeconds
      pkceRequired
      allowSelfRegistration
      globalRequireMfa
      globalPasswordMinLength
      maxLoginAttempts
      smsOtpTtlSeconds
      smsSandboxPreview
      jitProvisioningEnabled
      edgeCacheEnabled
      defaultEdgeCacheTtl
      auditFlushBatchSize
      auditRetentionDays
      piiMaskingEnabled
      telemetryStreamEnabled
      healthAlertSoundEnabled
      defaultPrivacyPolicyVersion
      requireExplicitConsent
      allowDataPortabilityExport
      allowSelfErasure
      systemIdPrefix
      clientIdPrefix
      normalizeIdentifiers
      systemIdSeparator
      clientIdSeparator
      infraWorkerName
      infraAccountId
      infraCompatibilityDate
      infraCompatibilityFlags
      infraCustomRoute
      infraWorkersDev
      infraWorkerJwtIssuer
      infraD1Binding
      infraD1DatabaseName
      infraD1DatabaseId
      infraKvBinding
      infraKvNamespaceId
      infraBundleFilename
      infraWranglerEnv
      infraIncludeDeployScript
      infraIncludeReadme
      updatedAt
      updatedBy
      runtime {
        sqliteJournalMode
        d1Compatible
        rsaKeyId
        activeSystemsCount
        activeUsersCount
      }
    }
  }
`;

const UPDATE_SETTINGS_MUTATION = `
  mutation UpdateAdminSystemSettings($input: SystemSettingsInput!) {
    updateSystemSettings(input: $input) {
      executionEnvironment
      platformName
      jwtIssuer
      appBaseUrl
      defaultJwtTtlSeconds
      defaultSigningAlg
      sessionWarningSeconds
      oauthCodeTtlSeconds
      pkceRequired
      allowSelfRegistration
      globalRequireMfa
      globalPasswordMinLength
      maxLoginAttempts
      smsOtpTtlSeconds
      smsSandboxPreview
      jitProvisioningEnabled
      edgeCacheEnabled
      defaultEdgeCacheTtl
      auditFlushBatchSize
      auditRetentionDays
      piiMaskingEnabled
      telemetryStreamEnabled
      healthAlertSoundEnabled
      defaultPrivacyPolicyVersion
      requireExplicitConsent
      allowDataPortabilityExport
      allowSelfErasure
      systemIdPrefix
      clientIdPrefix
      normalizeIdentifiers
      systemIdSeparator
      clientIdSeparator
      infraWorkerName
      infraAccountId
      infraCompatibilityDate
      infraCompatibilityFlags
      infraCustomRoute
      infraWorkersDev
      infraWorkerJwtIssuer
      infraD1Binding
      infraD1DatabaseName
      infraD1DatabaseId
      infraKvBinding
      infraKvNamespaceId
      infraBundleFilename
      infraWranglerEnv
      infraIncludeDeployScript
      infraIncludeReadme
      updatedAt
      updatedBy
      runtime {
        sqliteJournalMode
        d1Compatible
        rsaKeyId
        activeSystemsCount
        activeUsersCount
      }
    }
  }
`;

const RESET_SETTINGS_MUTATION = `
  mutation ResetAdminSystemSettings {
    resetSystemSettings {
      executionEnvironment
      platformName
      jwtIssuer
      appBaseUrl
      defaultJwtTtlSeconds
      defaultSigningAlg
      sessionWarningSeconds
      oauthCodeTtlSeconds
      pkceRequired
      allowSelfRegistration
      globalRequireMfa
      globalPasswordMinLength
      maxLoginAttempts
      smsOtpTtlSeconds
      smsSandboxPreview
      jitProvisioningEnabled
      edgeCacheEnabled
      defaultEdgeCacheTtl
      auditFlushBatchSize
      auditRetentionDays
      piiMaskingEnabled
      telemetryStreamEnabled
      healthAlertSoundEnabled
      defaultPrivacyPolicyVersion
      requireExplicitConsent
      allowDataPortabilityExport
      allowSelfErasure
      systemIdPrefix
      clientIdPrefix
      normalizeIdentifiers
      systemIdSeparator
      clientIdSeparator
      infraWorkerName
      infraAccountId
      infraCompatibilityDate
      infraCompatibilityFlags
      infraCustomRoute
      infraWorkersDev
      infraWorkerJwtIssuer
      infraD1Binding
      infraD1DatabaseName
      infraD1DatabaseId
      infraKvBinding
      infraKvNamespaceId
      infraBundleFilename
      infraWranglerEnv
      infraIncludeDeployScript
      infraIncludeReadme
      updatedAt
      updatedBy
      runtime {
        sqliteJournalMode
        d1Compatible
        rsaKeyId
        activeSystemsCount
        activeUsersCount
      }
    }
  }
`;

const ENVIRONMENTS: Array<{
  value: ExecutionEnvironment;
  description: string;
}> = [
  {
    value: 'Desenvolvimento',
    description: 'Exibe o painel "Contas de Demonstração" na tela de login e facilita testes locais.',
  },
  {
    value: 'Homologação',
    description: 'Ambiente de pré-produção e QA mantendo "Contas de Demonstração" acessíveis.',
  },
  {
    value: 'Produção',
    description: 'Oculta o painel "Contas de Demonstração" na tela de login e bloqueia atalhos de teste.',
  },
];

const TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'environment', label: 'Ambientes', icon: Server },
  { id: 'infra', label: 'Infraestrutura', icon: Code2 },
  { id: 'auth', label: 'Autorização & Autenticação', icon: Lock },
  { id: 'edge', label: 'Edge Cache & Auditoria', icon: Database },
  { id: 'compliance', label: 'LGPD & Privacidade', icon: ShieldCheck },
  { id: 'errors', label: 'Log de Erros Detalhado', icon: Bug },
];

const SEPARATOR_OPTIONS: Array<{ value: '_' | '-'; label: string }> = [
  { value: '_', label: '_ (Sublinhado)' },
  { value: '-', label: '- (Hífen)' },
];

const SIGNING_ALG_OPTIONS: Array<{ value: 'RS256' | 'HS256'; label: string }> = [
  { value: 'RS256', label: 'RS256 (Assimétrico + JWKS)' },
  { value: 'HS256', label: 'HS256 (HMAC Compartilhado)' },
];

interface CompactComboProps<T extends string> {
  id: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  menuAlign?: 'left' | 'right';
  menuMinWidthClass?: string;
  centerValue?: boolean;
}

function CompactCombo<T extends string>({
  id,
  value,
  options,
  onChange,
  menuAlign = 'right',
  menuMinWidthClass = 'min-w-[156px]',
  centerValue = false,
}: CompactComboProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-1.5 bg-[#090D16] border border-slate-700 hover:border-slate-500 rounded-md px-3 py-2 text-xs font-mono text-white transition-colors"
      >
        <span className={`flex-1 ${centerValue ? 'text-center' : 'text-left'}`}>{value}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-labelledby={id}
          className={`absolute ${
            menuAlign === 'left' ? 'left-0' : 'right-0'
          } mt-1.5 z-40 ${menuMinWidthClass} bg-[#090D16] border border-slate-700/90 rounded-md shadow-xl overflow-hidden divide-y divide-slate-800/60`}
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-xs font-mono text-left whitespace-nowrap transition-colors ${
                    selected
                      ? 'bg-[#F6821F]/15 text-white'
                      : 'text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  <span>{opt.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const SystemSettings: React.FC<SystemSettingsProps> = ({
  token,
  isSuperAdmin,
  onNotify,
  onSettingsUpdated,
}) => {
  const [saved, setSaved] = useState<PlatformSystemSettings | null>(null);
  const [draft, setDraft] = useState<PlatformSystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('environment');
  const [errorLogCount, setErrorLogCount] = useState<number | null>(null);
  const [confirmProdModal, setConfirmProdModal] = useState(false);
  const [confirmResetModal, setConfirmResetModal] = useState(false);

  const loadSettings = async () => {
    if (!isSuperAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await gqlRequest<{ systemSettings: PlatformSystemSettings }>({
        token,
        query: SYSTEM_SETTINGS_QUERY,
        operationName: 'AdminSystemSettings',
        bypassCache: true,
      });
      setSaved(data.systemSettings);
      setDraft(data.systemSettings);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar configurações do sistema.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, [token, isSuperAdmin]);

  const isDirty = useMemo(() => {
    if (!saved || !draft) return false;
    const keys: Array<keyof PlatformSystemSettings> = [
      'executionEnvironment',
      'platformName',
      'jwtIssuer',
      'appBaseUrl',
      'defaultJwtTtlSeconds',
      'defaultSigningAlg',
      'sessionWarningSeconds',
      'oauthCodeTtlSeconds',
      'pkceRequired',
      'allowSelfRegistration',
      'globalRequireMfa',
      'globalPasswordMinLength',
      'maxLoginAttempts',
      'smsOtpTtlSeconds',
      'smsSandboxPreview',
      'jitProvisioningEnabled',
      'edgeCacheEnabled',
      'defaultEdgeCacheTtl',
      'auditFlushBatchSize',
      'auditRetentionDays',
      'piiMaskingEnabled',
      'telemetryStreamEnabled',
      'healthAlertSoundEnabled',
      'defaultPrivacyPolicyVersion',
      'requireExplicitConsent',
      'allowDataPortabilityExport',
      'allowSelfErasure',
      'systemIdPrefix',
      'clientIdPrefix',
      'normalizeIdentifiers',
      'systemIdSeparator',
      'clientIdSeparator',
      'infraWorkerName',
      'infraAccountId',
      'infraCompatibilityDate',
      'infraCompatibilityFlags',
      'infraCustomRoute',
      'infraWorkersDev',
      'infraWorkerJwtIssuer',
      'infraD1Binding',
      'infraD1DatabaseName',
      'infraD1DatabaseId',
      'infraKvBinding',
      'infraKvNamespaceId',
      'infraBundleFilename',
      'infraWranglerEnv',
      'infraIncludeDeployScript',
      'infraIncludeReadme',
    ];
    return keys.some((k) => saved[k] !== draft[k]);
  }, [saved, draft]);

  if (!isSuperAdmin) {
    return (
      <div className="bg-[#111827] border border-red-800/50 rounded-lg p-8 max-w-2xl space-y-3">
        <div className="flex items-center gap-2.5 text-red-400">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <h1 className="font-display text-lg font-semibold text-white">Acesso Restrito ao Administrador</h1>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          A configuração global de parâmetros do sistema e ambiente de execução pode ser acessada exclusivamente por
          usuários com a função <span className="font-mono text-white">super_admin</span>.
        </p>
      </div>
    );
  }

  const executeSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { data } = await gqlRequest<{ updateSystemSettings: PlatformSystemSettings }>({
        token,
        operationName: 'UpdateAdminSystemSettings',
        query: UPDATE_SETTINGS_MUTATION,
        variables: {
          input: {
            executionEnvironment: draft.executionEnvironment,
            platformName: draft.platformName,
            jwtIssuer: draft.jwtIssuer,
            appBaseUrl: draft.appBaseUrl,
            defaultJwtTtlSeconds: Number(draft.defaultJwtTtlSeconds),
            defaultSigningAlg: draft.defaultSigningAlg,
            sessionWarningSeconds: Number(draft.sessionWarningSeconds),
            oauthCodeTtlSeconds: Number(draft.oauthCodeTtlSeconds),
            pkceRequired: draft.pkceRequired,
            allowSelfRegistration: draft.allowSelfRegistration,
            globalRequireMfa: draft.globalRequireMfa,
            globalPasswordMinLength: Number(draft.globalPasswordMinLength),
            maxLoginAttempts: Number(draft.maxLoginAttempts),
            smsOtpTtlSeconds: Number(draft.oauthCodeTtlSeconds),
            smsSandboxPreview: draft.smsSandboxPreview,
            jitProvisioningEnabled: draft.jitProvisioningEnabled,
            edgeCacheEnabled: draft.edgeCacheEnabled,
            defaultEdgeCacheTtl: Number(draft.defaultEdgeCacheTtl),
            auditFlushBatchSize: Number(draft.auditFlushBatchSize),
            auditRetentionDays: Number(draft.auditRetentionDays),
            piiMaskingEnabled: draft.piiMaskingEnabled,
            telemetryStreamEnabled: draft.telemetryStreamEnabled,
            healthAlertSoundEnabled: draft.healthAlertSoundEnabled,
            defaultPrivacyPolicyVersion: draft.defaultPrivacyPolicyVersion,
            requireExplicitConsent: draft.requireExplicitConsent,
            allowDataPortabilityExport: draft.allowDataPortabilityExport,
            allowSelfErasure: draft.allowSelfErasure,
            systemIdPrefix: draft.systemIdPrefix,
            clientIdPrefix: draft.clientIdPrefix,
            normalizeIdentifiers: draft.normalizeIdentifiers,
            systemIdSeparator: draft.systemIdSeparator,
            clientIdSeparator: draft.clientIdSeparator,
            infraWorkerName: draft.infraWorkerName,
            infraAccountId: draft.infraAccountId,
            infraCompatibilityDate: draft.infraCompatibilityDate,
            infraCompatibilityFlags: draft.infraCompatibilityFlags,
            infraCustomRoute: draft.infraCustomRoute,
            infraWorkersDev: draft.infraWorkersDev,
            infraWorkerJwtIssuer: draft.infraWorkerJwtIssuer,
            infraD1Binding: draft.infraD1Binding,
            infraD1DatabaseName: draft.infraD1DatabaseName,
            infraD1DatabaseId: draft.infraD1DatabaseId,
            infraKvBinding: draft.infraKvBinding,
            infraKvNamespaceId: draft.infraKvNamespaceId,
            infraBundleFilename: draft.infraBundleFilename,
            infraWranglerEnv: draft.infraWranglerEnv,
            infraIncludeDeployScript: draft.infraIncludeDeployScript,
            infraIncludeReadme: draft.infraIncludeReadme,
          },
        },
      });
      setSaved(data.updateSystemSettings);
      setDraft(data.updateSystemSettings);
      setConfirmProdModal(false);
      onSettingsUpdated?.(data.updateSystemSettings);
      onNotify(
        `Configurações salvas (Ambiente: ${data.updateSystemSettings.executionEnvironment}). Cache na borda atualizado.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !saved) return;
    if (draft.executionEnvironment === 'Produção' && saved.executionEnvironment !== 'Produção') {
      setConfirmProdModal(true);
      return;
    }
    void executeSave();
  };

  const handleConfirmReset = async () => {
    setSaving(true);
    try {
      const { data } = await gqlRequest<{ resetSystemSettings: PlatformSystemSettings }>({
        token,
        operationName: 'ResetAdminSystemSettings',
        query: RESET_SETTINGS_MUTATION,
      });
      setSaved(data.resetSystemSettings);
      setDraft(data.resetSystemSettings);
      setConfirmResetModal(false);
      onSettingsUpdated?.(data.resetSystemSettings);
      onNotify('Parâmetros do sistema restaurados para os valores padrão (Ambiente: Desenvolvimento).');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao restaurar configurações padrão.');
    } finally {
      setSaving(false);
    }
  };

  const activeTabMeta = TABS.find((t) => t.id === activeTab);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold text-white">Configurações do Sistema</h1>
          <InfoTooltip text="Parametrização global exclusiva do administrador: ambiente de execução, JWT/OAuth 2.0, segurança 2FA, borda SQLite/Cache e conformidade LGPD." />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isDirty && saved && (
            <button
              type="button"
              onClick={() => setDraft(saved)}
              className="px-3 py-2 text-xs text-slate-300 hover:text-white border border-slate-700 rounded-md whitespace-nowrap"
            >
              Descartar Alterações
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmResetModal(true)}
            disabled={loading || saving}
            aria-label="Restaurar"
            title="Restaurar"
            className="relative group flex items-center justify-center p-2 text-xs text-slate-200 hover:text-white bg-[#111827] border border-slate-700/80 rounded-md transition-colors disabled:opacity-50 shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            <span
              role="tooltip"
              className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
            >
              Restaurar
            </span>
          </button>
          <button
            type="submit"
            form="system-settings-form"
            disabled={loading || saving || !draft}
            aria-label="Salvar"
            title="Salvar"
            className="relative group flex items-center justify-center p-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] disabled:opacity-50 text-slate-950 rounded-md transition-colors shrink-0"
          >
            <Save className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
            <span
              role="tooltip"
              className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
            >
              Salvar
            </span>
          </button>
        </div>
      </div>

      {/* Runtime Read-Only Diagnostics Bar */}
      {saved?.runtime && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-[#111827] border border-slate-800/90 rounded-lg text-xs text-slate-400 font-mono tabular-nums">
          <span>
            Ambiente Ativo:{' '}
            <strong className={saved.executionEnvironment === 'Produção' ? 'text-amber-400' : 'text-emerald-400'}>
              {saved.executionEnvironment}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>SQLite: {saved.runtime.sqliteJournalMode}</span>
          <span aria-hidden="true">·</span>
          <span>Chave RSA: {saved.runtime.rsaKeyId}</span>
          <span aria-hidden="true">·</span>
          <span>Sistemas Ativos: {saved.runtime.activeSystemsCount}</span>
          <span aria-hidden="true">·</span>
          <span>Usuários Ativos: {saved.runtime.activeUsersCount}</span>
          <span aria-hidden="true">·</span>
          <span>
            Atualizado: {new Date(saved.updatedAt).toLocaleString('pt-BR')} ({saved.updatedBy})
          </span>
        </div>
      )}

      {/* Configuration Tabs */}
      <div
        role="tablist"
        aria-label="Seções de Configuração"
        className="flex items-center gap-1 overflow-x-auto border-b border-slate-800/90"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[#F6821F] text-white bg-[#111827]/70'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
              {tab.id === 'errors' && errorLogCount !== null && errorLogCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-red-950/70 border border-red-800/60 text-[10px] font-mono tabular-nums text-red-300">
                  {errorLogCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'errors' && (
        <div role="tabpanel" id="settings-panel-errors" aria-labelledby="settings-tab-errors">
          <DetailedErrorLog
            token={token}
            telemetryStreamEnabled={draft?.telemetryStreamEnabled ?? true}
            onNotify={onNotify}
            onCountChange={setErrorLogCount}
          />
        </div>
      )}

      {loading || !draft ? (
        activeTab !== 'errors' && (
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-8 text-center text-xs text-slate-500">
            Carregando parâmetros do sistema via GraphQL...
          </div>
        )
      ) : (
        <form
          id="system-settings-form"
          onSubmit={handleRequestSave}
          role="tabpanel"
          aria-labelledby={activeTabMeta ? `settings-tab-${activeTabMeta.id}` : undefined}
          className={activeTab === 'errors' ? 'hidden' : 'space-y-6'}
        >
          {/* 1. Ambientes de Execução & Identidade da Plataforma */}
          {activeTab === 'environment' && (
            <>
              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Server className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Ambientes de Execução</h2>
                    <InfoTooltip text="Define o comportamento da tela de autenticação, exposição de contas de demonstração e bloqueio de atalhos de teste." />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {ENVIRONMENTS.map((envOpt) => {
                    const selected = draft.executionEnvironment === envOpt.value;
                    return (
                      <button
                        key={envOpt.value}
                        type="button"
                        onClick={() => setDraft({ ...draft, executionEnvironment: envOpt.value })}
                        className={`text-left p-3.5 rounded-md border transition-colors ${
                          selected
                            ? 'bg-[#F6821F]/15 border-[#F6821F] text-white'
                            : 'bg-[#090D16] border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="text-xs font-semibold">{envOpt.value}</div>
                        <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{envOpt.description}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Globe className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Identidade da Plataforma</h2>
                    <InfoTooltip text="Define o nome exibido da plataforma, o emissor OIDC/JWT (iss) e a URL base para callbacks OAuth 2.0." />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Nome da Plataforma</label>
                    <input
                      type="text"
                      required
                      value={draft.platformName}
                      onChange={(e) => setDraft({ ...draft, platformName: e.target.value })}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Emissor de Token</label>
                    <input
                      type="text"
                      required
                      value={draft.jwtIssuer}
                      onChange={(e) => setDraft({ ...draft, jwtIssuer: e.target.value })}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Servidor de Autenticação (Callback)
                    </label>
                    <input
                      type="text"
                      value={draft.appBaseUrl}
                      onChange={(e) => setDraft({ ...draft, appBaseUrl: e.target.value })}
                      placeholder="Auto-detectar via Host / Proxy"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* 1b. Prefixos e Normalização de Identificadores de Sistemas */}
          {activeTab === 'environment' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Layers className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Prefixos e Normalização</h2>
                  <InfoTooltip text="Define os prefixos padrão para o sistema e o cliente, se os valores devem ser normalizados e o caracter separador (- ou _)." />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-white">Identificador do Sistema</div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <label htmlFor="system-id-prefix" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Prefixo
                      </label>
                      <input
                        id="system-id-prefix"
                        type="text"
                        required
                        value={draft.systemIdPrefix}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            systemIdPrefix: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="system"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div className="w-20 shrink-0">
                      <label htmlFor="system-id-separator" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Separador
                      </label>
                      <CompactCombo
                        id="system-id-separator"
                        value={draft.systemIdSeparator}
                        options={SEPARATOR_OPTIONS}
                        centerValue
                        onChange={(val) => setDraft({ ...draft, systemIdSeparator: val })}
                      />
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Exemplo:{' '}
                    <span className="text-slate-200">
                      {(draft.systemIdPrefix || 'system').replace(/[-_]+$/g, '')}
                      {draft.systemIdSeparator}
                      {draft.normalizeIdentifiers
                        ? `portal${draft.systemIdSeparator}parceiros`
                        : 'portal-parceiros'}
                    </span>
                  </div>
                </div>

                <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-white">Identificador do Cliente</div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <label htmlFor="client-id-prefix" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Prefixo
                      </label>
                      <input
                        id="client-id-prefix"
                        type="text"
                        required
                        value={draft.clientIdPrefix}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            clientIdPrefix: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="client"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div className="w-20 shrink-0">
                      <label htmlFor="client-id-separator" className="block text-xs font-medium text-slate-300 mb-1.5">
                        Separador
                      </label>
                      <CompactCombo
                        id="client-id-separator"
                        value={draft.clientIdSeparator}
                        options={SEPARATOR_OPTIONS}
                        centerValue
                        onChange={(val) => setDraft({ ...draft, clientIdSeparator: val })}
                      />
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Exemplo:{' '}
                    <span className="text-slate-200">
                      {(draft.clientIdPrefix || 'client').replace(/[-_]+$/g, '')}
                      {draft.clientIdSeparator}
                      {draft.normalizeIdentifiers
                        ? `portal${draft.clientIdSeparator}parceiros`
                        : 'portal-parceiros'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.normalizeIdentifiers}
                    onChange={(e) => setDraft({ ...draft, normalizeIdentifiers: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>
                    Normalizar valores (substituir caracteres inválidos pelo separador do campo)
                  </span>
                </label>
              </div>
            </section>
          )}

          {/* 1c. Scripts de Implementação de Infraestrutura */}
          {activeTab === 'infra' && (
            <>
              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Terminal className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Cloudflare Worker & Wrangler (wrangler.toml)</h2>
                    <InfoTooltip text="Parâmetros usados para gerar o manifesto wrangler.toml e o código do Edge Worker na página Infraestrutura." />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Nome do Worker</label>
                    <input
                      type="text"
                      required
                      value={draft.infraWorkerName}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          infraWorkerName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                        })
                      }
                      placeholder="isg-edge-worker"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Cloudflare Account ID (Opcional)
                    </label>
                    <input
                      type="text"
                      value={draft.infraAccountId}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          infraAccountId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                        })
                      }
                      placeholder="32 caracteres hexadecimais"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Data de Compatibilidade</label>
                    <input
                      type="date"
                      required
                      value={draft.infraCompatibilityDate}
                      onChange={(e) => setDraft({ ...draft, infraCompatibilityDate: e.target.value })}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Flags de Compatibilidade</label>
                    <input
                      type="text"
                      required
                      value={draft.infraCompatibilityFlags}
                      onChange={(e) => setDraft({ ...draft, infraCompatibilityFlags: e.target.value })}
                      placeholder="nodejs_compat"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Emissor JWT do Worker (Opcional)
                    </label>
                    <input
                      type="text"
                      value={draft.infraWorkerJwtIssuer}
                      onChange={(e) => setDraft({ ...draft, infraWorkerJwtIssuer: e.target.value })}
                      placeholder={`Padrão global (${draft.jwtIssuer})`}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Rota / Domínio Customizado (Opcional)
                    </label>
                    <input
                      type="text"
                      value={draft.infraCustomRoute}
                      onChange={(e) => setDraft({ ...draft, infraCustomRoute: e.target.value })}
                      placeholder="iam.sua-empresa.com"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.infraWorkersDev}
                      onChange={(e) => setDraft({ ...draft, infraWorkersDev: e.target.checked })}
                      className="rounded border-slate-700 bg-[#090D16]"
                    />
                    <span>Habilitar subdomínio *.workers.dev (workers_dev = true)</span>
                  </label>
                </div>
              </section>

              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Database className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Banco de Dados D1 & Workers KV</h2>
                    <InfoTooltip text="Bindings, nomes e identificadores dos recursos D1 e KV injetados nos scripts wrangler.toml, worker.ts e deploy.sh." />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                    <div className="text-xs font-semibold text-white">Cloudflare D1 (SQLite na Borda)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">Binding</label>
                        <input
                          type="text"
                          required
                          value={draft.infraD1Binding}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              infraD1Binding: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
                            })
                          }
                          placeholder="DB"
                          className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1.5">Nome do Banco</label>
                        <input
                          type="text"
                          required
                          value={draft.infraD1DatabaseName}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              infraD1DatabaseName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                            })
                          }
                          placeholder="isg-d1"
                          className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Database ID</label>
                      <input
                        type="text"
                        required
                        value={draft.infraD1DatabaseId}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            infraD1DatabaseId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="00000000-0000-0000-0000-000000000000"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>

                  <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                    <div className="text-xs font-semibold text-white">Cloudflare Workers KV</div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Binding</label>
                      <input
                        type="text"
                        required
                        value={draft.infraKvBinding}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            infraKvBinding: e.target.value.replace(/[^a-zA-Z0-9_]/g, ''),
                          })
                        }
                        placeholder="IAM_KV"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Namespace ID</label>
                      <input
                        type="text"
                        required
                        value={draft.infraKvNamespaceId}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            infraKvNamespaceId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="00000000000000000000000000000000"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <FileCode2 className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Pacote de Deploy & Scripts Automatizados</h2>
                    <InfoTooltip text="Controla o nome do pacote .zip exportado e os scripts auxiliares incluídos na geração da infraestrutura." />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Nome do Pacote (.zip)
                    </label>
                    <input
                      type="text"
                      required
                      value={draft.infraBundleFilename}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          infraBundleFilename: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                        })
                      }
                      placeholder="isg-cloudflare-d1-bundle"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Ambiente Wrangler (--env, Opcional)
                    </label>
                    <input
                      type="text"
                      value={draft.infraWranglerEnv}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          infraWranglerEnv: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                        })
                      }
                      placeholder="production"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                  <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.infraIncludeDeployScript}
                      onChange={(e) => setDraft({ ...draft, infraIncludeDeployScript: e.target.checked })}
                      className="rounded border-slate-700 bg-[#090D16]"
                    />
                    <span>Incluir script shell automatizado (deploy.sh)</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.infraIncludeReadme}
                      onChange={(e) => setDraft({ ...draft, infraIncludeReadme: e.target.checked })}
                      className="rounded border-slate-700 bg-[#090D16]"
                    />
                    <span>Incluir guia de provisionamento (README.md)</span>
                  </label>
                </div>

                <div className="bg-[#090D16] border border-slate-800 rounded-md p-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Prévia dos parâmetros em wrangler.toml & CLI</span>
                    <span>
                      Arquivo: <strong className="text-slate-200">{draft.infraBundleFilename || 'isg-cloudflare-d1-bundle'}.zip</strong>
                    </span>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`name = "${draft.infraWorkerName || 'isg-edge-worker'}"
compatibility_date = "${draft.infraCompatibilityDate || '2026-03-01'}"
${draft.infraAccountId ? `account_id = "${draft.infraAccountId}"\n` : ''}[[d1_databases]] -> binding="${draft.infraD1Binding || 'DB'}", database_name="${draft.infraD1DatabaseName || 'isg-d1'}"
[[kv_namespaces]] -> binding="${draft.infraKvBinding || 'IAM_KV'}", id="${draft.infraKvNamespaceId || '00000000000000000000000000000000'}"
[vars] -> IAM_JWT_ISSUER="${draft.infraWorkerJwtIssuer || draft.jwtIssuer}" · DEFAULT_EDGE_CACHE_TTL="${draft.defaultEdgeCacheTtl}"
$ npx wrangler d1 execute ${draft.infraD1DatabaseName || 'isg-d1'} --remote --file=./schema.d1.sql${draft.infraWranglerEnv ? ` --env ${draft.infraWranglerEnv}` : ''} && npx wrangler deploy${draft.infraWranglerEnv ? ` --env ${draft.infraWranglerEnv}` : ''}`}
                  </pre>
                </div>
              </section>
            </>
          )}

          {/* 2. Autorização & Autenticação */}
          {activeTab === 'auth' && (
            <>
              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <KeyRound className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Tokens e Sessão</h2>
                    <InfoTooltip text="Define os parâmetros padrão de assinatura criptográfica, fluxo OAuth 2.0 (PKCE) e prazos de expiração de tokens JWT, sessão e códigos de validação." />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label htmlFor="default-signing-alg" className="block text-xs font-medium text-slate-300">
                        Algorítimo de Assinatura
                      </label>
                      <InfoTooltip text="Algoritmo criptográfico padrão aplicado a novos sistemas para assinar tokens JWT (RS256 com chave assimétrica e JWKS público, ou HS256 com segredo HMAC compartilhado)." />
                    </div>
                    <CompactCombo
                      id="default-signing-alg"
                      value={draft.defaultSigningAlg}
                      options={SIGNING_ALG_OPTIONS}
                      menuAlign="left"
                      menuMinWidthClass="min-w-[230px]"
                      onChange={(val) => setDraft({ ...draft, defaultSigningAlg: val })}
                    />
                  </div>
                  <div className="flex items-center gap-2 h-[34px]">
                    <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.pkceRequired}
                        onChange={(e) => setDraft({ ...draft, pkceRequired: e.target.checked })}
                        className="rounded border-slate-700 bg-[#090D16]"
                      />
                      <span>Exigir PKCE S256 na autorização</span>
                    </label>
                    <InfoTooltip
                      align="right"
                      text="Quando habilitado, exige o envio de code_challenge com método S256 (SHA-256) nas chamadas de autorização e validação do code_verifier na troca pelo token, protegendo contra interceptação do código."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800/80">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label htmlFor="default-jwt-ttl" className="block text-xs font-medium text-slate-300">
                        Expiração do Token
                      </label>
                      <InfoTooltip text="Tempo de vida padrão (em segundos, de 60 a 86400) antes de o token JWT expirar e exigir nova autenticação ou renovação." />
                    </div>
                    <input
                      id="default-jwt-ttl"
                      type="number"
                      min={60}
                      max={86400}
                      required
                      value={draft.defaultJwtTtlSeconds}
                      onChange={(e) => setDraft({ ...draft, defaultJwtTtlSeconds: Number(e.target.value) })}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label htmlFor="session-warning-seconds" className="block text-xs font-medium text-slate-300">
                        Expiração da Sessão
                      </label>
                      <InfoTooltip text="Antecedência (em segundos, de 30 a 1800) antes do vencimento do token em que o sistema exibe o aviso de expiração iminente da sessão ao usuário." />
                    </div>
                    <input
                      id="session-warning-seconds"
                      type="number"
                      min={30}
                      max={1800}
                      required
                      value={draft.sessionWarningSeconds}
                      onChange={(e) => setDraft({ ...draft, sessionWarningSeconds: Number(e.target.value) })}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label htmlFor="oauth-code-ttl" className="block text-xs font-medium text-slate-300">
                        Expiração de Validação
                      </label>
                      <InfoTooltip
                        align="right"
                        text="Prazo de validade (em segundos, de 60 a 1800) para códigos de autorização OAuth 2.0, desafios temporários de segundo fator (2FA) e códigos SMS OTP."
                      />
                    </div>
                    <input
                      id="oauth-code-ttl"
                      type="number"
                      min={60}
                      max={1800}
                      required
                      value={draft.oauthCodeTtlSeconds}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setDraft({ ...draft, oauthCodeTtlSeconds: val, smsOtpTtlSeconds: val });
                      }}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                    />
                  </div>
                </div>
              </section>

              <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Lock className="w-4 h-4 text-[#F6821F]" />
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Segurança, Autenticação e Segundo Fator (2FA)</h2>
                    <InfoTooltip text="Define políticas globais de senha e proteção contra força bruta, regras de segundo fator (2FA/SMS OTP), provisionamento JIT e auto-registro." />
                  </div>
                </div>

                <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white">Política de Autenticação</span>
                    <InfoTooltip text="Regras aplicadas às credenciais de acesso para exigir tamanho mínimo de senha e limitar tentativas falhas consecutivas." />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <label htmlFor="global-password-min-length" className="block text-xs font-medium text-slate-300">
                          Tamanho de Senha
                        </label>
                        <InfoTooltip text="Quantidade mínima de caracteres (de 6 a 64) exigida na criação ou redefinição de senhas de usuários na plataforma." />
                      </div>
                      <input
                        id="global-password-min-length"
                        type="number"
                        min={6}
                        max={64}
                        required
                        value={draft.globalPasswordMinLength}
                        onChange={(e) => setDraft({ ...draft, globalPasswordMinLength: Number(e.target.value) })}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <label htmlFor="max-login-attempts" className="block text-xs font-medium text-slate-300">
                          Máximo de Falhas
                        </label>
                        <InfoTooltip
                          align="right"
                          text="Número máximo de tentativas de login inválidas (de 3 a 50) em uma janela de 5 minutos antes do bloqueio temporário por proteção contra força bruta."
                        />
                      </div>
                      <input
                        id="max-login-attempts"
                        type="number"
                        min={3}
                        max={50}
                        required
                        value={draft.maxLoginAttempts}
                        onChange={(e) => setDraft({ ...draft, maxLoginAttempts: Number(e.target.value) })}
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white">Segundo Fator (2FA) e SMS OTP</span>
                      <InfoTooltip text="Controla a exigência global de autenticação em dois fatores nos sistemas e o retorno em sandbox do código SMS OTP." />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.globalRequireMfa}
                            onChange={(e) => setDraft({ ...draft, globalRequireMfa: e.target.checked })}
                            className="rounded border-slate-700 bg-[#090D16]"
                          />
                          <span>Exigir 2FA em todos os sistemas</span>
                        </label>
                        <InfoTooltip text="Quando ativado, impõe a autenticação em dois fatores (TOTP ou SMS) em todos os sistemas da plataforma, mesmo naqueles em que o 2FA esteja marcado como opcional." />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.smsSandboxPreview}
                            onChange={(e) => setDraft({ ...draft, smsSandboxPreview: e.target.checked })}
                            className="rounded border-slate-700 bg-[#090D16]"
                          />
                          <span>Simular o código SMS OTP</span>
                        </label>
                        <InfoTooltip text="Inclui o código SMS OTP gerado diretamente na resposta JSON da API para facilitar testes e homologação quando não houver envio real de SMS." />
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white">Provisionamento de Usuários</span>
                      <InfoTooltip
                        align="right"
                        text="Define como novos usuários podem ingressar na plataforma via provedores de identidade externos (JIT) ou auto-registro pela API."
                      />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.jitProvisioningEnabled}
                            onChange={(e) => setDraft({ ...draft, jitProvisioningEnabled: e.target.checked })}
                            className="rounded border-slate-700 bg-[#090D16]"
                          />
                          <span>Provisionamento para provedores externos</span>
                        </label>
                        <InfoTooltip
                          align="right"
                          text="Cria ou atualiza automaticamente o usuário e seus vínculos no primeiro acesso via provedor de identidade externo (OAuth/OIDC/SAML)."
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.allowSelfRegistration}
                            onChange={(e) => setDraft({ ...draft, allowSelfRegistration: e.target.checked })}
                            className="rounded border-slate-700 bg-[#090D16]"
                          />
                          <span>Permitir auto-registro de usuários</span>
                        </label>
                        <InfoTooltip
                          align="right"
                          text="Habilita o cadastro autônomo de novas contas através do endpoint público /api/auth/register; mantenha desativado para restringir a criação de usuários a administradores."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* 4. Edge Cache, SQLite WAL & Auditoria */}
          {activeTab === 'edge' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Database className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Edge Cache, SQLite WAL e Auditoria</h2>
                  <InfoTooltip text="Controle de cache distribuído, escrita em lote no SQLite WAL, mascaramento de PII e stream SSE." />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    TTL Padrão do Edge Cache (seg)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    required
                    value={draft.defaultEdgeCacheTtl}
                    onChange={(e) => setDraft({ ...draft, defaultEdgeCacheTtl: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tamanho do Lote de Flush (Audit Logs)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={draft.auditFlushBatchSize}
                    onChange={(e) => setDraft({ ...draft, auditFlushBatchSize: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Retenção da Trilha de Auditoria (dias)
                  </label>
                  <input
                    type="number"
                    min={7}
                    max={3650}
                    required
                    value={draft.auditRetentionDays}
                    onChange={(e) => setDraft({ ...draft, auditRetentionDays: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.edgeCacheEnabled}
                    onChange={(e) => setDraft({ ...draft, edgeCacheEnabled: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Edge Cache distribuído habilitado</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.piiMaskingEnabled}
                    onChange={(e) => setDraft({ ...draft, piiMaskingEnabled: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Mascaramento de PII (e-mail/IP) em logs</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.telemetryStreamEnabled}
                    onChange={(e) => setDraft({ ...draft, telemetryStreamEnabled: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Broadcast SSE em tempo real ativo</span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-2.5 min-w-0">
                  {draft.healthAlertSoundEnabled ? (
                    <Volume2 className="w-4 h-4 text-[#F6821F] mt-0.5 shrink-0" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">
                      Notificação sonora de Saúde do Sistema
                    </span>
                    <InfoTooltip text="Emite um alerta sonoro quando o status mudar para degraded (Atenção) ou critical (Latência Crítica)." />
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void playHealthAlertSound('degraded')}
                    disabled={!draft.healthAlertSoundEnabled}
                    className="px-2.5 py-1 text-[11px] font-medium bg-[#090D16] hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-slate-200 rounded-md transition-colors"
                  >
                    Testar som
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.healthAlertSoundEnabled}
                    aria-label="Habilitar notificações sonoras quando a saúde do sistema ficar degradada ou crítica"
                    onClick={() =>
                      setDraft({ ...draft, healthAlertSoundEnabled: !draft.healthAlertSoundEnabled })
                    }
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                      draft.healthAlertSoundEnabled
                        ? 'bg-[#F6821F] border-[#F6821F]'
                        : 'bg-[#090D16] border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        draft.healthAlertSoundEnabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 5. Conformidade LGPD & Privacidade */}
          {activeTab === 'compliance' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <ShieldCheck className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Conformidade LGPD e Privacidade do Titular</h2>
                  <InfoTooltip text="Políticas padrão de privacidade, consentimento explícito, portabilidade JSON e direito ao esquecimento." />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Versão Padrão da Política de Privacidade
                  </label>
                  <input
                    type="text"
                    required
                    value={draft.defaultPrivacyPolicyVersion}
                    onChange={(e) => setDraft({ ...draft, defaultPrivacyPolicyVersion: e.target.value })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.requireExplicitConsent}
                    onChange={(e) => setDraft({ ...draft, requireExplicitConsent: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Exigir consentimento explícito por sistema</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowDataPortabilityExport}
                    onChange={(e) => setDraft({ ...draft, allowDataPortabilityExport: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Permitir exportação JSON pelo titular</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowSelfErasure}
                    onChange={(e) => setDraft({ ...draft, allowSelfErasure: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Permitir anonimização pelo próprio titular</span>
                </label>
              </div>
            </section>
          )}
        </form>
      )}

      {/* Confirmation Popup: Switching to Produção */}
      {confirmProdModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#111827] border border-amber-600/60 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h3 className="font-display text-base font-semibold text-white">Ativar Ambiente de Produção</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmProdModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Ao definir o ambiente de execução como <strong className="text-white">Produção</strong>, o painel{' '}
              <strong className="text-white">Contas de Demonstração</strong> será removido da tela de login e nenhuma
              credencial de teste será preenchida automaticamente.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmProdModal(false)}
                className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void executeSave()}
                className="px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
              >
                {saving ? 'Aplicando...' : 'Confirmar Produção'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Popup: Reset Defaults */}
      {confirmResetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display text-base font-semibold text-white">Restaurar Parâmetros Padrão</h3>
              <button
                type="button"
                onClick={() => setConfirmResetModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Todos os parâmetros globais serão revertidos para os valores iniciais recomendados, incluindo o ambiente de
              execução padrão <strong className="text-white">Desenvolvimento</strong>. Deseja continuar?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmResetModal(false)}
                className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmReset()}
                className="px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
              >
                {saving ? 'Restaurando...' : 'Restaurar Padrões'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
