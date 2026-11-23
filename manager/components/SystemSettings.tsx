import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Database,
  KeyRound,
  Layers,
  Lock,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { playHealthAlertSound } from '../lib/healthAlertAudio';
import { DetailedErrorLog } from './DetailedErrorLog';
import { InfoTooltip } from './InfoTooltip';
import type { ExecutionEnvironment, PlatformSystemSettings } from '../types/iam';

interface SystemSettingsProps {
  token: string;
  isSuperAdmin: boolean;
  onNotify: (msg: string) => void;
  onSettingsUpdated?: (settings: PlatformSystemSettings) => void;
}

type SettingsTab = 'environment' | 'jwt' | 'security' | 'edge' | 'compliance' | 'errors';

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
    description: 'Exibe o painel Contas de Demonstração na tela de login e facilita testes locais.',
  },
  {
    value: 'Homologação',
    description: 'Ambiente de pré-produção e QA mantendo Contas de Demonstração acessíveis.',
  },
  {
    value: 'Produção',
    description: 'Oculta o painel Contas de Demonstração na tela de login e bloqueia atalhos de teste.',
  },
];

const TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'environment', label: 'Ambiente & Geral', icon: Server },
  { id: 'jwt', label: 'JWT & OAuth 2.0', icon: KeyRound },
  { id: 'security', label: 'Segurança & 2FA', icon: Lock },
  { id: 'edge', label: 'Edge Cache & Auditoria', icon: Database },
  { id: 'compliance', label: 'LGPD & Privacidade', icon: ShieldCheck },
  { id: 'errors', label: 'Log de Erros Detalhado', icon: Bug },
];

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
            smsOtpTtlSeconds: Number(draft.smsOtpTtlSeconds),
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
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-200 hover:text-white bg-[#111827] border border-slate-700/80 rounded-md whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar Padrões</span>
          </button>
          <button
            type="submit"
            form="system-settings-form"
            disabled={loading || saving || !draft}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] disabled:opacity-50 text-slate-950 rounded-md whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Salvando...' : 'Salvar Configurações'}</span>
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
          {/* 1. Ambiente de Execução & Plataforma */}
          {activeTab === 'environment' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Server className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Ambiente de Execução e Identidade da Plataforma</h2>
                  <InfoTooltip text="Define o comportamento da tela de autenticação, exposição de contas de demonstração e emissor OIDC." />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">Ambiente de Execução</label>
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
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
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Emissor JWT (iss)</label>
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
                    URL Base da Aplicação (Callbacks OAuth)
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
          )}

          {/* 1b. Prefixos e Normalização de Identificadores de Sistemas */}
          {activeTab === 'environment' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Layers className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Prefixos e Normalização de Sistemas</h2>
                  <InfoTooltip text="Define os prefixos padrão para o ID do sistema e do cliente, se os valores devem ser normalizados e o caracter separador (- ou _)." />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-white">ID do Sistema</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Prefixo do ID do Sistema
                      </label>
                      <input
                        type="text"
                        required
                        value={draft.systemIdPrefix}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            systemIdPrefix: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="sys"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Caracter de Normalização
                      </label>
                      <select
                        value={draft.systemIdSeparator}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            systemIdSeparator: e.target.value === '-' ? '-' : '_',
                          })
                        }
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      >
                        <option value="_">_ (underscore)</option>
                        <option value="-">- (hífen)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-[#090D16]/60 border border-slate-800/80 rounded-md p-4 space-y-3">
                  <div className="text-xs font-semibold text-white">Cliente</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Prefixo do Cliente
                      </label>
                      <input
                        type="text"
                        required
                        value={draft.clientIdPrefix}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            clientIdPrefix: e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''),
                          })
                        }
                        placeholder="cli"
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Caracter de Normalização
                      </label>
                      <select
                        value={draft.clientIdSeparator}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            clientIdSeparator: e.target.value === '-' ? '-' : '_',
                          })
                        }
                        className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                      >
                        <option value="_">_ (underscore)</option>
                        <option value="-">- (hífen)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.normalizeIdentifiers}
                    onChange={(e) => setDraft({ ...draft, normalizeIdentifiers: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>
                    Normalizar valores (substituir caracteres inválidos e separadores pelo caracter de cada campo)
                  </span>
                </label>
                <div className="text-[11px] font-mono text-slate-400">
                  Exemplo:{' '}
                  <span className="text-slate-200">
                    {(draft.systemIdPrefix || 'sys').replace(/[-_]+$/g, '')}
                    {draft.systemIdSeparator}
                    {draft.normalizeIdentifiers
                      ? `portal${draft.systemIdSeparator}parceiros`
                      : 'portal-parceiros'}
                  </span>{' '}
                  ·{' '}
                  <span className="text-slate-200">
                    {(draft.clientIdPrefix || 'cli').replace(/[-_]+$/g, '')}
                    {draft.clientIdSeparator}
                    {draft.normalizeIdentifiers
                      ? `portal${draft.clientIdSeparator}parceiros`
                      : 'portal-parceiros'}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* 2. Tokens JWT & OAuth 2.0 */}
          {activeTab === 'jwt' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <KeyRound className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Tokens JWT, Sessão e OAuth 2.0</h2>
                  <InfoTooltip text="Valores padrão aplicados a novos sistemas e janelas temporais de autorização na borda." />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    TTL Padrão do JWT (segundos)
                  </label>
                  <input
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
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Algoritmo JWT Padrão</label>
                  <select
                    value={draft.defaultSigningAlg}
                    onChange={(e) => setDraft({ ...draft, defaultSigningAlg: e.target.value as 'RS256' | 'HS256' })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                  >
                    <option value="RS256">RS256 (Assimétrico + JWKS)</option>
                    <option value="HS256">HS256 (HMAC Compartilhado)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Alerta Expiração Sessão (seg)
                  </label>
                  <input
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
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Validade Auth Code / 2FA (seg)
                  </label>
                  <input
                    type="number"
                    min={60}
                    max={1800}
                    required
                    value={draft.oauthCodeTtlSeconds}
                    onChange={(e) => setDraft({ ...draft, oauthCodeTtlSeconds: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.pkceRequired}
                    onChange={(e) => setDraft({ ...draft, pkceRequired: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Exigir PKCE S256 obrigatório em todas as chamadas de /api/oauth/authorize</span>
                </label>
              </div>
            </section>
          )}

          {/* 3. Segurança, Autenticação & 2FA */}
          {activeTab === 'security' && (
            <section className="bg-[#111827] border border-slate-800/90 rounded-lg p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Lock className="w-4 h-4 text-[#F6821F]" />
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">Segurança, Autenticação e Segundo Fator (2FA)</h2>
                  <InfoTooltip text="Regras globais de senha, bloqueio contra força bruta, auto-registro, TOTP/SMS e federação JIT." />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Tamanho Mínimo Global de Senha
                  </label>
                  <input
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
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Máximo de Tentativas Falhas (5 min)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={50}
                    required
                    value={draft.maxLoginAttempts}
                    onChange={(e) => setDraft({ ...draft, maxLoginAttempts: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Validade do SMS OTP (seg)</label>
                  <input
                    type="number"
                    min={60}
                    max={900}
                    required
                    value={draft.smsOtpTtlSeconds}
                    onChange={(e) => setDraft({ ...draft, smsOtpTtlSeconds: Number(e.target.value) })}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.globalRequireMfa}
                    onChange={(e) => setDraft({ ...draft, globalRequireMfa: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Exigir 2FA globalmente em todos os sistemas cadastrados</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.jitProvisioningEnabled}
                    onChange={(e) => setDraft({ ...draft, jitProvisioningEnabled: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Habilitar provisionamento JIT automático para provedores externos</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.smsSandboxPreview}
                    onChange={(e) => setDraft({ ...draft, smsSandboxPreview: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Retornar preview sandbox do código SMS OTP na resposta da API</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.allowSelfRegistration}
                    onChange={(e) => setDraft({ ...draft, allowSelfRegistration: e.target.checked })}
                    className="rounded border-slate-700 bg-[#090D16]"
                  />
                  <span>Permitir auto-registro via API /api/auth/register (padrão bloqueado)</span>
                </label>
              </div>
            </section>
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
