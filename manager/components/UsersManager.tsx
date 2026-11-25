/**
 * File: UsersManager.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Gerenciamento CRUD de usuários via GraphQL e vínculos de roles multi-sistema.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useState } from 'react';
import { UserPlus, Edit3, Trash2, Link2, X, Save } from 'lucide-react';
import { gqlRequest } from '../libraries/GraphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { IamSystem, IamUser } from '../domains/Identity';

interface UsersManagerProps {
  token: string;
  currentUserId: string;
  canWriteUsers?: boolean;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
}

const USERS_QUERY = `
  query AdminUsersList($search: String, $systemId: ID, $status: String) {
    users(search: $search, systemId: $systemId, status: $status, limit: 100) {
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
      createdAt
      bindings {
        id
        systemId
        systemName
        systemSlug
        roleId
        roleName
      }
    }
    systems {
      id
      name
      slug
      roles {
        id
        name
      }
    }
  }
`;

export const UsersManager: React.FC<UsersManagerProps> = ({
  token,
  currentUserId,
  canWriteUsers = false,
  onNotify,
}) => {
  const [users, setUsers] = useState<IamUser[]>([]);
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [search, setSearch] = useState('');
  const [filterSystemId, setFilterSystemId] = useState('');
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IamUser | null>(null);
  const [bindingUser, setBindingUser] = useState<IamUser | null>(null);

  // Create/Edit User Form
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<'active' | 'locked'>('active');
  const [initialSystemId, setInitialSystemId] = useState('');
  const [initialRoleId, setInitialRoleId] = useState('');

  // Add Binding Form
  const [bindSystemId, setBindSystemId] = useState('');
  const [bindRoleId, setBindRoleId] = useState('');

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data } = await gqlRequest<{ users: IamUser[]; systems: IamSystem[] }>({
        token,
        query: USERS_QUERY,
        operationName: 'AdminUsersList',
        variables: {
          search: search || undefined,
          systemId: filterSystemId || undefined,
        },
      });
      setUsers(data.users);
      setSystems(data.systems);
      if (data.systems.length > 0 && !initialSystemId) {
        setInitialSystemId(data.systems[0].id);
        setInitialRoleId(data.systems[0].roles?.[0]?.id || '');
      }
      if (bindingUser) {
        const refreshed = data.users.find((u) => u.id === bindingUser.id);
        if (refreshed) setBindingUser(refreshed);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao listar usuários via GraphQL.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [token, search, filterSystemId]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setDisplayName('');
    setEmail('');
    setPassword('');
    setPhoneNumber('');
    if (systems[0]) {
      setInitialSystemId(systems[0].id);
      setInitialRoleId(systems[0].roles?.[0]?.id || '');
    }
  };

  const openEdit = (u: IamUser) => {
    setCreating(false);
    setEditing(u);
    setDisplayName(u.displayName);
    setEmail(u.email);
    setPhoneNumber(u.phoneNumber || '');
    setStatus(u.status === 'locked' ? 'locked' : 'active');
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteUsers) {
      onNotify('Permissão iam:users:write necessária para alterar usuários.', 'warning');
      return;
    }
    try {
      if (editing) {
        await gqlRequest({
          token,
          operationName: 'UpdateUser',
          query: `
            mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
              updateUser(id: $id, input: $input) { id displayName status permVersion }
            }
          `,
          variables: {
            id: editing.id,
            input: { displayName, email, phoneNumber: phoneNumber || null, status },
          },
        });
        onNotify(`Usuário ${displayName} atualizado via GraphQL.`);
      } else {
        await gqlRequest({
          token,
          operationName: 'CreateUser',
          query: `
            mutation CreateUser($input: CreateUserInput!) {
              createUser(input: $input) { id email }
            }
          `,
          variables: {
            input: {
              displayName,
              email,
              password,
              phoneNumber: phoneNumber || null,
              systemId: initialSystemId || undefined,
              roleId: initialRoleId || undefined,
            },
          },
        });
        onNotify(`Usuário ${email} criado e vinculado via GraphQL.`);
      }
      setCreating(false);
      setEditing(null);
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar usuário.');
    }
  };

  const handleDeleteUser = async (u: IamUser) => {
    if (!canWriteUsers) {
      onNotify('Permissão iam:users:write necessária para remover usuários.', 'warning');
      return;
    }
    try {
      const { data } = await gqlRequest<{ deleteUser: { success: boolean; message: string } }>({
        token,
        operationName: 'DeleteUser',
        query: `
          mutation DeleteUser($id: ID!) {
            deleteUser(id: $id) { success message }
          }
        `,
        variables: { id: u.id },
      });
      onNotify(data.deleteUser.message);
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao excluir usuário.');
    }
  };

  const handleAssignBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bindingUser || !bindSystemId || !bindRoleId) return;
    try {
      await gqlRequest({
        token,
        operationName: 'AssignBinding',
        query: `
          mutation AssignBinding($userId: ID!, $systemId: ID!, $roleId: ID!) {
            assignUserSystemRole(userId: $userId, systemId: $systemId, roleId: $roleId) { success message }
          }
        `,
        variables: { userId: bindingUser.id, systemId: bindSystemId, roleId: bindRoleId },
      });
      onNotify('Vínculo multi-sistema aplicado e versão de permissões incrementada.');
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao vincular usuário.');
    }
  };

  const handleRemoveBinding = async (bindingId: string) => {
    try {
      await gqlRequest({
        token,
        operationName: 'RemoveBinding',
        query: `
          mutation RemoveBinding($bindingId: ID!) {
            removeUserSystemBinding(bindingId: $bindingId) { success message }
          }
        `,
        variables: { bindingId },
      });
      onNotify('Vínculo removido e cache invalidado.');
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao remover vínculo.');
    }
  };

  const selectedSysForCreate = systems.find((s) => s.id === initialSystemId);
  const selectedSysForBind = systems.find((s) => s.id === bindSystemId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold text-white">Contas de Usuário</h1>
          <InfoTooltip text="CRUD completo via GraphQL com resolução em lote DataLoader (zero N+1) e versionamento instantâneo de permissões." />
        </div>
        {canWriteUsers && (
          <button
            type="button"
            onClick={openCreate}
            aria-label="Novo Usuário"
            title="Novo Usuário"
            className="relative group flex items-center justify-center p-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span
              role="tooltip"
              className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
            >
              Novo Usuário
            </span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="bg-[#111827] border border-slate-800 rounded-md px-3.5 py-2 text-xs text-white w-72 focus:outline-none focus:border-[#F6821F]"
        />
        <select
          value={filterSystemId}
          onChange={(e) => setFilterSystemId(e.target.value)}
          className="bg-[#111827] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#F6821F]"
        >
          <option value="">Todos os sistemas</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-slate-800 text-[11px] text-slate-400">
              <tr>
                <th className="py-3 px-4 font-medium">Usuário</th>
                <th className="py-3 px-4 font-medium">Sistemas e Roles</th>
                <th className="py-3 px-4 font-medium">2FA</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Ver. Perm.</th>
                <th className="py-3 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Carregando usuários via GraphQL...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/35 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{u.displayName}</div>
                      <div className="text-[11px] font-mono text-slate-400">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      {u.bindings.length === 0 ? (
                        <span className="text-slate-500">Sem vínculos</span>
                      ) : (
                        <div className="space-y-1">
                          {u.bindings.map((b) => (
                            <div key={b.id} className="text-[11px] text-slate-300 font-mono">
                              {b.systemSlug} · <span className="text-[#F6821F]">{b.roleName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                      {[u.totpEnabled ? 'TOTP' : null, u.phoneVerified ? 'SMS' : null].filter(Boolean).join(' + ') || 'Inativo'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          u.status === 'active'
                            ? 'text-emerald-400'
                            : u.status === 'locked'
                              ? 'text-amber-400'
                              : 'text-slate-400'
                        }
                      >
                        {u.status === 'active' ? 'Ativo' : u.status === 'locked' ? 'Bloqueado' : u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-400">
                      v{u.permVersion}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canWriteUsers ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setBindingUser(u);
                              if (systems[0]) {
                                setBindSystemId(systems[0].id);
                                setBindRoleId(systems[0].roles?.[0]?.id || '');
                              }
                            }}
                            title="Gerenciar Vínculos"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition-colors"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            title="Editar Usuário"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {u.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              title="Remover Usuário"
                              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">Somente leitura</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display text-base font-semibold text-white">
                {editing ? `Editar Usuário: ${editing.displayName}` : 'Novo Usuário'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nome completo</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>
              {creating && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Senha inicial</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Telefone (opcional para SMS 2FA)</label>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+55 11 99999-0000"
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>
              {editing ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Status da Conta</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'locked')}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="active">Ativo</option>
                    <option value="locked">Bloqueado</option>
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Sistema Inicial</label>
                    <select
                      value={initialSystemId}
                      onChange={(e) => {
                        const sysId = e.target.value;
                        setInitialSystemId(sysId);
                        const sys = systems.find((s) => s.id === sysId);
                        setInitialRoleId(sys?.roles?.[0]?.id || '');
                      }}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                    >
                      {systems.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Role Inicial</label>
                    <select
                      value={initialRoleId}
                      onChange={(e) => setInitialRoleId(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                    >
                      {(selectedSysForCreate?.roles || []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
                  aria-label="Cancelar"
                  title="Cancelar"
                  className="relative group flex items-center justify-center p-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                  <span
                    role="tooltip"
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
                  >
                    Cancelar
                  </span>
                </button>
                <button
                  type="submit"
                  aria-label="Salvar"
                  title="Salvar"
                  className="relative group flex items-center justify-center p-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md transition-colors"
                >
                  <Save className="w-4 h-4" />
                  <span
                    role="tooltip"
                    className="absolute bottom-full right-0 mb-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
                  >
                    Salvar
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Multi-System Bindings Modal */}
      {bindingUser && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Vínculos Multi-Sistema · {bindingUser.displayName}
                </h3>
                <p className="text-xs text-slate-400 font-mono">{bindingUser.email}</p>
              </div>
              <button type="button" onClick={() => setBindingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto">
              {bindingUser.bindings.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between px-3 py-2.5 bg-[#090D16] border border-slate-800 rounded-md text-xs"
                >
                  <div>
                    <span className="font-medium text-white">{b.systemName}</span>
                    <span className="text-slate-500 mx-2">·</span>
                    <span className="font-mono text-[#F6821F]">{b.roleName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveBinding(b.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAssignBinding} className="pt-4 border-t border-slate-800 space-y-3">
              <div className="text-xs font-medium text-slate-300">Adicionar Novo Vínculo Sistema + Role</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={bindSystemId}
                  onChange={(e) => {
                    const sid = e.target.value;
                    setBindSystemId(sid);
                    const sys = systems.find((s) => s.id === sid);
                    setBindRoleId(sys?.roles?.[0]?.id || '');
                  }}
                  className="bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                >
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={bindRoleId}
                  onChange={(e) => setBindRoleId(e.target.value)}
                  className="bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white"
                >
                  {(selectedSysForBind?.roles || []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md">
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
