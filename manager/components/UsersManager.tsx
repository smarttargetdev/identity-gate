/**
 * File: UsersManager.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Gerenciamento CRUD de usuários via GraphQL, telefones com tipos em checked combo e vínculos multi-sistema.
 * Version: 1.1.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  UserPlus,
  Edit3,
  Trash2,
  Link2,
  X,
  Save,
  Plus,
  Check,
  ChevronDown,
  Phone,
} from 'lucide-react';
import { gqlRequest } from '../libraries/GraphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { IamSystem, IamUser, PhoneType, UserPhone } from '../domains/Identity';

interface UsersManagerProps {
  token: string;
  currentUserId: string;
  canWriteUsers?: boolean;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
}

const PHONE_TYPE_OPTIONS: readonly PhoneType[] = [
  'Fixo',
  'Móvel',
  'WhatsApp',
  'Skype',
  'Residencial',
  'Comercial',
] as const;

const USERS_QUERY = `
  query AdminUsersList($search: String, $systemId: ID, $status: String) {
    users(search: $search, systemId: $systemId, status: $status, limit: 100) {
      id
      email
      loginIdentifier
      displayName
      phoneNumber
      phones {
        id
        number
        types
      }
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

interface PhoneTypeCheckedComboProps {
  id: string;
  value: PhoneType[];
  onChange: (next: PhoneType[]) => void;
  ariaLabel?: string;
}

const PhoneTypeCheckedCombo: React.FC<PhoneTypeCheckedComboProps> = ({
  id,
  value,
  onChange,
  ariaLabel = 'Selecionar tipos do telefone',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const toggleOption = (opt: PhoneType) => {
    if (value.includes(opt)) {
      onChange(value.filter((t) => t !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const summaryText =
    value.length === 0
      ? 'Selecionar tipo...'
      : value.length <= 2
        ? value.join(', ')
        : `${value[0]}, ${value[1]} +${value.length - 2}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 bg-[#090D16] border border-slate-700 hover:border-slate-500 rounded-md px-3 py-2 text-xs text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6821F]/60"
      >
        <span className={`truncate text-left ${value.length === 0 ? 'text-slate-500' : 'text-slate-100'}`}>
          {summaryText}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={id}
          className="absolute left-0 right-0 mt-1.5 z-50 min-w-[180px] bg-[#090D16] border border-slate-700/90 rounded-md shadow-2xl overflow-hidden divide-y divide-slate-800/60"
        >
          {PHONE_TYPE_OPTIONS.map((opt) => {
            const checked = value.includes(opt);
            return (
              <li key={opt} role="option" aria-selected={checked}>
                <button
                  type="button"
                  onClick={() => toggleOption(opt)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left whitespace-nowrap transition-colors ${
                    checked
                      ? 'bg-[#F6821F]/15 text-white'
                      : 'text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'bg-[#F6821F] border-[#F6821F] text-slate-950'
                        : 'bg-[#111827] border-slate-600'
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span>{opt}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

function makeLocalPhoneId(): string {
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

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
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'active' | 'locked' | 'anonymized'>('active');
  const [phones, setPhones] = useState<UserPhone[]>([]);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newPhoneTypes, setNewPhoneTypes] = useState<PhoneType[]>(['Móvel']);
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [editingPhoneNumber, setEditingPhoneNumber] = useState('');
  const [editingPhoneTypes, setEditingPhoneTypes] = useState<PhoneType[]>(['Móvel']);
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
      onNotify(err instanceof Error ? err.message : 'Erro ao listar usuários via GraphQL.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [token, search, filterSystemId]);

  const resetPhoneDraftControls = () => {
    setNewPhoneNumber('');
    setNewPhoneTypes(['Móvel']);
    setEditingPhoneId(null);
    setEditingPhoneNumber('');
    setEditingPhoneTypes(['Móvel']);
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setDisplayName('');
    setLoginIdentifier('');
    setEmail('');
    setPassword('');
    setStatus('active');
    setPhones([]);
    resetPhoneDraftControls();
    if (systems[0]) {
      setInitialSystemId(systems[0].id);
      setInitialRoleId(systems[0].roles?.[0]?.id || '');
    }
  };

  const openEdit = (u: IamUser) => {
    setCreating(false);
    setEditing(u);
    setDisplayName(u.displayName);
    setLoginIdentifier(u.loginIdentifier || u.email.split('@')[0] || '');
    setEmail(u.email);
    setStatus(u.status);
    const existingPhones: UserPhone[] =
      u.phones && u.phones.length > 0
        ? u.phones.map((p) => ({
            id: p.id,
            number: p.number,
            types: (p.types && p.types.length > 0 ? p.types : ['Móvel']) as PhoneType[],
          }))
        : u.phoneNumber
          ? [{ id: `ph-${u.id}`, number: u.phoneNumber, types: ['Móvel'] }]
          : [];
    setPhones(existingPhones);
    resetPhoneDraftControls();
  };

  const handleAddPhoneItem = () => {
    const cleanNum = newPhoneNumber.trim();
    if (!cleanNum) {
      onNotify('Informe o número ou contato do telefone antes de adicionar.', 'warning');
      return;
    }
    if (newPhoneTypes.length === 0) {
      onNotify('Selecione ao menos um tipo para o telefone.', 'warning');
      return;
    }
    setPhones((prev) => [
      ...prev,
      {
        id: makeLocalPhoneId(),
        number: cleanNum,
        types: [...newPhoneTypes],
      },
    ]);
    setNewPhoneNumber('');
    setNewPhoneTypes(['Móvel']);
  };

  const startEditPhoneItem = (item: UserPhone) => {
    setEditingPhoneId(item.id);
    setEditingPhoneNumber(item.number);
    setEditingPhoneTypes(item.types.length > 0 ? [...item.types] : ['Móvel']);
  };

  const commitEditPhoneItem = () => {
    if (!editingPhoneId) return;
    const cleanNum = editingPhoneNumber.trim();
    if (!cleanNum) {
      onNotify('O número/contato do telefone não pode ficar vazio.', 'warning');
      return;
    }
    if (editingPhoneTypes.length === 0) {
      onNotify('Selecione ao menos um tipo para o telefone.', 'warning');
      return;
    }
    setPhones((prev) =>
      prev.map((p) =>
        p.id === editingPhoneId ? { ...p, number: cleanNum, types: [...editingPhoneTypes] } : p
      )
    );
    setEditingPhoneId(null);
    setEditingPhoneNumber('');
    setEditingPhoneTypes(['Móvel']);
  };

  const handleDeletePhoneItem = (phoneId: string) => {
    setPhones((prev) => prev.filter((p) => p.id !== phoneId));
    if (editingPhoneId === phoneId) {
      setEditingPhoneId(null);
      setEditingPhoneNumber('');
      setEditingPhoneTypes(['Móvel']);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteUsers) {
      onNotify('Permissão iam:users:write necessária para alterar usuários.', 'warning');
      return;
    }

    let finalPhones = [...phones];
    if (editingPhoneId && editingPhoneNumber.trim()) {
      finalPhones = finalPhones.map((p) =>
        p.id === editingPhoneId
          ? {
              ...p,
              number: editingPhoneNumber.trim(),
              types: editingPhoneTypes.length > 0 ? editingPhoneTypes : ['Móvel'],
            }
          : p
      );
    }
    if (newPhoneNumber.trim()) {
      finalPhones.push({
        id: makeLocalPhoneId(),
        number: newPhoneNumber.trim(),
        types: newPhoneTypes.length > 0 ? newPhoneTypes : ['Móvel'],
      });
    }

    const phonesInput = finalPhones.map((p) => ({
      id: p.id,
      number: p.number.trim(),
      types: p.types,
    }));

    try {
      if (editing) {
        await gqlRequest({
          token,
          operationName: 'UpdateUser',
          query: `
            mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
              updateUser(id: $id, input: $input) {
                id
                displayName
                loginIdentifier
                email
                status
                permVersion
                phones { id number types }
              }
            }
          `,
          variables: {
            id: editing.id,
            input: {
              displayName: displayName.trim(),
              loginIdentifier: loginIdentifier.trim().toLowerCase(),
              email: email.trim().toLowerCase(),
              phones: phonesInput,
              status,
            },
          },
        });
        onNotify(`Usuário ${displayName.trim()} atualizado via GraphQL.`);
      } else {
        await gqlRequest({
          token,
          operationName: 'CreateUser',
          query: `
            mutation CreateUser($input: CreateUserInput!) {
              createUser(input: $input) {
                id
                email
                loginIdentifier
                phones { id number types }
              }
            }
          `,
          variables: {
            input: {
              displayName: displayName.trim(),
              loginIdentifier: loginIdentifier.trim().toLowerCase(),
              email: email.trim().toLowerCase(),
              password,
              status: status === 'locked' ? 'locked' : 'active',
              phones: phonesInput,
              systemId: initialSystemId || undefined,
              roleId: initialRoleId || undefined,
            },
          },
        });
        onNotify(`Usuário ${email.trim()} criado e vinculado via GraphQL.`);
      }
      setCreating(false);
      setEditing(null);
      await loadUsers();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar usuário.', 'error');
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
      onNotify(err instanceof Error ? err.message : 'Erro ao excluir usuário.', 'error');
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
      onNotify(err instanceof Error ? err.message : 'Erro ao vincular usuário.', 'error');
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
      onNotify(err instanceof Error ? err.message : 'Erro ao remover vínculo.', 'error');
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
          placeholder="Buscar por nome, login ou e-mail..."
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
                <th className="py-3 px-4 font-medium">Telefones</th>
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
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Carregando usuários via GraphQL...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const userPhones =
                    u.phones && u.phones.length > 0
                      ? u.phones
                      : u.phoneNumber
                        ? [{ id: `ph-${u.id}`, number: u.phoneNumber, types: ['Móvel'] as PhoneType[] }]
                        : [];
                  return (
                    <tr key={u.id} className="hover:bg-slate-800/35 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{u.displayName}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {u.loginIdentifier} <span aria-hidden="true">·</span> {u.email}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {userPhones.length === 0 ? (
                          <span className="text-slate-500">Nenhum</span>
                        ) : (
                          <div className="space-y-1">
                            {userPhones.map((ph) => (
                              <div key={ph.id} className="text-[11px] font-mono tabular-nums text-slate-300">
                                <span>{ph.number}</span>
                                <span className="text-slate-500 font-sans ml-1.5">
                                  ({ph.types.join(' · ')})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
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
                        {[u.totpEnabled ? 'TOTP' : null, u.phoneVerified ? 'SMS' : null].filter(Boolean).join(' + ') ||
                          'Inativo'}
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
                          {u.status === 'active'
                            ? 'Ativo'
                            : u.status === 'locked'
                              ? 'Bloqueado'
                              : 'Anonimizado'}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-2xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 space-y-5 my-auto">
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
                aria-label="Fechar janela"
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="user-display-name" className="block text-xs font-medium text-slate-300 mb-1">
                    Nome Completo
                  </label>
                  <input
                    id="user-display-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ex: Maria Clara Silva"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
                  />
                </div>

                <div>
                  <label htmlFor="user-login-identifier" className="block text-xs font-medium text-slate-300 mb-1">
                    Identificador de Login
                  </label>
                  <input
                    id="user-login-identifier"
                    type="text"
                    required
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value.replace(/\s+/g, ''))}
                    placeholder="Ex: maria.silva"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#F6821F]"
                  />
                </div>

                <div>
                  <label htmlFor="user-email" className="block text-xs font-medium text-slate-300 mb-1">
                    Endereço de Email
                  </label>
                  <input
                    id="user-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@empresa.com.br"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
                  />
                </div>

                <div>
                  <label htmlFor="user-account-status" className="block text-xs font-medium text-slate-300 mb-1">
                    Status da Conta
                  </label>
                  <select
                    id="user-account-status"
                    value={status}
                    disabled={status === 'anonymized'}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'locked')}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F] disabled:opacity-60"
                  >
                    <option value="active">Ativo</option>
                    <option value="locked">Bloqueado</option>
                    {status === 'anonymized' && <option value="anonymized">Anonimizado</option>}
                  </select>
                </div>
              </div>

              {creating && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label htmlFor="user-password" className="block text-xs font-medium text-slate-300 mb-1">
                      Senha Inicial
                    </label>
                    <input
                      id="user-password"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
                    />
                  </div>
                  <div>
                    <label htmlFor="user-init-system" className="block text-xs font-medium text-slate-300 mb-1">
                      Sistema Inicial
                    </label>
                    <select
                      id="user-init-system"
                      value={initialSystemId}
                      onChange={(e) => {
                        const sysId = e.target.value;
                        setInitialSystemId(sysId);
                        const sys = systems.find((s) => s.id === sysId);
                        setInitialRoleId(sys?.roles?.[0]?.id || '');
                      }}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
                    >
                      {systems.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="user-init-role" className="block text-xs font-medium text-slate-300 mb-1">
                      Role Inicial
                    </label>
                    <select
                      id="user-init-role"
                      value={initialRoleId}
                      onChange={(e) => setInitialRoleId(e.target.value)}
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F6821F]"
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

              {/* Telefones do Usuário (Array CRUD + Checked Combo Tipo) */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-[#F6821F]" />
                    <span className="text-xs font-medium text-slate-200">Telefones</span>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {phones.length} item{phones.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Add New Phone Item Row */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
                  <div>
                    <label htmlFor="new-phone-number" className="block text-[11px] text-slate-400 mb-1">
                      Número / Contato
                    </label>
                    <input
                      id="new-phone-number"
                      type="text"
                      value={newPhoneNumber}
                      onChange={(e) => setNewPhoneNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddPhoneItem();
                        }
                      }}
                      placeholder="+55 11 99999-0000 ou usuario.skype"
                      className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#F6821F]"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-phone-type-combo" className="block text-[11px] text-slate-400 mb-1">
                      Tipo
                    </label>
                    <PhoneTypeCheckedCombo
                      id="new-phone-type-combo"
                      value={newPhoneTypes}
                      onChange={setNewPhoneTypes}
                      ariaLabel="Tipo do novo telefone"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPhoneItem}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#F6821F]" />
                    <span>Adicionar</span>
                  </button>
                </div>

                {/* Phone Items List */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                  {phones.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-500 border border-dashed border-slate-800 rounded-md text-center">
                      Nenhum telefone adicionado. Preencha o número, marque os tipos e clique em Adicionar.
                    </div>
                  ) : (
                    phones.map((item) => {
                      const isEditingItem = editingPhoneId === item.id;
                      if (isEditingItem) {
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-2 items-center p-2.5 bg-[#090D16] border border-[#F6821F]/60 rounded-md"
                          >
                            <input
                              type="text"
                              value={editingPhoneNumber}
                              onChange={(e) => setEditingPhoneNumber(e.target.value)}
                              aria-label="Editar número do telefone"
                              className="w-full bg-[#111827] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#F6821F]"
                            />
                            <PhoneTypeCheckedCombo
                              id={`edit-phone-type-${item.id}`}
                              value={editingPhoneTypes}
                              onChange={setEditingPhoneTypes}
                              ariaLabel="Editar tipos do telefone"
                            />
                            <div className="flex items-center justify-end gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={commitEditPhoneItem}
                                title="Confirmar edição do telefone"
                                aria-label="Confirmar edição do telefone"
                                className="p-1.5 rounded bg-[#F6821F] hover:bg-[#e27316] text-slate-950 transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPhoneId(null)}
                                title="Cancelar edição do telefone"
                                aria-label="Cancelar edição do telefone"
                                className="p-1.5 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 bg-[#090D16] border border-slate-800 rounded-md text-xs"
                        >
                          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono tabular-nums text-white">{item.number}</span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="text-slate-400">{item.types.join(' · ')}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startEditPhoneItem(item)}
                              title="Editar telefone"
                              aria-label={`Editar telefone ${item.number}`}
                              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePhoneItem(item.id)}
                              title="Excluir telefone"
                              aria-label={`Excluir telefone ${item.number}`}
                              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
                  aria-label="Cancelar"
                  title="Cancelar"
                  className="px-4 py-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700 rounded-md transition-colors whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  aria-label="Salvar"
                  title="Salvar"
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md transition-colors whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar</span>
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
                <p className="text-xs text-slate-400 font-mono">
                  {bindingUser.loginIdentifier} · {bindingUser.email}
                </p>
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
