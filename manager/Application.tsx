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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  Users,
  Shield,
  Globe,
  Code2,
  FileCheck2,
  UserCircle2,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Clock,
  X,
  ScrollText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  ServerCrash,
  Zap,
  History,
  KeyRound,
  Layers,
} from 'lucide-react';
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
import { LatencySparkline } from './components/LatencySparkline';
import { BrandHeaderLogo } from './components/BrandHeaderLogo';
import { subscribeDiagnostics } from './lib/graphqlClient';
import { playHealthAlertSound, unlockHealthAlertAudio } from './lib/healthAlertAudio';
import { useSessionExpiration } from './hooks/useSessionExpiration';
import { useSystemHealth, type SystemHealthLevel } from './hooks/useSystemHealth';
import type { AuthSessionState, DiagnosticHeaders, PublicPlatformConfig } from './types/Identity';

type NavTab =
  | OverviewSection
  | 'assets'
  | 'systems'
  | 'users'
  | 'rbac'
  | 'audit-logs'
  | 'settings'
  | 'idps'
  | 'graphql'
  | 'get-token'
  | 'compliance'
  | 'profile';

const SESSION_STORAGE_KEY = 'vektor_iam_session_v1';

type ToastVariant = 'success' | 'error' | 'warning';

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  group: 'admin' | 'infra' | 'self';
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  adminOnly?: boolean;
  requiredPermission?: string;
}> = [
  { id: 'overview', label: 'Visão Geral', group: 'admin', icon: Activity, shortcut: 'o' },
  { id: 'assets', label: 'Ativos', group: 'admin', icon: Layers, shortcut: 'v' },
  { id: 'audit-logs', label: 'Auditoria', group: 'admin', icon: ScrollText, shortcut: 'a', requiredPermission: 'iam:audit:read' },
  { id: 'settings', label: 'Configurações', group: 'admin', icon: Settings, shortcut: 'c', adminOnly: true },
  { id: 'idps', label: 'Provedores', group: 'infra', icon: Globe, shortcut: 'i' },
  { id: 'graphql', label: 'Infraestrutura', group: 'infra', icon: Code2, shortcut: 'f' },
  { id: 'get-token', label: 'Obter Token', group: 'infra', icon: KeyRound, shortcut: 't' },
  { id: 'compliance', label: 'Conformidade', group: 'self', icon: FileCheck2, shortcut: 'l' },
  { id: 'profile', label: 'Perfil', group: 'self', icon: UserCircle2, shortcut: 'p' },
];

type AssetSubTab = 'systems' | 'users' | 'rbac';

const ASSETS_SUBMENUS: Array<{
  id: AssetSubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  requiredPermission?: string;
}> = [
  { id: 'systems', label: 'Sistemas', icon: AppWindow, shortcut: 's' },
  { id: 'users', label: 'Usuários', icon: Users, shortcut: 'u', requiredPermission: 'iam:users:read' },
  { id: 'rbac', label: 'Permissões', icon: Shield, shortcut: 'r' },
];

const OVERVIEW_SUBMENUS: Array<{
  id: OverviewSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission?: string;
}> = [
  { id: 'overview-stats', label: 'Estatísticas', icon: Users },
  { id: 'overview-trend', label: 'Usuários Ativos', icon: TrendingUp },
  { id: 'overview-http', label: 'Respostas do Servidor', icon: ServerCrash },
  { id: 'overview-edge', label: 'Métricas de Borda', icon: Zap },
  { id: 'overview-health', label: 'Histórico de Saúde', icon: History },
  { id: 'overview-alerts', label: 'Alertas Recentes', icon: AlertOctagon, requiredPermission: 'iam:audit:read' },
  { id: 'overview-audit', label: 'Logs de Auditoria', icon: ScrollText, requiredPermission: 'iam:audit:read' },
];

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [shortcutChordPending, setShortcutChordPending] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
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
      const nextToast: ToastState = {
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
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex">
      {/* Collapsible Sidebar (hidden in Expanded View) */}
      {!isExpandedView && (
        <aside
          className={`${
            isSidebarCollapsed ? 'w-16' : 'w-[280px]'
          } shrink-0 bg-[#0D131F] border-r border-slate-800/80 flex flex-col justify-between transition-all duration-200`}
        >
          <div>
            <div
              className={`min-h-14 py-1.5 border-b border-slate-800/80 bg-[#090D16] flex items-center ${
                isSidebarCollapsed ? 'px-2 justify-center' : 'px-6 justify-between gap-2'
              }`}
            >
              {!isSidebarCollapsed && <BrandHeaderLogo platformName={platformName} />}
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label={isSidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                title={isSidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors shrink-0"
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            </div>

            <nav className={`${isSidebarCollapsed ? 'p-2 space-y-3' : 'p-3 space-y-5'}`}>
              <div>
                {!isSidebarCollapsed && (
                  <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">Administração GraphQL</div>
                )}
                <div className="space-y-0.5">
                  {NAV_ITEMS.filter(
                    (i) => i.group === 'admin' && (!i.adminOnly || isSuperAdmin) && hasPermission(i.requiredPermission)
                  ).map((item) => {
                    const Icon = item.icon;
                    const isOverviewGroup = item.id === 'overview';
                    const isAssetsGroup = item.id === 'assets';
                    const isOverviewChildActive = isOverviewGroup && resolvedActiveTab.startsWith('overview-');
                    const isAssetsChildActive =
                      isAssetsGroup &&
                      (resolvedActiveTab === 'systems' || resolvedActiveTab === 'users' || resolvedActiveTab === 'rbac');
                    const isActive =
                      resolvedActiveTab === item.id ||
                      (isSidebarCollapsed && (isOverviewChildActive || isAssetsChildActive));

                    if (isOverviewGroup) {
                      return (
                        <div key={item.id} className="space-y-0.5">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('overview');
                                setOverviewMenuExpanded(true);
                              }}
                              title={`${item.label} (g ${item.shortcut})`}
                              aria-label={item.label}
                              className={`flex-1 flex items-center ${
                                isSidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                              } rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                                  : isOverviewChildActive
                                    ? 'bg-slate-800/40 text-slate-100 border border-slate-700/60'
                                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <Icon
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isActive || isOverviewChildActive ? 'text-[#F6821F]' : 'text-slate-400'
                                  }`}
                                />
                                {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                              </span>
                              {!isSidebarCollapsed && (
                                <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                              )}
                            </button>
                            {!isSidebarCollapsed && (
                              <button
                                type="button"
                                onClick={() => setOverviewMenuExpanded((prev) => !prev)}
                                aria-label={overviewMenuExpanded ? 'Recolher submenus da Visão Geral' : 'Expandir submenus da Visão Geral'}
                                aria-expanded={overviewMenuExpanded}
                                className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 transition-colors shrink-0"
                              >
                                {overviewMenuExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          {!isSidebarCollapsed && overviewMenuExpanded && (
                            <div className="ml-3.5 pl-2 border-l border-slate-800/90 space-y-0.5 py-0.5">
                              {OVERVIEW_SUBMENUS.filter((sub) => hasPermission(sub.requiredPermission)).map((sub) => {
                                const SubIcon = sub.icon;
                                const isSubActive = resolvedActiveTab === sub.id;
                                return (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => setActiveTab(sub.id)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                                      isSubActive
                                        ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                                    }`}
                                  >
                                    <SubIcon
                                      className={`w-3 h-3 shrink-0 ${
                                        isSubActive ? 'text-[#F6821F]' : 'text-slate-500'
                                      }`}
                                    />
                                    <span className="truncate">{sub.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (isAssetsGroup) {
                      const visibleAssetSubs = ASSETS_SUBMENUS.filter((sub) => hasPermission(sub.requiredPermission));
                      return (
                        <div key={item.id} className="space-y-0.5">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (!isAssetsChildActive) {
                                  setActiveTab(visibleAssetSubs[0]?.id ?? 'systems');
                                }
                                setAssetsMenuExpanded(true);
                              }}
                              title={`${item.label} (g ${item.shortcut})`}
                              aria-label={item.label}
                              className={`flex-1 flex items-center ${
                                isSidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                              } rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                                  : isAssetsChildActive
                                    ? 'bg-slate-800/40 text-slate-100 border border-slate-700/60'
                                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                              }`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <Icon
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isActive || isAssetsChildActive ? 'text-[#F6821F]' : 'text-slate-400'
                                  }`}
                                />
                                {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                              </span>
                              {!isSidebarCollapsed && (
                                <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                              )}
                            </button>
                            {!isSidebarCollapsed && (
                              <button
                                type="button"
                                onClick={() => setAssetsMenuExpanded((prev) => !prev)}
                                aria-label={assetsMenuExpanded ? 'Recolher submenus de Ativos' : 'Expandir submenus de Ativos'}
                                aria-expanded={assetsMenuExpanded}
                                className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 transition-colors shrink-0"
                              >
                                {assetsMenuExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          {!isSidebarCollapsed && assetsMenuExpanded && (
                            <div className="ml-3.5 pl-2 border-l border-slate-800/90 space-y-0.5 py-0.5">
                              {visibleAssetSubs.map((sub) => {
                                const SubIcon = sub.icon;
                                const isSubActive = resolvedActiveTab === sub.id;
                                return (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => setActiveTab(sub.id)}
                                    title={`${sub.label} (g ${sub.shortcut})`}
                                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                                      isSubActive
                                        ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                                    }`}
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      <SubIcon
                                        className={`w-3 h-3 shrink-0 ${
                                          isSubActive ? 'text-[#F6821F]' : 'text-slate-500'
                                        }`}
                                      />
                                      <span className="truncate">{sub.label}</span>
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-600 shrink-0">g {sub.shortcut}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        title={`${item.label} (g ${item.shortcut})`}
                        aria-label={item.label}
                        className={`w-full flex items-center ${
                          isSidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                        } rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                          {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </span>
                        {!isSidebarCollapsed && (
                          <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={isSidebarCollapsed ? 'border-t border-slate-800/70 pt-3' : ''}>
                {!isSidebarCollapsed && (
                  <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">Borda, OAuth & D1</div>
                )}
                <div className="space-y-0.5">
                  {NAV_ITEMS.filter((i) => i.group === 'infra').map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        title={`${item.label} (g ${item.shortcut})`}
                        aria-label={item.label}
                        className={`w-full flex items-center ${
                          isSidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                        } rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                          {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </span>
                        {!isSidebarCollapsed && (
                          <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={isSidebarCollapsed ? 'border-t border-slate-800/70 pt-3' : ''}>
                {!isSidebarCollapsed && (
                  <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">Titular & Privacidade</div>
                )}
                <div className="space-y-0.5">
                  {NAV_ITEMS.filter((i) => i.group === 'self').map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        title={`${item.label} (g ${item.shortcut})`}
                        aria-label={item.label}
                        className={`w-full flex items-center ${
                          isSidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                        } rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                          {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                        </span>
                        {!isSidebarCollapsed && (
                          <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </nav>
          </div>

          {isSidebarCollapsed ? (
            <div
              className="p-3 border-t border-slate-800/80 flex items-center justify-center"
              title={`${session.user.displayName} (${session.user.email})`}
            >
              <div className="w-8 h-8 rounded-md bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-xs font-semibold text-slate-200 uppercase">
                {(session.user.displayName || session.user.email).slice(0, 2)}
              </div>
            </div>
          ) : (
            <div className="p-4 border-t border-slate-800/80 space-y-2 text-[11px]">
              <div className="text-slate-200 font-medium truncate">{session.user.displayName}</div>
              <div className="font-mono text-slate-400 truncate">{session.user.email}</div>
              <div className="font-mono text-slate-500 truncate">
                {session.system.slug} · {session.user.roles.join(', ') || 'member'}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar (Brand + Last GraphQL Edge Diagnostic + Session Countdown + Sign Out) */}
        <header className="min-h-14 py-1.5 px-6 border-b border-slate-800/80 bg-[#090D16] flex items-center justify-between gap-6 shrink-0">
          {isExpandedView || isSidebarCollapsed ? (
            <BrandHeaderLogo platformName={platformName} />
          ) : (
            <div aria-hidden="true" />
          )}

          <div className="flex items-center gap-3 shrink-0">
            {shortcutChordPending && (
              <span className="px-2 py-0.5 rounded bg-[#F6821F]/15 border border-[#F6821F]/50 text-[11px] font-mono text-[#F6821F] whitespace-nowrap">
                g + …
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsExpandedView((prev) => !prev)}
              aria-pressed={isExpandedView}
              aria-label={isExpandedView ? 'Restaurar' : 'Expandir'}
              title={isExpandedView ? 'Restaurar' : 'Expandir'}
              className={`relative group flex items-center justify-center p-2 text-xs font-medium rounded-md border transition-colors shrink-0 ${
                isExpandedView
                  ? 'bg-[#F6821F]/15 border-[#F6821F]/50 text-white'
                  : 'bg-[#111827] hover:bg-slate-800 border-slate-700/80 text-slate-200'
              }`}
            >
              {isExpandedView ? (
                <Minimize2 className="w-4 h-4 text-[#F6821F]" />
              ) : (
                <Maximize2 className="w-4 h-4 text-slate-400" />
              )}
              <span
                role="tooltip"
                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
              >
                {isExpandedView ? 'Restaurar' : 'Expandir'}
              </span>
            </button>

            {lastDiag && (
              <div className="hidden xl:flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                <span className={lastDiag.cacheStatus === 'HIT' ? 'text-emerald-400' : 'text-amber-400'}>
                  CF:{lastDiag.cacheStatus}
                </span>
                <span aria-hidden="true">·</span>
                <span>{lastDiag.durationMs.toFixed(1)}ms</span>
                <span aria-hidden="true">·</span>
                <span>SQL:{lastDiag.sqliteQueriesCount}</span>
              </div>
            )}

            <div
              role="status"
              aria-label={`Saúde do Sistema: ${systemHealth.label}${
                systemHealth.avgLatencyMs !== null
                  ? `, latência média ${systemHealth.avgLatencyMs.toFixed(1)} ms`
                  : ''
              }`}
              title={
                systemHealth.avgLatencyMs !== null
                  ? `Saúde do Sistema: ${systemHealth.label} · Latência média: ${systemHealth.avgLatencyMs.toFixed(1)}ms (${systemHealth.sampleCount} logs recentes, máx ${systemHealth.maxLatencyMs?.toFixed(1) ?? '0.0'}ms). Tendência últimos 10 min: máx ${(
                      systemHealth.latencyTrend.reduce((acc, p) => Math.max(acc, p.avgLatencyMs), 0)
                    ).toFixed(1)}ms. Faixas: Verde < 100ms · Amarelo 100–299ms · Vermelho ≥ 300ms.`
                  : 'Calculando saúde do sistema pelos logs de auditoria recentes...'
              }
              className={`hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] whitespace-nowrap ${
                systemHealth.level === 'critical'
                  ? 'bg-red-950/35 border-red-800/60 text-red-200'
                  : systemHealth.level === 'degraded'
                    ? 'bg-amber-950/35 border-amber-700/60 text-amber-200'
                    : systemHealth.level === 'healthy'
                      ? 'bg-[#111827] border-emerald-800/60 text-slate-200'
                      : 'bg-[#111827] border-slate-800 text-slate-400'
              }`}
            >
              {systemHealth.level === 'critical' ? (
                <AlertOctagon className="w-3.5 h-3.5 text-red-400 shrink-0" />
              ) : systemHealth.level === 'degraded' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : systemHealth.level === 'healthy' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="font-medium">Saúde do Sistema</span>
              <LatencySparkline points={systemHealth.latencyTrend} level={systemHealth.level} />
              {systemHealth.avgLatencyMs !== null && (
                <span
                  className={`font-mono tabular-nums ${
                    systemHealth.level === 'critical'
                      ? 'text-red-300'
                      : systemHealth.level === 'degraded'
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                  }`}
                >
                  {systemHealth.avgLatencyMs.toFixed(1)}ms
                </span>
              )}
            </div>
            <div
              className={`hidden md:flex items-center gap-1.5 text-[11px] font-mono tabular-nums ${
                isExpiringSoon ? 'text-amber-400' : 'text-slate-400'
              }`}
              title="Tempo restante do token JWT da sessão"
            >
              <Clock className="w-3 h-3" />
              <span>{formattedRemaining}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair"
              title="Sair"
              className="relative group flex items-center justify-center p-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 rounded-md transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span
                role="tooltip"
                className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
              >
                Sair
              </span>
            </button>
          </div>
        </header>

        {/* Notification Banner */}
        {toast && (
          <div
            role="alert"
            aria-live="polite"
            className={`mt-4 px-4 py-2.5 rounded-md border flex items-center justify-between gap-3 text-xs ${
              isExpandedView ? 'mx-auto max-w-[1312px] w-[calc(100%-3rem)]' : 'mx-6'
            } ${
              toast.variant === 'error'
                ? 'bg-red-950/60 border-red-700/70 text-red-100'
                : toast.variant === 'warning'
                  ? 'bg-amber-950/60 border-amber-600/70 text-amber-100'
                  : 'bg-emerald-950/60 border-emerald-700/70 text-emerald-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.variant === 'error' ? (
                <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
              ) : toast.variant === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="truncate">{toast.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Fechar notificação"
              className="text-slate-300 hover:text-white p-0.5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Viewport */}
        <main className={`flex-1 p-6 max-w-[1360px] w-full ${isExpandedView ? 'mx-auto' : ''}`}>
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
        </main>
      </div>

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
    </div>
  );
}
