/**
 * File: Application.tsx
 * Kind: TypeScript React
 * Container: /manager
 * Summary: Shell principal do console IAM com navegação lateral, barra superior, atalhos, saúde do sistema e sessão.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { LoginGate } from './components/LoginGate';
import { OverviewTelemetry, type OverviewSection } from './components/OverviewTelemetry';
import { AuditLogs } from './components/AuditLogs';
import { SystemsManager } from './components/SystemsManager';
import { UsersManager } from './components/UsersManager';
import { RbacClaimsManager } from './components/RbacClaimsManager';
import { IdpAndOAuthSandbox } from './components/IdpAndOAuthSandbox';
import { GraphqlAndCloudflare } from './components/GraphqlAndCloudflare';
import { ProfileAndCompliance } from './components/ProfileAndCompliance';
import { SystemSettings } from './components/SystemSettings';
import { TokenGate } from './components/TokenGate';
import {
  ASSETS_SUBMENUS,
  DashboardLayout,
  NAV_ITEMS,
  type DashboardToastState,
  type NavTab,
  type ToastVariant,
} from './components/DashboardLayout';
import { subscribeDiagnostics } from './libraries/GraphqlClient';
import { playHealthAlertSound, unlockHealthAlertAudio } from './libraries/HealthAlertAudio';
import { useSessionExpiration } from './hooks/UseSessionExpiration';
import { useSystemHealth, type SystemHealthLevel } from './hooks/UseSystemHealth';
import type { AuthSessionState, DiagnosticHeaders, PublicPlatformConfig } from './domains/Identity';

const SESSION_STORAGE_KEY = 'vektor_iam_session_v1';

function inferToastVariant(message: string): ToastVariant {
  if (/erro|falha|inválid|invalido|não foi possível|sem permissão|bloquead|negad|expirad/i.test(message)) {
    return 'error';
  }
  if (/alerta|aviso|aguardando|desativad|revogad|atenção|anonimizad/i.test(message)) {
    return 'warning';
  }
  return 'success';
}

export default function Application() {
  const [session, setSession] = useState<AuthSessionState | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as AuthSessionState;
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [overviewMenuExpanded, setOverviewMenuExpanded] = useState(true);
  const [assetsMenuExpanded, setAssetsMenuExpanded] = useState(true);
  const [shortcutChordPending, setShortcutChordPending] = useState(false);
  const [toast, setToast] = useState<DashboardToastState | null>(null);
  const [lastDiag, setLastDiag] = useState<DiagnosticHeaders | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [publicConfig, setPublicConfig] = useState<PublicPlatformConfig | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const chordTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fetch('/api/public/config')
      .then((r) => r.json())
      .then((cfg: PublicPlatformConfig) => setPublicConfig(cfg))
      .catch(() => {});
  }, [session?.token]);

  useEffect(() => {
    return subscribeDiagnostics((diag) => {
      setLastDiag(diag);
    });
  }, []);

  const handleLogout = useCallback(() => {
    setSession(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const { formattedRemaining, isExpiringSoon, showWarning, dismissWarning } = useSessionExpiration(
    session?.expiresAt ?? null,
    handleLogout,
    publicConfig?.sessionWarningSeconds ?? 300
  );

  const canReadAuditLogs = Boolean(
    session &&
      (session.user.roles.includes('super_admin') ||
        session.user.permissions.includes('iam:audit:read'))
  );

  const systemHealth = useSystemHealth({
    token: session?.token ?? null,
    canReadAuditLogs,
    telemetryStreamEnabled: publicConfig?.telemetryStreamEnabled ?? true,
    refreshSignal: refreshTick,
  });

  const prevHealthLevelRef = useRef<SystemHealthLevel | null>(null);

  useEffect(() => {
    if (!session) return;
    const handleUnlock = () => unlockHealthAlertAudio();
    window.addEventListener('pointerdown', handleUnlock, { once: true });
    window.addEventListener('keydown', handleUnlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      prevHealthLevelRef.current = null;
      return;
    }
    const prevLevel = prevHealthLevelRef.current;
    const nextLevel = systemHealth.level;
    prevHealthLevelRef.current = nextLevel;

    const soundEnabled = publicConfig?.healthAlertSoundEnabled ?? true;
    if (
      soundEnabled &&
      prevLevel !== null &&
      prevLevel !== nextLevel &&
      (nextLevel === 'critical' || nextLevel === 'degraded')
    ) {
      void playHealthAlertSound(nextLevel);
    }
  }, [session, systemHealth.level, publicConfig?.healthAlertSoundEnabled]);

  const notify = useCallback(
    (msg: string, variant?: ToastVariant) => {
      if (msg === 'UNAUTHENTICATED') {
        handleLogout();
        return;
      }
      const nextToast: DashboardToastState = {
        id: Date.now(),
        message: msg,
        variant: variant ?? inferToastVariant(msg),
      };
      setToast(nextToast);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast((curr) => (curr?.id === nextToast.id ? null : curr));
        toastTimerRef.current = null;
      }, 4500);
    },
    [handleLogout]
  );

  // Global keyboard shortcuts: 'g' followed by tab key (e.g. 'g' -> 'o' for Visão Geral, 'g' -> 's' for Sistemas)
  useEffect(() => {
    if (!session) return;

    const isSuperAdminUser = session.user.roles.includes('super_admin');

    const clearChord = () => {
      setShortcutChordPending(false);
      if (chordTimerRef.current !== null) {
        window.clearTimeout(chordTimerRef.current);
        chordTimerRef.current = null;
      }
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = ev.key.toLowerCase();

      if (key === 'escape') {
        clearChord();
        return;
      }

      if (shortcutChordPending) {
        const hasPerm = (perm?: string) =>
          !perm || isSuperAdminUser || session.user.permissions.includes(perm);
        const matchedNav = NAV_ITEMS.find(
          (item) =>
            item.shortcut === key &&
            (!item.adminOnly || isSuperAdminUser) &&
            hasPerm(item.requiredPermission)
        );
        const matchedAsset = ASSETS_SUBMENUS.find(
          (sub) => sub.shortcut === key && hasPerm(sub.requiredPermission)
        );
        clearChord();
        if (matchedAsset) {
          ev.preventDefault();
          setActiveTab(matchedAsset.id);
          setAssetsMenuExpanded(true);
        } else if (matchedNav) {
          ev.preventDefault();
          if (matchedNav.id === 'assets') {
            setActiveTab('systems');
            setAssetsMenuExpanded(true);
          } else {
            setActiveTab(matchedNav.id);
          }
        }
        return;
      }

      if (key === 'g') {
        ev.preventDefault();
        setShortcutChordPending(true);
        if (chordTimerRef.current !== null) {
          window.clearTimeout(chordTimerRef.current);
        }
        chordTimerRef.current = window.setTimeout(() => {
          setShortcutChordPending(false);
          chordTimerRef.current = null;
        }, 1500);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [session, shortcutChordPending]);

  const handleAuthenticated = (nextSession: AuthSessionState) => {
    setSession(nextSession);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    const hasAdmin =
      nextSession.user.roles.includes('super_admin') ||
      nextSession.user.permissions.includes('iam:users:read') ||
      nextSession.user.permissions.includes('iam:audit:read');
    setActiveTab(hasAdmin ? 'overview' : 'profile');
  };

  const isTokenPortalRoute =
    typeof window !== 'undefined' && /^\/obter-token\/?$/i.test(window.location.pathname);

  if (isTokenPortalRoute) {
    return <TokenGate standalone />;
  }

  if (!session) {
    return <LoginGate onAuthenticated={handleAuthenticated} />;
  }

  const isSuperAdmin = session.user.roles.includes('super_admin');
  const hasPermission = (perm?: string) =>
    !perm || isSuperAdmin || session.user.permissions.includes(perm);
  const canReadUsers = hasPermission('iam:users:read');
  const canWriteUsers = hasPermission('iam:users:write');
  const canWriteSystems = hasPermission('iam:systems:write');
  const canWriteRoles = hasPermission('iam:roles:write');
  const platformName = publicConfig?.platformName || 'Identity Secure Gate';

  const resolvedActiveTab: NavTab = (() => {
    if (activeTab === 'assets') return 'systems';
    if (activeTab === 'users' && !canReadUsers) return 'systems';
    if ((activeTab === 'audit-logs' || activeTab === 'overview-audit' || activeTab === 'overview-alerts') && !canReadAuditLogs) {
      return 'overview';
    }
    if (activeTab === 'settings' && !isSuperAdmin) return 'overview';
    return activeTab;
  })();

  return (
    <>
      <DashboardLayout
        platformName={platformName}
        activeTab={resolvedActiveTab}
        onSelectTab={setActiveTab}
        session={session}
        isSuperAdmin={isSuperAdmin}
        hasPermission={hasPermission}
        systemHealth={systemHealth}
        lastDiag={lastDiag}
        formattedRemaining={formattedRemaining}
        isExpiringSoon={isExpiringSoon}
        shortcutChordPending={shortcutChordPending}
        overviewMenuExpanded={overviewMenuExpanded}
        onToggleOverviewMenu={() => setOverviewMenuExpanded((prev) => !prev)}
        onExpandOverviewMenu={() => setOverviewMenuExpanded(true)}
        assetsMenuExpanded={assetsMenuExpanded}
        onToggleAssetsMenu={() => setAssetsMenuExpanded((prev) => !prev)}
        onExpandAssetsMenu={() => setAssetsMenuExpanded(true)}
        toast={toast}
        onDismissToast={() => setToast(null)}
        onLogout={handleLogout}
      >
        {(resolvedActiveTab === 'overview' || resolvedActiveTab.startsWith('overview-')) && (
            <OverviewTelemetry
              key={refreshTick}
              token={session.token}
              section={resolvedActiveTab as OverviewSection}
              canReadUsers={canReadUsers}
              canReadAuditLogs={canReadAuditLogs}
              onNavigateSection={(sec) => {
                setActiveTab(sec);
                setOverviewMenuExpanded(true);
              }}
              onNotify={notify}
            />
          )}
          {resolvedActiveTab === 'systems' && (
            <SystemsManager
              token={session.token}
              canWriteSystems={canWriteSystems}
              identifierConfig={
                publicConfig
                  ? {
                      systemIdPrefix: publicConfig.systemIdPrefix,
                      clientIdPrefix: publicConfig.clientIdPrefix,
                      normalizeIdentifiers: publicConfig.normalizeIdentifiers,
                      systemIdSeparator: publicConfig.systemIdSeparator,
                      clientIdSeparator: publicConfig.clientIdSeparator,
                    }
                  : undefined
              }
              onNotify={notify}
              onSystemsChanged={() => setRefreshTick((t) => t + 1)}
            />
          )}
          {resolvedActiveTab === 'users' && (
            <UsersManager
              token={session.token}
              currentUserId={session.user.id}
              canWriteUsers={canWriteUsers}
              onNotify={notify}
            />
          )}
          {resolvedActiveTab === 'rbac' && (
            <RbacClaimsManager token={session.token} canWriteRoles={canWriteRoles} onNotify={notify} />
          )}
          {resolvedActiveTab === 'audit-logs' && (
            <AuditLogs
              token={session.token}
              canReadUsers={canReadUsers}
              onNotify={notify}
              refreshSignal={refreshTick}
            />
          )}
          {resolvedActiveTab === 'settings' && (
            <SystemSettings
              token={session.token}
              isSuperAdmin={isSuperAdmin}
              onNotify={notify}
              onSettingsUpdated={(updated) => {
                setPublicConfig({
                  executionEnvironment: updated.executionEnvironment,
                  platformName: updated.platformName,
                  allowSelfRegistration: updated.allowSelfRegistration,
                  sessionWarningSeconds: updated.sessionWarningSeconds,
                  telemetryStreamEnabled: updated.telemetryStreamEnabled,
                  healthAlertSoundEnabled: updated.healthAlertSoundEnabled,
                  defaultJwtTtlSeconds: updated.defaultJwtTtlSeconds,
                  defaultSigningAlg: updated.defaultSigningAlg,
                  defaultEdgeCacheTtl: updated.defaultEdgeCacheTtl,
                  defaultPrivacyPolicyVersion: updated.defaultPrivacyPolicyVersion,
                  pkceRequired: updated.pkceRequired,
                  systemIdPrefix: updated.systemIdPrefix,
                  clientIdPrefix: updated.clientIdPrefix,
                  normalizeIdentifiers: updated.normalizeIdentifiers,
                  systemIdSeparator: updated.systemIdSeparator,
                  clientIdSeparator: updated.clientIdSeparator,
                });
                setRefreshTick((t) => t + 1);
              }}
            />
          )}
          {resolvedActiveTab === 'idps' && (
            <IdpAndOAuthSandbox token={session.token} canWriteSystems={canWriteSystems} onNotify={notify} />
          )}
          {resolvedActiveTab === 'graphql' && <GraphqlAndCloudflare token={session.token} onNotify={notify} />}
          {resolvedActiveTab === 'get-token' && <TokenGate standalone={false} onNotify={notify} />}
          {resolvedActiveTab === 'compliance' && (
            <ProfileAndCompliance
              token={session.token}
              mode="compliance"
              onNotify={notify}
              onSessionInvalidated={handleLogout}
            />
          )}
          {resolvedActiveTab === 'profile' && (
            <ProfileAndCompliance
              token={session.token}
              mode="profile"
              onNotify={notify}
              onSessionInvalidated={handleLogout}
            />
          )}
      </DashboardLayout>

      {/* Subtle Non-Intrusive Session Expiration Modal Warning (5 min before expiry) */}
      {showWarning && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Aviso de expiração de sessão"
          className="fixed bottom-5 right-5 z-50 max-w-sm w-[calc(100vw-2.5rem)] bg-[#111827]/95 backdrop-blur border border-amber-500/50 rounded-lg p-4 shadow-2xl space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-400">
              <Clock className="w-4 h-4 shrink-0" />
              <h3 className="font-display text-xs font-semibold text-white">Sessão prestes a expirar</h3>
            </div>
            <button
              type="button"
              onClick={dismissWarning}
              aria-label="Fechar aviso"
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Seu token JWT expirará em{' '}
            <span className="font-mono tabular-nums font-semibold text-amber-300">{formattedRemaining}</span>.
            Salve alterações pendentes ou reautentique para renovar sua sessão.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={dismissWarning}
              className="px-3 py-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 rounded-md"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
            >
              Reautenticar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
