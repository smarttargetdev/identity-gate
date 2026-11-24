import React, { useEffect, useState } from 'react';
import { Plus, Edit3, Trash2, Key, ShieldCheck, X } from 'lucide-react';
import { gqlRequest } from '../lib/graphqlClient';
import { InfoTooltip } from './InfoTooltip';
import type { IamSystem } from '../types/iam';

interface IdentifierConfig {
  systemIdPrefix: string;
  clientIdPrefix: string;
  normalizeIdentifiers: boolean;
  systemIdSeparator: '_' | '-';
  clientIdSeparator: '_' | '-';
}

interface SystemsManagerProps {
  token: string;
  canWriteSystems?: boolean;
  identifierConfig?: IdentifierConfig;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'warning') => void;
  onSystemsChanged: () => void;
}

const SYSTEMS_QUERY = `
  query AdminSystemsList {
    systems {
      id
      name
      slug
      description
      clientId
      redirectUris
      allowedGrants
      allowedIdps
      jwtTtlSeconds
      signingAlg
      requireMfa
      allowedMfaMethods
      passwordMinLength
      edgeCacheTtl
      policyVersion
      privacyPolicyVersion
      status
      userCount
      updatedAt
    }
  }
`;

export const SystemsManager: React.FC<SystemsManagerProps> = ({
  token,
  canWriteSystems = false,
  identifierConfig = {
    systemIdPrefix: 'system',
    clientIdPrefix: 'client',
    normalizeIdentifiers: true,
    systemIdSeparator: '-',
    clientIdSeparator: '_',
  },
  onNotify,
  onSystemsChanged,
}) => {
  const [systems, setSystems] = useState<IamSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<IamSystem | null>(null);
  const [creating, setCreating] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<{ clientId: string; newClientSecret: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [redirectUrisText, setRedirectUrisText] = useState('http://localhost:3000/oauth/sandbox');
  const [jwtTtlSeconds, setJwtTtlSeconds] = useState(3600);
  const [signingAlg, setSigningAlg] = useState<'RS256' | 'HS256'>('RS256');
  const [requireMfa, setRequireMfa] = useState(false);
  const [edgeCacheTtl, setEdgeCacheTtl] = useState(120);
  const [privacyPolicyVersion, setPrivacyPolicyVersion] = useState('2026.1');
  const [allowedIdps, setAllowedIdps] = useState<string[]>(['google', 'github', 'oidc_generic']);
  const [status, setStatus] = useState<'active' | 'disabled'>('active');

  const fetchSystems = async () => {
    setLoading(true);
    try {
      const { data } = await gqlRequest<{ systems: IamSystem[] }>({
        token,
        query: SYSTEMS_QUERY,
        operationName: 'AdminSystemsList',
      });
      setSystems(data.systems);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao listar sistemas via GraphQL.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSystems();
  }, [token]);

  const openCreateModal = () => {
    setEditing(null);
    setCreating(true);
    setName('');
    setSlug('');
    setDescription('');
    setRedirectUrisText('http://localhost:3000/oauth/sandbox');
    setJwtTtlSeconds(3600);
    setSigningAlg('RS256');
    setRequireMfa(false);
    setEdgeCacheTtl(120);
    setPrivacyPolicyVersion('2026.1');
    setAllowedIdps(['google', 'github', 'oidc_generic', 'entra_saml']);
    setStatus('active');
  };

  const openEditModal = (sys: IamSystem) => {
    setCreating(false);
    setEditing(sys);
    setName(sys.name);
    setSlug(sys.slug);
    setDescription(sys.description);
    setRedirectUrisText(sys.redirectUris.join('\n'));
    setJwtTtlSeconds(sys.jwtTtlSeconds);
    setSigningAlg(sys.signingAlg);
    setRequireMfa(sys.requireMfa);
    setEdgeCacheTtl(sys.edgeCacheTtl);
    setPrivacyPolicyVersion(sys.privacyPolicyVersion);
    setAllowedIdps(sys.allowedIdps);
    setStatus(sys.status);
  };

  const sysSep = identifierConfig.systemIdSeparator === '-' ? '-' : '_';
  const cliSep = identifierConfig.clientIdSeparator === '-' ? '-' : '_';
  const formatToken = (val: string, sep: '_' | '-') =>
    identifierConfig.normalizeIdentifiers
      ? val.trim().replace(/[^a-zA-Z0-9]+/g, sep).replace(new RegExp(`^[${sep}]+|[${sep}]+$`, 'g'), '')
      : val.trim().replace(/[^a-zA-Z0-9_-]/g, '');

  const cleanSysPrefix = formatToken(identifierConfig.systemIdPrefix, sysSep).replace(/[-_]+$/g, '') || 'system';
  const cleanCliPrefix = formatToken(identifierConfig.clientIdPrefix, cliSep).replace(/[-_]+$/g, '') || 'client';
  const sysSlugPart = formatToken(slug, sysSep).replace(/^[-_]+/g, '');
  const cliSlugPart = formatToken(slug, cliSep).replace(/^[-_]+/g, '');
  const systemIdentity = editing
    ? editing.id
    : sysSlugPart
      ? `${cleanSysPrefix}${sysSep}${sysSlugPart}`
      : `${cleanSysPrefix}${sysSep}{SLUG}`;
  const systemClientId = editing
    ? editing.clientId
    : cliSlugPart
      ? `${cleanCliPrefix}${cliSep}${cliSlugPart}`
      : `${cleanCliPrefix}${cliSep}{SLUG}`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteSystems) {
      onNotify('Permissão iam:systems:write necessária para alterar sistemas.', 'warning');
      return;
    }
    const redirectUris = redirectUrisText
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);

    const input = {
      name,
      slug,
      description,
      redirectUris,
      allowedIdps,
      jwtTtlSeconds: Number(jwtTtlSeconds),
      signingAlg,
      requireMfa,
      edgeCacheTtl: Number(edgeCacheTtl),
      privacyPolicyVersion,
      status,
    };

    try {
      if (editing) {
        await gqlRequest({
          token,
          operationName: 'UpdateSystem',
          query: `
            mutation UpdateSystem($id: ID!, $input: SystemInput!) {
              updateSystem(id: $id, input: $input) { id name policyVersion }
            }
          `,
          variables: { id: editing.id, input },
        });
        onNotify(`Sistema "${name}" atualizado via GraphQL e políticas na borda versionadas.`);
      } else {
        await gqlRequest({
          token,
          operationName: 'CreateSystem',
          query: `
            mutation CreateSystem($input: SystemInput!) {
              createSystem(input: $input) { id name clientId }
            }
          `,
          variables: {
            input: {
              ...input,
              id: systemIdentity,
              clientId: systemClientId,
            },
          },
        });
        onNotify(`Sistema OAuth 2.0 "${name}" criado via GraphQL.`);
      }
      setEditing(null);
      setCreating(false);
      await fetchSystems();
      onSystemsChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao salvar sistema.');
    }
  };

  const handleDelete = async (sys: IamSystem) => {
    if (!canWriteSystems) {
      onNotify('Permissão iam:systems:write necessária para remover sistemas.', 'warning');
      return;
    }
    try {
      const { data } = await gqlRequest<{ deleteSystem: { success: boolean; message: string } }>({
        token,
        operationName: 'DeleteSystem',
        query: `
          mutation DeleteSystem($id: ID!) {
            deleteSystem(id: $id) { success message }
          }
        `,
        variables: { id: sys.id },
      });
      onNotify(data.deleteSystem.message);
      await fetchSystems();
      onSystemsChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao remover sistema.');
    }
  };

  const handleRotateSecret = async (sys: IamSystem) => {
    if (!canWriteSystems) {
      onNotify('Permissão iam:systems:write necessária para rotacionar secrets.', 'warning');
      return;
    }
    try {
      const { data } = await gqlRequest<{
        rotateSystemSecret: { systemId: string; clientId: string; newClientSecret: string };
      }>({
        token,
        operationName: 'RotateSystemSecret',
        query: `
          mutation RotateSystemSecret($id: ID!) {
            rotateSystemSecret(id: $id) { systemId clientId newClientSecret }
          }
        `,
        variables: { id: sys.id },
      });
      setRotatedSecret(data.rotateSystemSecret);
      onNotify(`Secret OAuth 2.0 rotacionado para ${sys.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao rotacionar secret.');
    }
  };

  const toggleIdp = (idp: string) => {
    setAllowedIdps((prev) => (prev.includes(idp) ? prev.filter((x) => x !== idp) : [...prev, idp]));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold text-white">Sistemas Gerenciados</h1>
          <InfoTooltip text="Gerenciamento via GraphQL de aplicações clientes, TTL de JWT, 2FA obrigatório e cache distribuído por sistema." />
        </div>
        {canWriteSystems && (
          <button
            type="button"
            onClick={openCreateModal}
            aria-label="Criar novo sistema"
            title="Criar novo sistema"
            className="relative group flex items-center justify-center p-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span
              role="tooltip"
              className="absolute top-full right-0 mt-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
            >
              Criar novo sistema
            </span>
          </button>
        )}
      </div>

      {/* Systems Table */}

      <div className="bg-[#111827] border border-slate-800/90 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-slate-800 text-[11px] text-slate-400">
              <tr>
                <th className="py-3 px-4 font-medium">Nome</th>
                <th className="py-3 px-4 font-medium">Identificador</th>
                <th className="py-3 px-4 font-medium" title="chave">Sistema</th>
                <th className="py-3 px-4 font-medium">Cliente</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Policiamento</th>
                <th className="py-3 px-4 font-medium">Algorítmo</th>
                <th className="py-3 px-4 font-medium">Expiração</th>
                <th className="py-3 px-4 font-medium">Segurança</th>
                <th className="py-3 px-4 font-medium">Cache</th>
                <th className="py-3 px-4 font-medium text-right">Usuários</th>
                <th className="py-3 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-slate-500">
                    Consultando sistemas via GraphQL...
                  </td>
                </tr>
              ) : (
                systems.map((sys) => (
                  <tr key={sys.id} className="hover:bg-slate-800/35 transition-colors">
                    <td className="py-3 px-4 font-medium text-white whitespace-nowrap">{sys.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">{sys.slug}</td>
                    <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap" title="chave">
                      {sys.id}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">{sys.clientId}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={
                          sys.status === 'active'
                            ? 'text-emerald-400 font-medium'
                            : 'text-red-400 font-medium'
                        }
                      >
                        {sys.status === 'active' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                      v{sys.policyVersion}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">{sys.signingAlg}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                      {sys.jwtTtlSeconds}s
                    </td>
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <span
                          tabIndex={0}
                          aria-label={sys.requireMfa ? 'Obrigatório' : 'Opcional'}
                          title={sys.requireMfa ? 'Obrigatório' : 'Opcional'}
                          className="relative group inline-flex items-center justify-center focus:outline-none"
                        >
                          <ShieldCheck
                            className={`w-4 h-4 ${sys.requireMfa ? 'text-amber-400' : 'text-slate-500'}`}
                          />
                          <span
                            role="tooltip"
                            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-40 px-2 py-1 rounded-md bg-[#090D16] border border-slate-700/90 text-[11px] font-medium text-slate-200 shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
                          >
                            {sys.requireMfa ? 'Obrigatório' : 'Opcional'}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          {sys.allowedMfaMethods && sys.allowedMfaMethods.length > 0
                            ? sys.allowedMfaMethods.map((m) => m.toUpperCase()).join(', ')
                            : 'Nenhum'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {sys.edgeCacheTtl}s
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      {sys.userCount ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canWriteSystems ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRotateSecret(sys)}
                            title="Rotacionar Client Secret"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(sys)}
                            title="Editar Sistema"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {sys.id !== 'identity-secure-gate' && (
                            <button
                              type="button"
                              onClick={() => handleDelete(sys)}
                              title="Remover Sistema"
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

      {/* Create / Edit Modal */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-[#111827] border border-slate-700 rounded-lg p-6 max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-display text-base font-semibold text-white">
                {editing ? `Editar Sistema: ${editing.name}` : 'Criar Sistema'}
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

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: Portal Parceiros"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Identificador</label>
                  <input
                    type="text"
                    required
                    pattern="[A-Za-z0-9_-]+"
                    title="Apenas caracteres alfanuméricos, '-' e '_'"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    placeholder="ex: partners-portal"
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Sistema</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={systemIdentity}
                    className="w-full bg-[#090D16]/60 border border-slate-800 rounded-md px-3 py-2 text-sm font-mono text-slate-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Cliente</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={systemClientId}
                    className="w-full bg-[#090D16]/60 border border-slate-800 rounded-md px-3 py-2 text-sm font-mono text-slate-400 cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Expiração JWT (segundos)</label>
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    required
                    value={jwtTtlSeconds}
                    onChange={(e) => setJwtTtlSeconds(Number(e.target.value))}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono tabular-nums text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Algoritmo JWT</label>
                  <select
                    value={signingAlg}
                    onChange={(e) => setSigningAlg(e.target.value as 'RS256' | 'HS256')}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="RS256">RS256 (Assimétrico + JWKS)</option>
                    <option value="HS256">HS256 (HMAC Borda)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Edge Cache TTL (seg)</label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    required
                    value={edgeCacheTtl}
                    onChange={(e) => setEdgeCacheTtl(Number(e.target.value))}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono tabular-nums text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Versão Política LGPD/GDPR</label>
                  <input
                    type="text"
                    value={privacyPolicyVersion}
                    onChange={(e) => setPrivacyPolicyVersion(e.target.value)}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}
                    className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="active">Ativo</option>
                    <option value="disabled">Desativado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Redirect URIs (uma por linha)</label>
                <textarea
                  rows={2}
                  value={redirectUrisText}
                  onChange={(e) => setRedirectUrisText(e.target.value)}
                  className="w-full bg-[#090D16] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireMfa}
                    onChange={(e) => setRequireMfa(e.target.checked)}
                    className="rounded border-slate-700 bg-[#090D16] text-[#F6821F]"
                  />
                  <span>Exigir 2FA (TOTP/SMS) após login neste sistema</span>
                </label>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">IdPs:</span>
                  {['google', 'github', 'oidc_generic', 'entra_saml'].map((idp) => (
                    <button
                      key={idp}
                      type="button"
                      onClick={() => toggleIdp(idp)}
                      className={`px-2 py-1 rounded border text-[11px] font-mono ${
                        allowedIdps.includes(idp)
                          ? 'bg-[#F6821F]/15 border-[#F6821F] text-white'
                          : 'bg-[#090D16] border-slate-800 text-slate-500'
                      }`}
                    >
                      {idp}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
                  className="px-4 py-2 text-xs text-slate-300 border border-slate-700 rounded-md"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
                >
                  {editing ? 'Salvar' : 'Criar Sistema'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rotated Client Secret Modal */}
      {rotatedSecret && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#111827] border border-amber-600/60 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <h3 className="font-display text-base font-semibold text-white">
                  Novo Client Secret Gerado (Exibição Única)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRotatedSecret(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Armazene este segredo em local seguro agora. Por segurança, o hash é salvo no banco e o valor completo não poderá ser exibido novamente.
            </p>
            <div className="bg-[#090D16] border border-slate-800 rounded-md p-3.5 space-y-2 text-xs font-mono">
              <div className="text-slate-400">
                client_id: <span className="text-white">{rotatedSecret.clientId}</span>
              </div>
              <div className="text-slate-400 break-all">
                client_secret: <span className="text-amber-300">{rotatedSecret.newClientSecret}</span>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setRotatedSecret(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#F6821F] text-slate-950 rounded-md"
              >
                Entendi e Copiei
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
