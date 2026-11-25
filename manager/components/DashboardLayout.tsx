/**
 * File: DashboardLayout.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Layout principal do painel administrativo com barra lateral de navegação responsiva, cabeçalho contextual e área principal de métricas de identidade.
 * Version: 1.0.0
 * Created: 2026-11-25
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import React, { useMemo, useState } from 'react';
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
  Menu,
} from 'lucide-react';
import type { OverviewSection } from './OverviewTelemetry';
import { LatencySparkline } from './LatencySparkline';
import { BrandHeaderLogo } from './BrandHeaderLogo';
import { VersionBadge } from './VersionBadge';
import type { SystemHealthState } from '../hooks/UseSystemHealth';
import type { AuthSessionState, DiagnosticHeaders } from '../domains/Identity';

export type NavTab =
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

export type AssetSubTab = 'systems' | 'users' | 'rbac';
export type ToastVariant = 'success' | 'error' | 'warning';

export interface DashboardToastState {
  id: number;
  message: string;
  variant: ToastVariant;
}

export const NAV_ITEMS: Array<{
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
  {
    id: 'audit-logs',
    label: 'Auditoria',
    group: 'admin',
    icon: ScrollText,
    shortcut: 'a',
    requiredPermission: 'iam:audit:read',
  },
  { id: 'settings', label: 'Configurações', group: 'admin', icon: Settings, shortcut: 'c', adminOnly: true },
  { id: 'idps', label: 'Provedores', group: 'infra', icon: Globe, shortcut: 'i' },
  { id: 'graphql', label: 'Infraestrutura', group: 'infra', icon: Code2, shortcut: 'f' },
  { id: 'get-token', label: 'Obter Token', group: 'infra', icon: KeyRound, shortcut: 't' },
  { id: 'compliance', label: 'Conformidade', group: 'self', icon: FileCheck2, shortcut: 'l' },
  { id: 'profile', label: 'Perfil', group: 'self', icon: UserCircle2, shortcut: 'p' },
];

export const ASSETS_SUBMENUS: Array<{
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

export const OVERVIEW_SUBMENUS: Array<{
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

const GROUP_LABELS: Record<'admin' | 'infra' | 'self', string> = {
  admin: 'Administração GraphQL',
  infra: 'Borda, OAuth & D1',
  self: 'Titular & Privacidade',
};

interface DashboardLayoutProps {
  platformName: string;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  session: AuthSessionState;
  isSuperAdmin: boolean;
  hasPermission: (perm?: string) => boolean;
  systemHealth: SystemHealthState;
  lastDiag: DiagnosticHeaders | null;
  formattedRemaining: string;
  isExpiringSoon: boolean;
  shortcutChordPending: boolean;
  overviewMenuExpanded: boolean;
  onToggleOverviewMenu: () => void;
  onExpandOverviewMenu: () => void;
  assetsMenuExpanded: boolean;
  onToggleAssetsMenu: () => void;
  onExpandAssetsMenu: () => void;
  toast: DashboardToastState | null;
  onDismissToast: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  platformName,
  activeTab,
  onSelectTab,
  session,
  isSuperAdmin,
  hasPermission,
  systemHealth,
  lastDiag,
  formattedRemaining,
  isExpiringSoon,
  shortcutChordPending,
  overviewMenuExpanded,
  onToggleOverviewMenu,
  onExpandOverviewMenu,
  assetsMenuExpanded,
  onToggleAssetsMenu,
  onExpandAssetsMenu,
  toast,
  onDismissToast,
  onLogout,
  children,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const breadcrumb = useMemo(() => {
    const overviewSub = OVERVIEW_SUBMENUS.find((s) => s.id === activeTab);
    if (overviewSub) {
      return { group: GROUP_LABELS.admin, section: 'Visão Geral', detail: overviewSub.label };
    }
    const assetSub = ASSETS_SUBMENUS.find((s) => s.id === activeTab);
    if (assetSub) {
      return { group: GROUP_LABELS.admin, section: 'Ativos', detail: assetSub.label };
    }
    const navItem = NAV_ITEMS.find((i) => i.id === activeTab);
    if (navItem) {
      return { group: GROUP_LABELS[navItem.group], section: navItem.label, detail: null };
    }
    return { group: GROUP_LABELS.admin, section: 'Visão Geral', detail: null };
  }, [activeTab]);

  const selectAndCloseMobile = (tab: NavTab) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  const renderSidebarNavigation = (collapsed: boolean) => (
    <nav aria-label="Navegação principal" className={`${collapsed ? 'p-2 space-y-3' : 'p-3 space-y-5'}`}>
      <div>
        {!collapsed && (
          <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">
            {GROUP_LABELS.admin}
          </div>
        )}
        <div className="space-y-0.5">
          {NAV_ITEMS.filter(
            (i) => i.group === 'admin' && (!i.adminOnly || isSuperAdmin) && hasPermission(i.requiredPermission)
          ).map((item) => {
            const Icon = item.icon;
            const isOverviewGroup = item.id === 'overview';
            const isAssetsGroup = item.id === 'assets';
            const isOverviewChildActive = isOverviewGroup && activeTab.startsWith('overview-');
            const isAssetsChildActive =
              isAssetsGroup && (activeTab === 'systems' || activeTab === 'users' || activeTab === 'rbac');
            const isActive =
              activeTab === item.id || (collapsed && (isOverviewChildActive || isAssetsChildActive));

            if (isOverviewGroup) {
              return (
                <div key={item.id} className="space-y-0.5">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        selectAndCloseMobile('overview');
                        onExpandOverviewMenu();
                      }}
                      title={`${item.label} (g ${item.shortcut})`}
                      aria-label={item.label}
                      className={`flex-1 flex items-center ${
                        collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                      } rounded-md text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
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
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </span>
                      {!collapsed && (
                        <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                      )}
                    </button>
                    {!collapsed && (
                      <button
                        type="button"
                        onClick={onToggleOverviewMenu}
                        aria-label={
                          overviewMenuExpanded
                            ? 'Recolher submenus da Visão Geral'
                            : 'Expandir submenus da Visão Geral'
                        }
                        aria-expanded={overviewMenuExpanded}
                        className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60"
                      >
                        {overviewMenuExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {!collapsed && overviewMenuExpanded && (
                    <div className="ml-3.5 pl-2 border-l border-slate-800/90 space-y-0.5 py-0.5">
                      {OVERVIEW_SUBMENUS.filter((sub) => hasPermission(sub.requiredPermission)).map((sub) => {
                        const SubIcon = sub.icon;
                        const isSubActive = activeTab === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => selectAndCloseMobile(sub.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
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
                          selectAndCloseMobile(visibleAssetSubs[0]?.id ?? 'systems');
                        }
                        onExpandAssetsMenu();
                      }}
                      title={`${item.label} (g ${item.shortcut})`}
                      aria-label={item.label}
                      className={`flex-1 flex items-center ${
                        collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                      } rounded-md text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
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
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </span>
                      {!collapsed && (
                        <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                      )}
                    </button>
                    {!collapsed && (
                      <button
                        type="button"
                        onClick={onToggleAssetsMenu}
                        aria-label={
                          assetsMenuExpanded ? 'Recolher submenus de Ativos' : 'Expandir submenus de Ativos'
                        }
                        aria-expanded={assetsMenuExpanded}
                        className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60"
                      >
                        {assetsMenuExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {!collapsed && assetsMenuExpanded && (
                    <div className="ml-3.5 pl-2 border-l border-slate-800/90 space-y-0.5 py-0.5">
                      {visibleAssetSubs.map((sub) => {
                        const SubIcon = sub.icon;
                        const isSubActive = activeTab === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => selectAndCloseMobile(sub.id)}
                            title={`${sub.label} (g ${sub.shortcut})`}
                            className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
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
                            <span className="text-[10px] font-mono text-slate-600 shrink-0">
                              g {sub.shortcut}
                            </span>
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
                onClick={() => selectAndCloseMobile(item.id)}
                title={`${item.label} (g ${item.shortcut})`}
                aria-label={item.label}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                } rounded-md text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
                  isActive
                    ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && (
                  <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={collapsed ? 'border-t border-slate-800/70 pt-3' : ''}>
        {!collapsed && (
          <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">{GROUP_LABELS.infra}</div>
        )}
        <div className="space-y-0.5">
          {NAV_ITEMS.filter((i) => i.group === 'infra').map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectAndCloseMobile(item.id)}
                title={`${item.label} (g ${item.shortcut})`}
                aria-label={item.label}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                } rounded-md text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
                  isActive
                    ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && (
                  <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={collapsed ? 'border-t border-slate-800/70 pt-3' : ''}>
        {!collapsed && (
          <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-500">{GROUP_LABELS.self}</div>
        )}
        <div className="space-y-0.5">
          {NAV_ITEMS.filter((i) => i.group === 'self').map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectAndCloseMobile(item.id)}
                title={`${item.label} (g ${item.shortcut})`}
                aria-label={item.label}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center px-2 py-2' : 'justify-between gap-2 px-2.5 py-2'
                } rounded-md text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
                  isActive
                    ? 'bg-[#F6821F]/15 text-white border border-[#F6821F]/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#F6821F]' : 'text-slate-400'}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && (
                  <span className="text-[10px] font-mono text-slate-600 shrink-0">g {item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );

  const renderUserFooter = (collapsed: boolean) =>
    collapsed ? (
      <div
        className="p-3 border-t border-slate-800/80 flex items-center justify-center"
        title={`${session.user.displayName} (${session.user.email})`}
      >
        <div className="w-8 h-8 rounded-md bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-xs font-semibold text-slate-200 uppercase">
          {(session.user.displayName || session.user.email).slice(0, 2)}
        </div>
      </div>
    ) : (
      <div className="p-4 border-t border-slate-800/80 space-y-1.5 text-[11px]">
        <div className="text-slate-200 font-medium truncate">{session.user.displayName}</div>
        <div className="font-mono text-slate-400 truncate">{session.user.email}</div>
        <div className="font-mono text-slate-500 truncate">
          {session.system.slug} · {session.user.roles.join(', ') || 'member'}
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex">
      {/* Desktop Collapsible Sidebar (hidden on mobile and in Expanded View) */}
      {!isExpandedView && (
        <aside
          aria-label="Barra lateral de navegação"
          className={`hidden md:flex ${
            isSidebarCollapsed ? 'w-16' : 'w-[272px]'
          } shrink-0 bg-[#0D131F] border-r border-slate-800/80 flex-col justify-between transition-all duration-200`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={`min-h-14 py-1.5 border-b border-slate-800/80 bg-[#090D16] flex items-center sticky top-0 z-10 ${
                isSidebarCollapsed ? 'px-2 justify-center' : 'px-5 justify-between gap-2'
              }`}
            >
              {!isSidebarCollapsed && <BrandHeaderLogo platformName={platformName} />}
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label={isSidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                title={isSidebarCollapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60"
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            </div>

            {renderSidebarNavigation(isSidebarCollapsed)}
          </div>

          {renderUserFooter(isSidebarCollapsed)}
        </aside>
      )}

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true" aria-label="Menu de navegação">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-[280px] max-w-[85vw] bg-[#0D131F] border-r border-slate-800/90 flex flex-col justify-between h-full">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="min-h-14 py-1.5 px-5 border-b border-slate-800/80 bg-[#090D16] flex items-center justify-between gap-2 sticky top-0 z-10">
                <BrandHeaderLogo platformName={platformName} />
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fechar menu de navegação"
                  className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {renderSidebarNavigation(false)}
            </div>
            {renderUserFooter(false)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="min-h-14 py-1.5 px-4 sm:px-6 border-b border-slate-800/80 bg-[#090D16] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu de navegação"
              className="md:hidden p-2 rounded-md bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>

            {(isExpandedView || isSidebarCollapsed) && (
              <div className="shrink-0">
                <BrandHeaderLogo platformName={platformName} />
              </div>
            )}

            <nav aria-label="Localização atual" className="hidden sm:flex items-center gap-2 text-xs text-slate-400 min-w-0">
              {!(isExpandedView || isSidebarCollapsed) && (
                <>
                  <span className="text-slate-500 truncate">{breadcrumb.group}</span>
                  <span aria-hidden="true" className="text-slate-700">
                    /
                  </span>
                </>
              )}
              <span className="font-medium text-slate-200 truncate">{breadcrumb.section}</span>
              {breadcrumb.detail && (
                <>
                  <span aria-hidden="true" className="text-slate-700">
                    /
                  </span>
                  <span className="text-[#F6821F] font-medium truncate">{breadcrumb.detail}</span>
                </>
              )}
            </nav>
          </div>

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
              className={`hidden md:flex relative group items-center justify-center p-2 text-xs font-medium rounded-md border transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60 ${
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
              <div className="hidden xl:flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
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
              className={`hidden md:flex items-center gap-1.5 text-[11px] font-mono tabular-nums whitespace-nowrap ${
                isExpiringSoon ? 'text-amber-400' : 'text-slate-400'
              }`}
              title="Tempo restante do token JWT da sessão"
            >
              <Clock className="w-3 h-3" />
              <span>{formattedRemaining}</span>
            </div>

            <button
              type="button"
              onClick={onLogout}
              aria-label="Sair"
              title="Sair"
              className="relative group flex items-center justify-center p-2 text-xs font-medium bg-[#111827] hover:bg-slate-800 border border-slate-700/80 text-slate-200 rounded-md transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60"
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
              isExpandedView ? 'mx-auto max-w-[1312px] w-[calc(100%-3rem)]' : 'mx-4 sm:mx-6'
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
              onClick={onDismissToast}
              aria-label="Fechar notificação"
              className="text-slate-300 hover:text-white p-0.5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Identity Metrics & Console Viewport */}
        <main
          id="main-content"
          className={`flex-1 p-4 sm:p-6 max-w-[1360px] w-full ${isExpandedView ? 'mx-auto' : ''}`}
        >
          {children}
        </main>

        <footer className="w-full px-4 sm:px-6 py-3.5 border-t border-slate-800/60 flex items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>{platformName}</span>
            <VersionBadge />
          </div>
          <span>© 2026, Smart Target</span>
        </footer>
      </div>
    </div>
  );
};
