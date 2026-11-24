/**
 * File: ProfileAndCompliance.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Área do titular para gestão de perfil, senha, 2FA (TOTP/SMS) e conformidade LGPD/GDPR.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  KeyRound,
  Download,
  Lock,
  LogOut,
  FileCheck2,
  AlertTriangle,
  Edit3,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { ComplianceSummary, IamSystem, IamUser } from '../types/Identity';

interface ProfileAndComplianceProps {
  token: string;
  mode: 'profile' | 'compliance';
  onNotify: (msg: string) => void;
  onSessionInvalidated: () => void;
}

const PROFILE_QUERY = `
  query CentralizedProfileAndLgpd {
    me {
      id
      email
      displayName
      phoneNumber
      phoneVerified
      mfaPreferredMethod
      totpEnabled
      status
      permVersion
      lastLoginAt
      bindings {
        id
        systemId
        systemName
        systemSlug
        roleName
        permissions
      }
      sessions {
        id
        systemName
        jti
        authMethod
        ipMasked
        userAgent
        expiresAt
        revokedAt
        createdAt
      }
      consents {
        id
        systemId
        systemName
        policyVersion
        purposes
        granted
        updatedAt
      }
      externalIdentities {
        id
        providerType
        externalEmail
        linkedAt
      }
    }
    systems {
      id
      name
      slug
      privacyPolicyVersion
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
  }
`;

export const ProfileAndCompliance: React.FC<ProfileAndComplianceProps> = ({
  token,
  mode,
  onNotify,
  onSessionInvalidated,
}) => {
  const [me, setMe] = useState<IamUser | null>(null);
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);

  // Modal Popups Visibility
  const [editProfileModal, setEditProfileModal] = useState(false);
  const [changePasswordModal, setChangePasswordModal] = useState(false);
  const [totpModal, setTotpModal] = useState(false);
  const [smsModal, setSmsModal] = useState(false);
  const [mfaPrefModal, setMfaPrefModal] = useState(false);

  // Profile & Password Form
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // TOTP Setup
  const [totpSetup, setTotpSetup] = useState<{
    secretBase32: string;
    otpauthUri: string;
    qrSvg: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // SMS Setup
  const [smsPhoneInput, setSmsPhoneInput] = useState('');
  const [smsSentPreview, setSmsSentPreview] = useState<string | null>(null);
  const [smsCodeInput, setSmsCodeInput] = useState('');

  // MFA Preference
  const [preferredMethodDraft, setPreferredMethodDraft] = useState('none');

  // Anonymize Confirmation
  const [confirmAnonModal, setConfirmAnonModal] = useState(false);

  const loadProfile = async () => {
    try {
      const { data } = await gqlRequest<{
        me: IamUser;
        systems: IamSystem[];
        complianceSummary: ComplianceSummary;
      }>({
        token,
        query: PROFILE_QUERY,
        operationName: 'CentralizedProfileAndLgpd',
        bypassCache: true,
      });
      setMe(data.me);
      setSystems(data.systems);
      setCompliance(data.complianceSummary);
      if (data.me) {
        setDisplayName(data.me.displayName);
        setPhoneNumber(data.me.phoneNumber || '');
        setSmsPhoneInput(data.me.phoneNumber || '+55 11 99999-0000');
        setPreferredMethodDraft(data.me.mfaPreferredMethod);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar perfil.');
    }
  };

  useEffect(() => {
    void loadProfile();
  }, [token]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await gqlRequest({
        token,
        operationName: 'UpdateProfile',
        query: `
          mutation UpdateProfile($displayName: String!, $phoneNumber: String) {
            updateProfile(displayName: $displayName, phoneNumber: $phoneNumber) { id displayName }
          }
        `,
        variables: { displayName, phoneNumber: phoneNumber || null },
      });
      setEditProfileModal(false);
      onNotify('Dados do perfil atualizados via GraphQL.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar perfil.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await gqlRequest<{ changePassword: { message: string } }>({
        token,
        operationName: 'ChangePassword',
        query: `
          mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
            changePassword(currentPassword: $currentPassword, newPassword: $newPassword) { success message }
          }
        `,
        variables: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setChangePasswordModal(false);
      onNotify(data.changePassword.message);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao alterar senha.');
    }
  };

  const handleStartTotp = async () => {
    try {
      const { data } = await gqlRequest<{
        setupTotp: { secretBase32: string; otpauthUri: string; qrSvg: string };
      }>({
        token,
        operationName: 'SetupTotp',
        query: `mutation SetupTotp { setupTotp { secretBase32 otpauthUri qrSvg } }`,
      });
      setTotpSetup(data.setupTotp);
      setBackupCodes(null);
      setTotpCode('');
      setTotpModal(true);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao iniciar TOTP.');
    }
  };

  const handleVerifyEnableTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await gqlRequest<{
        verifyAndEnableTotp: { enabled: boolean; backupCodes: string[] };
      }>({
        token,
        operationName: 'VerifyEnableTotp',
        query: `
          mutation VerifyEnableTotp($code: String!) {
            verifyAndEnableTotp(code: $code) { enabled backupCodes }
          }
        `,
        variables: { code: totpCode },
      });
      setTotpSetup(null);
      setTotpCode('');
      setBackupCodes(data.verifyAndEnableTotp.backupCodes);
      onNotify('Autenticador TOTP ativado! Salve seus códigos de backup.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Código TOTP inválido.');
    }
  };

  const handleDisableTotp = async () => {
    try {
      await gqlRequest({
        token,
        operationName: 'DisableTotp',
        query: `mutation DisableTotp { disableTotp { success message } }`,
      });
      setBackupCodes(null);
      onNotify('TOTP desativado.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao desativar TOTP.');
    }
  };

  const handleRequestSmsOtp = async () => {
    try {
      const { data } = await gqlRequest<{
        requestSmsSetup: { sent: boolean; maskedPhone: string; sandboxCodePreview: string };
      }>({
        token,
        operationName: 'RequestSmsSetup',
        query: `
          mutation RequestSmsSetup($phoneNumber: String!) {
            requestSmsSetup(phoneNumber: $phoneNumber) { sent maskedPhone sandboxCodePreview }
          }
        `,
        variables: { phoneNumber: smsPhoneInput },
      });
      setSmsSentPreview(data.requestSmsSetup.sandboxCodePreview);
      onNotify(`Código SMS enviado para ${data.requestSmsSetup.maskedPhone}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar SMS OTP.');
    }
  };

  const handleVerifySms = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await gqlRequest({
        token,
        operationName: 'VerifyEnableSms',
        query: `
          mutation VerifyEnableSms($phoneNumber: String!, $code: String!) {
            verifyAndEnableSms(phoneNumber: $phoneNumber, code: $code) { success message }
          }
        `,
        variables: { phoneNumber: smsPhoneInput, code: smsCodeInput },
      });
      setSmsSentPreview(null);
      setSmsCodeInput('');
      setSmsModal(false);
      onNotify('Verificação 2FA por SMS ativada com sucesso.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Código SMS inválido.');
    }
  };

  const handleDisableSms = async () => {
    try {
      await gqlRequest({
        token,
        operationName: 'DisableSms',
        query: `mutation DisableSms { disableSms { success message } }`,
      });
      onNotify('2FA por SMS desativado.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao desativar SMS.');
    }
  };

  const handleSetPreferredMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await gqlRequest({
        token,
        operationName: 'SetPrefMfa',
        query: `mutation SetPrefMfa($method: String!) { setPreferredMfaMethod(method: $method) { success message } }`,
        variables: { method: preferredMethodDraft },
      });
      setMfaPrefModal(false);
      onNotify(`Método 2FA preferencial definido para ${preferredMethodDraft.toUpperCase()}.`);
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao alterar preferência.');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await gqlRequest({
        token,
        operationName: 'RevokeSession',
        query: `mutation RevokeSession($sessionId: ID!) { revokeSession(sessionId: $sessionId) { success message } }`,
        variables: { sessionId },
      });
      onNotify('Sessão revogada instantaneamente na borda.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao revogar sessão.');
    }
  };

  const handleToggleConsent = async (systemId: string, granted: boolean) => {
    try {
      await gqlRequest({
        token,
        operationName: 'RecordConsent',
        query: `
          mutation RecordConsent($systemId: ID!, $granted: Boolean!, $purposes: [String!]) {
            recordConsent(systemId: $systemId, granted: $granted, purposes: $purposes) { success message }
          }
        `,
        variables: { systemId, granted, purposes: ['authentication', 'security_audit', 'rbac_claims'] },
      });
      onNotify(granted ? 'Consentimento LGPD/GDPR registrado.' : 'Consentimento revogado.');
      await loadProfile();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar consentimento.');
    }
  };

  const handleExportSarJson = async () => {
    try {
      const { data } = await gqlRequest<{ exportMyDataJson: string }>({
        token,
        operationName: 'ExportSar',
        query: `query ExportSar { exportMyDataJson }`,
      });
      const blob = new Blob([data.exportMyDataJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `isg-portabilidade-lgpd-${me?.id || 'titular'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Pacote JSON de portabilidade LGPD/GDPR exportado.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro na exportação LGPD.');
    }
  };

  const handleAnonymizeSelf = async () => {
    if (!me) return;
    try {
      await gqlRequest({
        token,
        operationName: 'AnonymizeSelf',
        query: `mutation AnonymizeSelf($userId: ID!) { anonymizeUserAccount(userId: $userId) { success message } }`,
        variables: { userId: me.id },
      });
      setConfirmAnonModal(false);
      onNotify('Conta anonimizada conforme LGPD/GDPR. Encerrando sessão...');
      onSessionInvalidated();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao anonimizar conta.');
    }
  };

  if (!me) {
    return <div className="py-10 text-center text-xs text-slate-500">Carregando perfil centralizado...</div>;
  }

  return (
    <div className="space-y-6">
      {mode === 'profile' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-white">Perfil do Usuário</h1>
              <InfoTooltip text="Visualize suas credenciais, vínculos multi-sistema e sessões ativas; use os popups de configuração para alterar dados, senha ou 2FA." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDisplayName(me.displayName);
                  setPhoneNumber(me.phoneNumber || '');
                  setEditProfileModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#111827] border border-slate-700 hover:border-slate-500 text-white rounded-md"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Perfil</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setChangePasswordModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Alterar Senha</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Read-Only Identity Summary + System Bindings */}
            <div className="lg:col-span-5 space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h2 className="text-sm font-semibold text-white">Identidade Centralizada</h2>
                  <span className="text-[11px] font-mono text-slate-400">perm v{me.permVersion}</span>
                </div>
                <dl className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-400">Nome de exibição</dt>
                    <dd className="font-medium text-white text-right">{me.displayName}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-400">E-mail principal</dt>
                    <dd className="font-mono text-slate-200 text-right">{me.email}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-400">Telefone</dt>
                    <dd className="font-mono text-slate-200 text-right">{me.phoneNumber || 'Não informado'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-400">Status</dt>
                    <dd className="font-mono text-emerald-400 text-right">
                      {me.status === 'active' ? 'Ativo' : me.status === 'locked' ? 'Bloqueado' : me.status}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white">Sistemas Vinculados e Roles</h2>
                <div className="space-y-2">
                  {(me.bindings || []).map((b) => (
                    <div
                      key={b.id}
                      className="px-3 py-2.5 bg-[#090D16] border border-slate-800 rounded text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white">{b.systemName}</span>
                        <span className="font-mono text-[#F6821F]">{b.roleName}</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {b.permissions.join(' · ') || 'sem permissões adicionais'}
                      </div>
                    </div>
                  ))}
                  {(!me.bindings || me.bindings.length === 0) && (
                    <div className="text-xs text-slate-500 py-2">Nenhum sistema vinculado.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: 2FA Status Summary + Active Sessions */}
            <div className="lg:col-span-7 space-y-5">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#F6821F]" />
                    <h2 className="text-sm font-semibold text-white">Autenticação de Dois Fatores (2FA)</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPreferredMethodDraft(me.mfaPreferredMethod);
                      setMfaPrefModal(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#090D16] border border-slate-700 hover:border-slate-500 text-slate-200 rounded"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    <span>Preferencial: {me.mfaPreferredMethod.toUpperCase()}</span>
                  </button>
                </div>

                {/* TOTP Status Row */}
                <div className="p-4 rounded-md bg-[#090D16] border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4 text-slate-300" />
                    <div>
                      <div className="text-xs font-semibold text-white">App Autenticador (TOTP RFC 6238)</div>
                      <div className="text-[11px] text-slate-400">
                        Status: {me.totpEnabled ? 'Ativo · Google Authenticator / Authy' : 'Não configurado'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {me.totpEnabled ? (
                      <>
                        <button
                          type="button"
                          onClick={handleStartTotp}
                          className="px-3 py-1.5 text-xs border border-slate-700 hover:border-slate-500 text-slate-200 rounded"
                        >
                          Reconfigurar QR
                        </button>
                        <button
                          type="button"
                          onClick={handleDisableTotp}
                          className="px-3 py-1.5 text-xs border border-red-800/70 text-red-300 hover:bg-red-950/40 rounded"
                        >
                          Desativar TOTP
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartTotp}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded"
                      >
                        Configurar QR Code
                      </button>
                    )}
                  </div>
                </div>

                {/* SMS OTP Status Row */}
                <div className="p-4 rounded-md bg-[#090D16] border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="w-4 h-4 text-slate-300" />
                    <div>
                      <div className="text-xs font-semibold text-white">Verificação por SMS OTP</div>
                      <div className="text-[11px] text-slate-400">
                        Status: {me.phoneVerified ? `Verificado (${me.phoneNumber})` : 'Não verificado'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSmsPhoneInput(me.phoneNumber || '+55 11 99999-0000');
                        setSmsSentPreview(null);
                        setSmsCodeInput('');
                        setSmsModal(true);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded"
                    >
                      {me.phoneVerified ? 'Alterar Telefone SMS' : 'Configurar SMS'}
                    </button>
                    {me.phoneVerified && (
                      <button
                        type="button"
                        onClick={handleDisableSms}
                        className="px-3 py-1.5 text-xs border border-red-800/70 text-red-300 hover:bg-red-950/40 rounded"
                      >
                        Remover SMS
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Active Sessions */}
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3">
                <h2 className="text-sm font-semibold text-white">Sessões JWT Ativas e Histórico Recente</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(me.sessions || []).map((ses) => (
                    <div
                      key={ses.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[#090D16] border border-slate-800 rounded text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">
                          {ses.systemName} · <span className="font-mono text-slate-400">{ses.authMethod}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          IP {ses.ipMasked} · JTI {ses.jti.slice(0, 14)} ·{' '}
                          {ses.revokedAt ? 'Revogada' : `Expira ${new Date(ses.expiresAt).toLocaleTimeString('pt-BR')}`}
                        </div>
                      </div>
                      {!ses.revokedAt && (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(ses.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-700 hover:border-red-500 text-slate-300 hover:text-red-300 rounded shrink-0"
                        >
                          <LogOut className="w-3 h-3" />
                          <span>Revogar</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Modal: Edit Profile */}
          {editProfileModal && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="font-display text-base font-semibold text-white">Editar Perfil Centralizado</h3>
                  <button
                    type="button"
                    onClick={() => setEditProfileModal(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">E-mail</label>
                    <input
                      type="text"
                      disabled
                      value={me.email}
                      className="w-full bg-[#090D16] border border-slate-800 rounded px-3 py-2 text-xs font-mono text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Nome de exibição</label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+55 11 99999-0000"
                      className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-sm font-mono text-white"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditProfileModal(false)}
                      className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                    >
                      Salvar Perfil
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal: Change Password */}
          {changePasswordModal && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#F6821F]" />
                    <h3 className="font-display text-base font-semibold text-white">Alterar Senha</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChangePasswordModal(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Senha atual</label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Nova senha (mín. 8 caracteres)</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setChangePasswordModal(false)}
                      className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                    >
                      Atualizar Senha
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal: TOTP QR Code & Backup Codes */}
          {totpModal && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <div className="max-w-lg w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#F6821F]" />
                    <h3 className="font-display text-base font-semibold text-white">
                      Configurar App Autenticador (TOTP RFC 6238)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTotpModal(false);
                      setTotpSetup(null);
                      setBackupCodes(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {totpSetup && !backupCodes && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                      <div
                        className="sm:col-span-5 bg-slate-900 border border-slate-700 rounded p-2 flex items-center justify-center"
                        dangerouslySetInnerHTML={{ __html: totpSetup.qrSvg }}
                      />
                      <div className="sm:col-span-7 space-y-2 text-xs">
                        <p className="text-slate-300 leading-relaxed">
                          Escaneie o QR Code no Google Authenticator, Authy ou 1Password e informe o código de 6 dígitos gerado.
                        </p>
                        <div className="text-[11px] font-mono text-slate-400 break-all bg-[#090D16] p-2 rounded border border-slate-800">
                          Chave Base32: <span className="text-slate-200">{totpSetup.secretBase32}</span>
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleVerifyEnableTotp} className="space-y-3 pt-2 border-t border-slate-800">
                      <label className="block text-xs text-slate-300">Código TOTP de confirmação</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="000000"
                          className="flex-1 bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-sm font-mono tabular-nums text-white"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                        >
                          Validar e Ativar
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {backupCodes && (
                  <div className="space-y-4">
                    <div className="text-xs font-semibold text-amber-400">
                      TOTP ativado com sucesso. Guarde seus 8 códigos de backup descartáveis em local seguro:
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs text-slate-200">
                      {backupCodes.map((c) => (
                        <div key={c} className="px-2.5 py-2 bg-[#090D16] border border-slate-700 rounded text-center">
                          {c}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTotpModal(false);
                          setBackupCodes(null);
                        }}
                        className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                      >
                        Concluir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Modal: SMS OTP Setup */}
          {smsModal && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-[#F6821F]" />
                    <h3 className="font-display text-base font-semibold text-white">Configurar Verificação por SMS OTP</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSmsModal(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Número de Telefone (E.164)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={smsPhoneInput}
                        onChange={(e) => setSmsPhoneInput(e.target.value)}
                        placeholder="+55 11 99999-0000"
                        className="flex-1 bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
                      />
                      <button
                        type="button"
                        onClick={handleRequestSmsOtp}
                        className="px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded"
                      >
                        Enviar SMS
                      </button>
                    </div>
                  </div>

                  {smsSentPreview && (
                    <form onSubmit={handleVerifySms} className="space-y-3 pt-3 border-t border-slate-800">
                      <div className="text-[11px] font-mono text-emerald-400 bg-[#090D16] p-2.5 rounded border border-slate-800">
                        Preview Sandbox SMS OTP: {smsSentPreview}
                      </div>
                      <div>
                        <label className="block text-xs text-slate-300 mb-1">Código de 6 dígitos recebido</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            required
                            value={smsCodeInput}
                            onChange={(e) => setSmsCodeInput(e.target.value)}
                            placeholder="000000"
                            className="flex-1 bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded"
                          >
                            Confirmar SMS
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Modal: Preferred 2FA Method */}
          {mfaPrefModal && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <div className="max-w-sm w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="font-display text-base font-semibold text-white">Método 2FA Preferencial</h3>
                  <button
                    type="button"
                    onClick={() => setMfaPrefModal(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form onSubmit={handleSetPreferredMfa} className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Método padrão no login</label>
                    <select
                      value={preferredMethodDraft}
                      onChange={(e) => setPreferredMethodDraft(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
                    >
                      <option value="none">Nenhum</option>
                      {me.totpEnabled && <option value="totp">TOTP (App Autenticador)</option>}
                      {me.phoneVerified && <option value="sms">SMS OTP</option>}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setMfaPrefModal(false)}
                      className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                    >
                      Salvar Preferência
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      ) : (
        /* LGPD & GDPR Compliance Center */
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-white">Conformidade LGPD e GDPR</h1>
              <InfoTooltip text="Governança de consentimentos versionados, portabilidade de dados pessoais (SAR), mascaramento de PII e direito ao esquecimento." />
            </div>
            <button
              type="button"
              onClick={handleExportSarJson}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar Meus Dados (JSON)</span>
            </button>
          </div>

          {compliance && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4">
                <div className="text-xs text-slate-400">Consentimentos Ativos</div>
                <div className="font-mono tabular-nums text-2xl font-semibold text-white mt-1">
                  {compliance.activeConsents}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  {compliance.revokedConsents} revogados
                </div>
              </div>
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4">
                <div className="text-xs text-slate-400">Adoção de 2FA</div>
                <div className="font-mono tabular-nums text-2xl font-semibold text-white mt-1">
                  {compliance.mfaAdoptedUsers} / {compliance.totalUsers}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  {compliance.totpUsers} TOTP · {compliance.smsUsers} SMS
                </div>
              </div>
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4">
                <div className="text-xs text-slate-400">Logs com PII Mascarado</div>
                <div className="font-mono tabular-nums text-2xl font-semibold text-white mt-1">
                  {compliance.piiMaskedLogsCount}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">E-mail, IP e subject_hash</div>
              </div>
              <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4">
                <div className="text-xs text-slate-400">Contas Anonimizadas</div>
                <div className="font-mono tabular-nums text-2xl font-semibold text-white mt-1">
                  {compliance.anonymizedUsers}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">Art. 18 LGPD / Art. 17 GDPR</div>
              </div>
            </div>
          )}

          {/* Consent Management per System */}
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <FileCheck2 className="w-4 h-4 text-[#F6821F]" />
              <h2 className="text-sm font-semibold text-white">Matriz de Consentimento por Sistema (Titular Atual)</h2>
            </div>
            <div className="space-y-2.5">
              {systems.map((sys) => {
                const rec = (me.consents || []).find((c) => c.systemId === sys.id);
                const isGranted = rec ? rec.granted : false;
                return (
                  <div
                    key={sys.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-[#090D16] border border-slate-800 rounded-md"
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">{sys.name}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        Política v{sys.privacyPolicyVersion} · Finalidades: autenticação, auditoria de segurança, claims RBAC
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-mono ${isGranted ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {isGranted ? 'Consentido' : 'Não consentido'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleToggleConsent(sys.id, !isGranted)}
                        className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded"
                      >
                        {isGranted ? 'Revogar' : 'Conceder'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right to Erasure / Anonymization */}
          <div className="bg-[#111827] border border-red-900/50 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">Direito ao Esquecimento e Anonimização (LGPD / GDPR)</h3>
                <InfoTooltip text="Remove irreversivelmente nome, e-mail, telefone, segredos 2FA e vínculos externos, revogando todas as sessões e preservando apenas os hashes pseudonimizados de auditoria legal." />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmAnonModal(true)}
              className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-md whitespace-nowrap"
            >
              Solicitar Anonimização
            </button>
          </div>

          {confirmAnonModal && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
              <div className="max-w-md w-full bg-[#111827] border border-red-800/80 rounded-lg p-6 space-y-4">
                <h3 className="font-display text-base font-semibold text-white">Confirmar Anonimização Irreversível</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Seus dados pessoais serão substituídos de forma permanente e sua sessão atual será encerrada imediatamente. Deseja prosseguir?
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmAnonModal(false)}
                    className="px-4 py-2 text-xs border border-slate-700 text-slate-300 rounded-md"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAnonymizeSelf}
                    className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-md"
                  >
                    Confirmar Anonimização
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
