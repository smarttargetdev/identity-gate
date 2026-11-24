/**
 * File: RbacClaimsManager.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Gestão de funções (roles), permissões atômicas e claims personalizadas por sistema.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Shield, Edit3, X, KeyRound } from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { IamSystem, Permission, Role } from '../types/Identity';

interface RbacClaimsManagerProps {
  token: string;
  canWriteRoles?: boolean;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
}

const RBAC_QUERY = `
  query RbacWorkspace($systemId: ID!) {
    systems {
      id
      name
      slug
      jwtTtlSeconds
      signingAlg
    }
    rolesBySystem(systemId: $systemId) {
      id
      systemId
      name
      description
      isDefault
      permissions { id code description }
      claims { id claimKey claimValue valueType }
    }
    permissionsBySystem(systemId: $systemId) {
      id
      systemId
      code
      description
    }
  }
`;

export const RbacClaimsManager: React.FC<RbacClaimsManagerProps> = ({
  token,
  canWriteRoles = false,
  onNotify,
}) => {
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState('identity-secure-gate');
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');

  // Modal Visibility States
  const [editingRoleModal, setEditingRoleModal] = useState<boolean>(false);
  const [creatingRoleModal, setCreatingRoleModal] = useState<boolean>(false);
  const [creatingPermModal, setCreatingPermModal] = useState<boolean>(false);

  // Editable Role State (used inside Modal)
  const [editingRoleId, setEditingRoleId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [roleIsDefault, setRoleIsDefault] = useState(false);
  const [selectedPermIds, setSelectedPermIds] = useState<string[]>([]);
  const [claimsDraft, setClaimsDraft] = useState<Array<{ claimKey: string; claimValue: string; valueType: string }>>([]);

  // Create Role / Perm Modal State
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newPermCode, setNewPermCode] = useState('');
  const [newPermDesc, setNewPermDesc] = useState('');

  const loadRbac = async (sysId: string, preferredRoleId?: string) => {
    try {
      const { data } = await gqlRequest<{
        systems: IamSystem[];
        rolesBySystem: Role[];
        permissionsBySystem: Permission[];
      }>({
        token,
        query: RBAC_QUERY,
        operationName: 'RbacWorkspace',
        variables: { systemId: sysId },
      });
      setSystems(data.systems);
      setRoles(data.rolesBySystem);
      setPermissions(data.permissionsBySystem);

      const targetId = preferredRoleId ?? selectedRoleId;
      const activeRole = data.rolesBySystem.find((r) => r.id === targetId) || data.rolesBySystem[0];
      setSelectedRoleId(activeRole ? activeRole.id : '');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar matriz RBAC.');
    }
  };

  useEffect(() => {
    void loadRbac(selectedSystemId);
  }, [token, selectedSystemId]);

  const openEditRoleModal = (role: Role) => {
    setSelectedRoleId(role.id);
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleDesc(role.description);
    setRoleIsDefault(role.isDefault);
    setSelectedPermIds(role.permissions.map((p) => p.id));
    setClaimsDraft(
      role.claims.map((c) => ({
        claimKey: c.claimKey,
        claimValue: c.claimValue,
        valueType: c.valueType,
      }))
    );
    setEditingRoleModal(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteRoles) {
      onNotify('Permissão iam:roles:write necessária para editar roles.', 'warning');
      return;
    }
    if (!editingRoleId) return;
    try {
      await gqlRequest({
        token,
        operationName: 'UpdateRoleConfig',
        query: `
          mutation UpdateRoleConfig($id: ID!, $name: String!, $description: String, $isDefault: Boolean, $permissionIds: [ID!], $claims: [ClaimInput!]) {
            updateRole(id: $id, name: $name, description: $description, isDefault: $isDefault, permissionIds: $permissionIds, claims: $claims) {
              id
              name
            }
          }
        `,
        variables: {
          id: editingRoleId,
          name: roleName,
          description: roleDesc,
          isDefault: roleIsDefault,
          permissionIds: selectedPermIds,
          claims: claimsDraft.filter((c) => c.claimKey.trim() !== ''),
        },
      });
      onNotify(`Role "${roleName}", permissões e claims salvos no SQLite via GraphQL.`);
      setEditingRoleModal(false);
      await loadRbac(selectedSystemId, editingRoleId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar role.');
    }
  };

  const handleCreatePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteRoles) {
      onNotify('Permissão iam:roles:write necessária para criar permissões.', 'warning');
      return;
    }
    if (!newPermCode.trim()) return;
    try {
      await gqlRequest({
        token,
        operationName: 'CreatePerm',
        query: `
          mutation CreatePerm($systemId: ID!, $code: String!, $description: String) {
            createPermission(systemId: $systemId, code: $code, description: $description) { id code }
          }
        `,
        variables: { systemId: selectedSystemId, code: newPermCode.trim(), description: newPermDesc.trim() },
      });
      setNewPermCode('');
      setNewPermDesc('');
      setCreatingPermModal(false);
      onNotify('Permissão criada no sistema.');
      await loadRbac(selectedSystemId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao criar permissão.');
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteRoles) {
      onNotify('Permissão iam:roles:write necessária para criar roles.', 'warning');
      return;
    }
    if (!newRoleName.trim()) return;
    try {
      const { data } = await gqlRequest<{ createRole: Role }>({
        token,
        operationName: 'CreateRole',
        query: `
          mutation CreateRole($input: RoleInput!) {
            createRole(input: $input) {
              id name description isDefault
              permissions { id code description }
              claims { id claimKey claimValue valueType }
            }
          }
        `,
        variables: {
          input: { systemId: selectedSystemId, name: newRoleName.trim(), description: newRoleDesc.trim() },
        },
      });
      setNewRoleName('');
      setNewRoleDesc('');
      setCreatingRoleModal(false);
      onNotify(`Role "${data.createRole.name}" criada.`);
      await loadRbac(selectedSystemId, data.createRole.id);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao criar role.');
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!canWriteRoles) {
      onNotify('Permissão iam:roles:write necessária para remover roles.', 'warning');
      return;
    }
    try {
      await gqlRequest({
        token,
        operationName: 'DeleteRole',
        query: `mutation DeleteRole($id: ID!) { deleteRole(id: $id) { success message } }`,
        variables: { id },
      });
      onNotify('Role removida via GraphQL.');
      if (selectedRoleId === id) setSelectedRoleId('');
      await loadRbac(selectedSystemId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao remover role.');
    }
  };

  const currentSystem = systems.find((s) => s.id === selectedSystemId);
  const inspectedRole = roles.find((r) => r.id === selectedRoleId) || null;

  // Live JWT Payload Preview constructed from inspected role
  const previewJwtPayload = {
    iss: 'https://isg.edge.local',
    sub: 'usr-exemplo-01',
    aud: currentSystem?.slug || 'identity-gate',
    sys: currentSystem?.slug || 'identity-gate',
    roles: inspectedRole ? [inspectedRole.name] : [],
    permissions: inspectedRole ? inspectedRole.permissions.map((p) => p.code) : [],
    claims: inspectedRole
      ? Object.fromEntries(
          inspectedRole.claims.map((c) => [
            c.claimKey,
            c.valueType === 'number'
              ? Number(c.claimValue)
              : c.valueType === 'boolean'
                ? c.claimValue === 'true'
                : c.claimValue,
          ])
        )
      : {},
    exp: Math.floor(Date.now() / 1000) + (currentSystem?.jwtTtlSeconds || 3600),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold text-white">Permissões de Acesso</h1>
          <InfoTooltip text="Inspecione o catálogo RBAC por sistema e abra os popups para configurar roles, permissões atômicas e claims personalizadas." />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={selectedSystemId}
            onChange={(e) => {
              setSelectedSystemId(e.target.value);
              setSelectedRoleId('');
            }}
            className="bg-[#111827] border border-slate-700 rounded-md px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
          >
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.slug})
              </option>
            ))}
          </select>
          {canWriteRoles && (
            <>
              <button
                type="button"
                onClick={() => {
                  setNewPermCode('');
                  setNewPermDesc('');
                  setCreatingPermModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#111827] border border-slate-700 hover:border-slate-500 text-slate-200 rounded-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Permissão</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewRoleName('');
                  setNewRoleDesc('');
                  setCreatingRoleModal(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Role</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Read-Only Roles & Permissions Catalog */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Funções do Sistema</h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{roles.length}</span>
            </div>
            <div className="space-y-1.5">
              {roles.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedRoleId(r.id)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer border text-xs transition-colors ${
                    selectedRoleId === r.id
                      ? 'bg-[#F6821F]/10 border-[#F6821F] text-white'
                      : 'bg-[#090D16] border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-mono font-medium truncate">{r.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {r.permissions.length} permissões · {r.claims.length} claims {r.isDefault ? '· padrão' : ''}
                    </div>
                  </div>
                  {canWriteRoles && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEditRoleModal(r);
                        }}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                        title="Configurar Role, Permissões e Claims"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void handleDeleteRole(r.id);
                        }}
                        className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800"
                        title="Remover Role"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {roles.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-500">Nenhuma role definida neste sistema.</div>
              )}
            </div>
          </div>

          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Permissões Atômicas</h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{permissions.length}</span>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {permissions.map((perm) => (
                <div
                  key={perm.id}
                  className="px-3 py-2 bg-[#090D16] border border-slate-800 rounded text-xs"
                >
                  <div className="font-mono text-slate-200">{perm.code}</div>
                  {perm.description && <div className="text-[11px] text-slate-500 mt-0.5">{perm.description}</div>}
                </div>
              ))}
              {permissions.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-500">Nenhuma permissão cadastrada.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Inspected Role Summary + Live JWT Payload Preview */}
        <div className="lg:col-span-8 space-y-6">
          {inspectedRole ? (
            <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Shield className="w-4 h-4 text-[#F6821F]" />
                  <div>
                    <h2 className="text-sm font-semibold text-white font-mono">{inspectedRole.name}</h2>
                    <p className="text-xs text-slate-400">
                      {inspectedRole.description || 'Sem descrição'}
                      {inspectedRole.isDefault ? ' · Role padrão no provisionamento JIT' : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openEditRoleModal(inspectedRole)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Configurar Role e Claims</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-300">
                    Permissões Atribuídas ({inspectedRole.permissions.length})
                  </div>
                  <div className="bg-[#090D16] border border-slate-800 rounded-md p-3 space-y-1.5 max-h-48 overflow-y-auto">
                    {inspectedRole.permissions.length > 0 ? (
                      inspectedRole.permissions.map((p) => (
                        <div key={p.id} className="text-xs">
                          <span className="font-mono text-slate-200">{p.code}</span>
                          {p.description && <span className="text-slate-500"> · {p.description}</span>}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">Nenhuma permissão vinculada a esta role.</div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-300">
                    Claims Personalizadas ({inspectedRole.claims.length})
                  </div>
                  <div className="bg-[#090D16] border border-slate-800 rounded-md p-3 space-y-1.5 max-h-48 overflow-y-auto">
                    {inspectedRole.claims.length > 0 ? (
                      inspectedRole.claims.map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-300">{c.claimKey}</span>
                          <span className="text-emerald-400">
                            {c.claimValue} <span className="text-slate-500">({c.valueType})</span>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">Nenhuma claim personalizada vinculada.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-8 text-center text-xs text-slate-400">
              Selecione ou crie uma Role para visualizar permissões e claims.
            </div>
          )}

          {/* Live JWT Payload Preview */}
          <div className="bg-[#111827] border border-slate-800/90 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#F6821F]" />
                <h3 className="text-sm font-semibold text-white">Pré-visualização do Payload JWT Emitido</h3>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {currentSystem?.signingAlg || 'RS256'} · exp +{currentSystem?.jwtTtlSeconds || 3600}s
              </span>
            </div>
            <pre className="bg-[#090D16] border border-slate-800 rounded-md p-3.5 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
              {JSON.stringify(previewJwtPayload, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* Modal: Create Role */}
      {creatingRoleModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display text-base font-semibold text-white">Nova Role</h3>
              <button
                type="button"
                onClick={() => setCreatingRoleModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateRole} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome da Role</label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="ex: billing_admin"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  placeholder="Escopo de atuação da função"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreatingRoleModal(false)}
                  className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                >
                  Criar Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Permission */}
      {creatingPermModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display text-base font-semibold text-white">Nova Permissão Atômica</h3>
              <button
                type="button"
                onClick={() => setCreatingPermModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePermission} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Código da Permissão</label>
                <input
                  type="text"
                  required
                  value={newPermCode}
                  onChange={(e) => setNewPermCode(e.target.value)}
                  placeholder="ex: invoices:export"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={newPermDesc}
                  onChange={(e) => setNewPermDesc(e.target.value)}
                  placeholder="Permite exportar faturas em CSV/PDF"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreatingPermModal(false)}
                  className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                >
                  Adicionar Permissão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Role, Permissions & Custom Claims */}
      {editingRoleModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-3xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#F6821F]" />
                <h3 className="font-display text-base font-semibold text-white">Configurar Role, Permissões e Claims</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingRoleModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome da Role</label>
                  <input
                    type="text"
                    required
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Descrição</label>
                  <input
                    type="text"
                    value={roleDesc}
                    onChange={(e) => setRoleDesc(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roleIsDefault}
                  onChange={(e) => setRoleIsDefault(e.target.checked)}
                  className="rounded border-slate-700 bg-[#090D16]"
                />
                <span>Atribuir como função padrão para novos usuários e provisionamento JIT</span>
              </label>

              {/* Permissions Checklist */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-300">Permissões Vinculadas</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                  {permissions.map((perm) => {
                    const checked = selectedPermIds.includes(perm.id);
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-start gap-2.5 p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                          checked
                            ? 'bg-slate-800/60 border-slate-600 text-white'
                            : 'bg-[#090D16] border-slate-800 text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedPermIds((prev) =>
                              prev.includes(perm.id) ? prev.filter((id) => id !== perm.id) : [...prev, perm.id]
                            )
                          }
                          className="mt-0.5 rounded border-slate-700 bg-[#090D16]"
                        />
                        <div>
                          <div className="font-mono text-[11px]">{perm.code}</div>
                          <div className="text-[11px] text-slate-500">{perm.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Custom Claims Builder */}
              <div className="space-y-2.5 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Claims Personalizadas no JWT</span>
                  <button
                    type="button"
                    onClick={() =>
                      setClaimsDraft((prev) => [...prev, { claimKey: '', claimValue: '', valueType: 'string' }])
                    }
                    className="text-xs text-[#F6821F] hover:underline"
                  >
                    + Adicionar Claim
                  </button>
                </div>

                {claimsDraft.map((claim, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="chave (ex: tenant_tier)"
                      value={claim.claimKey}
                      onChange={(e) => {
                        const next = [...claimsDraft];
                        next[idx].claimKey = e.target.value;
                        setClaimsDraft(next);
                      }}
                      className="col-span-4 bg-[#090D16] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <input
                      type="text"
                      placeholder="valor"
                      value={claim.claimValue}
                      onChange={(e) => {
                        const next = [...claimsDraft];
                        next[idx].claimValue = e.target.value;
                        setClaimsDraft(next);
                      }}
                      className="col-span-4 bg-[#090D16] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <select
                      value={claim.valueType}
                      onChange={(e) => {
                        const next = [...claimsDraft];
                        next[idx].valueType = e.target.value;
                        setClaimsDraft(next);
                      }}
                      className="col-span-3 bg-[#090D16] border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setClaimsDraft((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 text-slate-500 hover:text-red-400 flex justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingRoleModal(false)}
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
