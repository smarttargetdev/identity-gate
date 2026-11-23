import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SystemRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  client_id: string;
  client_secret_hash: string;
  redirect_uris: string; // JSON array
  allowed_grants: string; // JSON array
  allowed_idps: string; // JSON array
  jwt_ttl_seconds: number;
  signing_alg: 'RS256' | 'HS256';
  hs256_secret: string;
  require_mfa: number;
  allowed_mfa_methods: string; // JSON array: ['totp','sms']
  password_min_length: number;
  edge_cache_ttl: number;
  policy_version: number;
  privacy_policy_version: string;
  status: 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  phone_number: string | null;
  phone_verified: number;
  mfa_preferred_method: 'totp' | 'sms' | 'none';
  totp_secret_enc: string | null;
  totp_enabled: number;
  backup_codes_hash: string | null; // JSON array of sha256 hashes
  status: 'active' | 'locked' | 'anonymized';
  perm_version: number;
  last_login_at: string | null;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  id: string;
  system_id: string;
  name: string;
  description: string;
  is_default: number;
  created_at: string;
}

export interface PermissionRow {
  id: string;
  system_id: string;
  code: string;
  description: string;
  created_at: string;
}

export interface CustomClaimRow {
  id: string;
  role_id: string;
  claim_key: string;
  claim_value: string;
  value_type: 'string' | 'number' | 'boolean' | 'json';
}

export interface UserSystemBindingRow {
  id: string;
  user_id: string;
  system_id: string;
  role_id: string;
  created_at: string;
}

export interface IdentityProviderRow {
  id: string;
  name: string;
  provider_type: 'google' | 'github' | 'oidc_generic' | 'entra_saml';
  issuer_url: string;
  auth_url: string;
  token_url: string;
  userinfo_url: string;
  client_id: string;
  scopes: string;
  simulation_mode: number;
  enabled: number;
  metadata_json: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  trace_id: string;
  actor_hash: string;
  actor_masked: string;
  system_id: string | null;
  system_slug: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  status: 'success' | 'denied' | 'error';
  cache_status: string;
  duration_ms: number;
  ip_masked: string;
  details_json: string;
  created_at: string;
}

export interface SystemErrorLogRow {
  id: string;
  trace_id: string;
  error_name: string;
  message: string;
  stack_trace: string;
  source: string;
  operation_or_route: string;
  http_method: string;
  status_code: number;
  actor_masked: string;
  system_slug: string | null;
  metadata_json: string;
  created_at: string;
}

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
  : path.join(dataDir, 'identity-gate.sqlite');

export const db = new Database(dbPath);

// SQLite Read-Heavy / Low-Write Edge Optimization
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64 MB page cache
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456'); // 256 MB mmap for ultra-fast reads
db.pragma('foreign_keys = ON');

export const dbStats = {
  totalReads: 0,
  totalWrites: 0,
  batchedFlushes: 0,
  queuedAuditLogs: 0,
};

export const D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  allowed_grants TEXT NOT NULL DEFAULT '["authorization_code","password","refresh_token"]',
  allowed_idps TEXT NOT NULL DEFAULT '["google","github","oidc_generic","entra_saml"]',
  jwt_ttl_seconds INTEGER NOT NULL DEFAULT 3600,
  signing_alg TEXT NOT NULL DEFAULT 'RS256',
  hs256_secret TEXT NOT NULL,
  require_mfa INTEGER NOT NULL DEFAULT 0,
  allowed_mfa_methods TEXT NOT NULL DEFAULT '["totp","sms"]',
  password_min_length INTEGER NOT NULL DEFAULT 8,
  edge_cache_ttl INTEGER NOT NULL DEFAULT 120,
  policy_version INTEGER NOT NULL DEFAULT 1,
  privacy_policy_version TEXT NOT NULL DEFAULT '2026.1',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone_number TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  mfa_preferred_method TEXT NOT NULL DEFAULT 'none',
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  backup_codes_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  perm_version INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  anonymized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL UNIQUE,
  issuer_url TEXT NOT NULL,
  auth_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  userinfo_url TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT 'openid email profile',
  simulation_mode INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  external_subject TEXT NOT NULL,
  external_email TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(provider_type, external_subject)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  UNIQUE(system_id, name)
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  UNIQUE(system_id, code)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_claims (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  claim_value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE(role_id, claim_key)
);

CREATE TABLE IF NOT EXISTS user_system_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  system_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE(user_id, system_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  system_id TEXT NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL,
  ip_masked TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  system_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  auth_method TEXT NOT NULL DEFAULT 'pwd',
  mfa_verified INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  system_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  oauth_code TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS sms_otps (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  system_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  purposes_json TEXT NOT NULL DEFAULT '["authentication","security_audit"]',
  granted INTEGER NOT NULL DEFAULT 1,
  ip_masked TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (system_id) REFERENCES systems(id) ON DELETE CASCADE,
  UNIQUE(user_id, system_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  actor_masked TEXT NOT NULL,
  system_id TEXT,
  system_slug TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL,
  cache_status TEXT NOT NULL DEFAULT 'BYPASS',
  duration_ms REAL NOT NULL DEFAULT 0,
  ip_masked TEXT NOT NULL DEFAULT '0.0.x.x',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
  kv_key TEXT PRIMARY KEY,
  kv_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_health_events (
  id TEXT PRIMARY KEY,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  max_latency_ms REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_error_logs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  error_name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'server',
  operation_or_route TEXT NOT NULL DEFAULT '',
  http_method TEXT NOT NULL DEFAULT '',
  status_code INTEGER NOT NULL DEFAULT 500,
  actor_masked TEXT NOT NULL DEFAULT 'system',
  system_slug TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- Covering & Composite Indexes for Read-Heavy IAM & GraphQL Batching
CREATE INDEX IF NOT EXISTS idx_systems_slug ON systems(slug);
CREATE INDEX IF NOT EXISTS idx_systems_client ON systems(client_id);
CREATE INDEX IF NOT EXISTS idx_users_email_status ON users(email, status);
CREATE INDEX IF NOT EXISTS idx_bindings_user_sys ON user_system_bindings(user_id, system_id, role_id);
CREATE INDEX IF NOT EXISTS idx_bindings_sys_user ON user_system_bindings(system_id, user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_roles_sys ON roles(system_id, id, name);
CREATE INDEX IF NOT EXISTS idx_perms_sys ON permissions(system_id, id, code);
CREATE INDEX IF NOT EXISTS idx_role_perms_role ON role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_claims_role ON custom_claims(role_id, claim_key, claim_value);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_sys ON audit_logs(system_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_user_sys ON consent_records(user_id, system_id);
CREATE INDEX IF NOT EXISTS idx_health_events_created ON system_health_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON system_error_logs(created_at DESC);
`;

db.exec(D1_SCHEMA_SQL);

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex');
}

// Batched asynchronous audit log writer to avoid blocking read-heavy paths
const auditQueue: AuditLogRow[] = [];
let auditBatchSize = 20;

export function setAuditBatchSize(size: number): void {
  const normalized = Math.max(1, Math.min(100, Math.floor(size)));
  auditBatchSize = normalized;
}

const insertAuditStmt = db.prepare(`
  INSERT INTO audit_logs (
    id, trace_id, actor_hash, actor_masked, system_id, system_slug,
    action, resource_type, resource_id, status, cache_status,
    duration_ms, ip_masked, details_json, created_at
  ) VALUES (
    @id, @trace_id, @actor_hash, @actor_masked, @system_id, @system_slug,
    @action, @resource_type, @resource_id, @status, @cache_status,
    @duration_ms, @ip_masked, @details_json, @created_at
  )
`);

const flushAuditTransaction = db.transaction((rows: AuditLogRow[]) => {
  for (const row of rows) {
    insertAuditStmt.run(row);
  }
});

export function flushAuditQueue(): void {
  if (auditQueue.length === 0) return;
  const batch = auditQueue.splice(0, auditQueue.length);
  flushAuditTransaction(batch);
  dbStats.totalWrites += batch.length;
  dbStats.batchedFlushes += 1;
  dbStats.queuedAuditLogs = 0;
}

export function queueAuditLog(entry: AuditLogRow): void {
  auditQueue.push(entry);
  dbStats.queuedAuditLogs = auditQueue.length;
  if (auditQueue.length >= auditBatchSize) {
    flushAuditQueue();
  }
}

setInterval(() => {
  try {
    flushAuditQueue();
  } catch {
    // Prevent background flush errors from crashing process
  }
}, 400).unref();

export function seedInitialData(): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM systems').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date().toISOString();

  const insertSystem = db.prepare(`
    INSERT INTO systems (
      id, name, slug, description, client_id, client_secret_hash, redirect_uris,
      allowed_grants, allowed_idps, jwt_ttl_seconds, signing_alg, hs256_secret,
      require_mfa, allowed_mfa_methods, password_min_length, edge_cache_ttl,
      policy_version, privacy_policy_version, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sysCoreId = 'identity-secure-gate';
  const sysPayId = 'sys-edgepay-gw';
  const sysAtlasId = 'sys-atlas-bi';

  insertSystem.run(
    sysCoreId,
    'Identity Secure Gate',
    'secure-gate',
    'Painel principal de governanca IAM, emissao de tokens e gestao multi-sistema.',
    'cid_secure_gate',
    sha256('csec_vektor_core_demo_secret'),
    JSON.stringify(['https://vektor.edge.local/callback', 'http://localhost:3000/oauth/sandbox']),
    JSON.stringify(['authorization_code', 'password', 'refresh_token', 'client_credentials']),
    JSON.stringify(['google', 'github', 'oidc_generic', 'entra_saml']),
    3600,
    'RS256',
    crypto.randomBytes(32).toString('hex'),
    0,
    JSON.stringify(['totp', 'sms']),
    8,
    120,
    1,
    '2026.1',
    'active',
    now,
    now
  );

  insertSystem.run(
    sysPayId,
    'EdgePay Gateway',
    'edgepay-gateway',
    'API financeira de alta criticidade com 2FA obrigatorio e TTL de token reduzido.',
    'cid_edgepay_gateway',
    sha256('csec_edgepay_gw_demo_secret'),
    JSON.stringify(['https://pay.edge.local/auth/callback']),
    JSON.stringify(['authorization_code', 'refresh_token']),
    JSON.stringify(['google', 'entra_saml']),
    900,
    'RS256',
    crypto.randomBytes(32).toString('hex'),
    1,
    JSON.stringify(['totp', 'sms']),
    12,
    45,
    1,
    '2026.2',
    'active',
    now,
    now
  );

  insertSystem.run(
    sysAtlasId,
    'Atlas Analytics',
    'atlas-analytics',
    'Portal analitico distribuido na borda com cache longo e assinatura HS256.',
    'cid_atlas_analytics',
    sha256('csec_atlas_bi_demo_secret'),
    JSON.stringify(['https://atlas.edge.local/oidc/callback']),
    JSON.stringify(['authorization_code', 'password']),
    JSON.stringify(['google', 'github', 'oidc_generic']),
    7200,
    'HS256',
    'hs256_atlas_bi_edge_signing_key_2026_secure',
    0,
    JSON.stringify(['totp', 'sms']),
    8,
    300,
    1,
    '2026.1',
    'active',
    now,
    now
  );

  const insertIdp = db.prepare(`
    INSERT INTO identity_providers (
      id, name, provider_type, issuer_url, auth_url, token_url, userinfo_url,
      client_id, scopes, simulation_mode, enabled, metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertIdp.run(
    'idp-google',
    'Google OAuth 2.0 / OIDC',
    'google',
    'https://accounts.google.com',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token',
    'https://openidconnect.googleapis.com/v1/userinfo',
    process.env.GOOGLE_OAUTH_CLIENT_ID || 'google-sandbox-client-id',
    'openid email profile',
    process.env.GOOGLE_OAUTH_CLIENT_ID ? 0 : 1,
    1,
    JSON.stringify({ supportsPkce: true, protocol: 'OIDC 1.0' }),
    now
  );

  insertIdp.run(
    'idp-github',
    'GitHub OAuth 2.0',
    'github',
    'https://github.com',
    'https://github.com/login/oauth/authorize',
    'https://github.com/login/oauth/access_token',
    'https://api.github.com/user',
    process.env.GITHUB_OAUTH_CLIENT_ID || 'github-sandbox-client-id',
    'read:user user:email',
    process.env.GITHUB_OAUTH_CLIENT_ID ? 0 : 1,
    1,
    JSON.stringify({ supportsPkce: false, protocol: 'OAuth 2.0' }),
    now
  );

  insertIdp.run(
    'idp-oidc-generic',
    'OIDC Enterprise Generico',
    'oidc_generic',
    'https://idp.enterprise.internal',
    'https://idp.enterprise.internal/oauth2/authorize',
    'https://idp.enterprise.internal/oauth2/token',
    'https://idp.enterprise.internal/oauth2/userinfo',
    'oidc-custom-tenant-01',
    'openid profile email groups',
    1,
    1,
    JSON.stringify({ customizablePerSystem: true, discoveryPath: '/.well-known/openid-configuration' }),
    now
  );

  insertIdp.run(
    'idp-entra-saml',
    'Microsoft Entra ID & SAML 2.0',
    'entra_saml',
    'https://login.microsoftonline.com/common/v2.0',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    'https://graph.microsoft.com/oidc/userinfo',
    'entra-saml-sim-app',
    'openid profile email User.Read',
    1,
    1,
    JSON.stringify({ samlAssertionConsumer: '/api/auth/idp/entra_saml/callback', acsBinding: 'HTTP-POST' }),
    now
  );

  // Roles & Permissions
  const insertRole = db.prepare('INSERT INTO roles (id, system_id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insertPerm = db.prepare('INSERT INTO permissions (id, system_id, code, description, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertRolePerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  const insertClaim = db.prepare('INSERT INTO custom_claims (id, role_id, claim_key, claim_value, value_type) VALUES (?, ?, ?, ?, ?)');

  // Vektor Core Roles
  insertRole.run('role-core-admin', sysCoreId, 'super_admin', 'Administrador global da plataforma IAM', 0, now);
  insertRole.run('role-core-operator', sysCoreId, 'iam_operator', 'Operador de usuarios e auditoria', 1, now);

  const corePerms = [
    ['perm-core-sys-r', 'iam:systems:read', 'Visualizar configuracoes de sistemas'],
    ['perm-core-sys-w', 'iam:systems:write', 'Criar, editar e remover sistemas OAuth 2.0'],
    ['perm-core-usr-r', 'iam:users:read', 'Consultar catalogo de usuarios e vinculos'],
    ['perm-core-usr-w', 'iam:users:write', 'Criar, editar e deletar usuarios e roles'],
    ['perm-core-role-w', 'iam:roles:write', 'Configurar roles, permissoes e claims'],
    ['perm-core-aud-r', 'iam:audit:read', 'Acessar logs estruturados e metricas de borda'],
    ['perm-core-cache-w', 'iam:cache:purge', 'Invalidar cache distribuido na borda'],
  ];
  for (const [id, code, desc] of corePerms) {
    insertPerm.run(id, sysCoreId, code, desc, now);
    insertRolePerm.run('role-core-admin', id);
  }
  for (const id of ['perm-core-sys-r', 'perm-core-usr-r', 'perm-core-usr-w', 'perm-core-aud-r']) {
    insertRolePerm.run('role-core-operator', id);
  }
  insertClaim.run('clm-core-1', 'role-core-admin', 'clearance_level', 'tier_0_root', 'string');
  insertClaim.run('clm-core-2', 'role-core-admin', 'edge_region', 'global_anycast', 'string');
  insertClaim.run('clm-core-3', 'role-core-admin', 'can_impersonate', 'false', 'boolean');
  insertClaim.run('clm-core-4', 'role-core-operator', 'clearance_level', 'tier_2_ops', 'string');

  // EdgePay Roles
  insertRole.run('role-pay-auditor', sysPayId, 'security_auditor', 'Auditor de transacoes e conformidade PCI/LGPD', 0, now);
  insertRole.run('role-pay-dev', sysPayId, 'gateway_developer', 'Desenvolvedor de integracoes de pagamento', 1, now);
  const payPerms = [
    ['perm-pay-tx-r', 'payments:ledger:read', 'Ler ledger de transacoes'],
    ['perm-pay-ref-w', 'payments:refund:execute', 'Autorizar estornos'],
    ['perm-pay-key-w', 'payments:webhooks:manage', 'Gerenciar webhooks de borda'],
  ];
  for (const [id, code, desc] of payPerms) {
    insertPerm.run(id, sysPayId, code, desc, now);
    insertRolePerm.run('role-pay-auditor', id);
  }
  insertRolePerm.run('role-pay-dev', 'perm-pay-tx-r');
  insertRolePerm.run('role-pay-dev', 'perm-pay-key-w');
  insertClaim.run('clm-pay-1', 'role-pay-auditor', 'max_refund_brl', '50000', 'number');
  insertClaim.run('clm-pay-2', 'role-pay-auditor', 'pci_scope', 'full_read', 'string');
  insertClaim.run('clm-pay-3', 'role-pay-dev', 'sandbox_only', 'true', 'boolean');

  // Atlas BI Roles
  insertRole.run('role-atlas-owner', sysAtlasId, 'analytics_owner', 'Proprietario de paineis e exportacoes', 0, now);
  insertRole.run('role-atlas-viewer', sysAtlasId, 'analytics_viewer', 'Leitura de relatorios anonimizados', 1, now);
  const atlasPerms = [
    ['perm-atlas-r', 'analytics:dashboards:read', 'Visualizar metricas consolidadas'],
    ['perm-atlas-exp', 'analytics:datasets:export', 'Exportar datasets de leitura'],
  ];
  for (const [id, code, desc] of atlasPerms) {
    insertPerm.run(id, sysAtlasId, code, desc, now);
    insertRolePerm.run('role-atlas-owner', id);
  }
  insertRolePerm.run('role-atlas-viewer', 'perm-atlas-r');
  insertClaim.run('clm-atlas-1', 'role-atlas-owner', 'data_residency', 'sa-east-1', 'string');
  insertClaim.run('clm-atlas-2', 'role-atlas-viewer', 'pii_redacted', 'true', 'boolean');

  // Users
  const insertUser = db.prepare(`
    INSERT INTO users (
      id, email, display_name, password_hash, phone_number, phone_verified,
      mfa_preferred_method, totp_secret_enc, totp_enabled, backup_codes_hash,
      status, perm_version, last_login_at, anonymized_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const adminId = 'usr-admin-01';
  const claraId = 'usr-clara-02';
  const rafaelId = 'usr-rafael-03';

  insertUser.run(
    adminId,
    'administrator@smarttarget.com.br',
    'Osvandir Junior',
    hashPasswordSync('Vektor@2026!'),
    '+55 11 99812-4410',
    1,
    'none',
    null,
    0,
    null,
    'active',
    1,
    now,
    null,
    now,
    now
  );

  insertUser.run(
    claraId,
    'operator@smarttarget.com.br',
    'Clara Silva',
    hashPasswordSync('Clara@2026!'),
    '+55 21 98420-1190',
    1,
    'sms',
    null,
    0,
    null,
    'active',
    1,
    now,
    null,
    now,
    now
  );

  insertUser.run(
    rafaelId,
    'rafael.costa@vektor.iam',
    'Rafael Costa',
    hashPasswordSync('Rafael@2026!'),
    null,
    0,
    'none',
    null,
    0,
    null,
    'active',
    1,
    null,
    null,
    now,
    now
  );

  // Multi-system user bindings
  const insertBinding = db.prepare('INSERT INTO user_system_bindings (id, user_id, system_id, role_id, created_at) VALUES (?, ?, ?, ?, ?)');
  insertBinding.run('bnd-1', adminId, sysCoreId, 'role-core-admin', now);
  insertBinding.run('bnd-2', adminId, sysPayId, 'role-pay-auditor', now);
  insertBinding.run('bnd-3', adminId, sysAtlasId, 'role-atlas-owner', now);
  insertBinding.run('bnd-4', claraId, sysCoreId, 'role-core-operator', now);
  insertBinding.run('bnd-5', claraId, sysPayId, 'role-pay-dev', now);
  insertBinding.run('bnd-6', rafaelId, sysAtlasId, 'role-atlas-viewer', now);
  insertBinding.run('bnd-7', rafaelId, sysPayId, 'role-pay-dev', now);

  // Initial LGPD/GDPR Consent Records
  const insertConsent = db.prepare(`
    INSERT INTO consent_records (id, user_id, system_id, policy_version, purposes_json, granted, ip_masked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertConsent.run('cns-1', adminId, sysCoreId, '2026.1', JSON.stringify(['authentication', 'security_audit', 'rbac_claims']), 1, '177.84.x.x', now);
  insertConsent.run('cns-2', adminId, sysPayId, '2026.2', JSON.stringify(['authentication', 'fraud_prevention']), 1, '177.84.x.x', now);
  insertConsent.run('cns-3', claraId, sysCoreId, '2026.1', JSON.stringify(['authentication', 'security_audit']), 1, '200.142.x.x', now);

  // Initial Structured Audit Events
  const seedAudit = [
    {
      id: 'aud-seed-1',
      trace_id: 'tr-9a01f2b4',
      actor_hash: sha256(adminId).slice(0, 16),
      actor_masked: 'ad***@smarttarget.com.br',
      system_id: sysCoreId,
      system_slug: 'secure-gate',
      action: 'SYSTEM_BOOTSTRAP',
      resource_type: 'system',
      resource_id: sysCoreId,
      status: 'success' as const,
      cache_status: 'BYPASS',
      duration_ms: 1.42,
      ip_masked: '127.0.x.x',
      details_json: JSON.stringify({ engine: 'sqlite-wal', d1Compatible: true, jwks: 'RS256' }),
      created_at: now,
    },
    {
      id: 'aud-seed-2',
      trace_id: 'tr-9a01f2c8',
      actor_hash: sha256(adminId).slice(0, 16),
      actor_masked: 'ad***@smarttarget.com.br',
      system_id: sysPayId,
      system_slug: 'edgepay-gateway',
      action: 'POLICY_MFA_ENFORCED',
      resource_type: 'policy',
      resource_id: sysPayId,
      status: 'success' as const,
      cache_status: 'MISS',
      duration_ms: 0.64,
      ip_masked: '177.84.x.x',
      details_json: JSON.stringify({ requireMfa: true, allowedMethods: ['totp', 'sms'], jwtTtl: 900 }),
      created_at: now,
    },
  ];
  flushAuditTransaction(seedAudit);
}

seedInitialData();

// Idempotent migration: rename primary system ID from 'sys-vektor-core' to 'identity-secure-gate'
const legacyCoreRow = db.prepare("SELECT id FROM systems WHERE id = 'sys-vektor-core'").get();
const newCoreRow = db.prepare("SELECT id FROM systems WHERE id = 'identity-secure-gate'").get();
if (legacyCoreRow && !newCoreRow) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.prepare("UPDATE systems SET id = 'identity-secure-gate' WHERE id = 'sys-vektor-core'").run();
      db.prepare("UPDATE roles SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE permissions SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE user_system_bindings SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE sessions SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE consent_records SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE oauth_codes SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE mfa_challenges SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE audit_logs SET system_id = 'identity-secure-gate' WHERE system_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE audit_logs SET resource_id = 'identity-secure-gate' WHERE resource_type = 'system' AND resource_id = 'sys-vektor-core'").run();
      db.prepare("UPDATE kv_store SET kv_key = 's_ver:identity-secure-gate' WHERE kv_key = 's_ver:sys-vektor-core'").run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

db.prepare("UPDATE systems SET name = 'Identity Secure Gate' WHERE id = 'identity-secure-gate' AND name IN ('Vektor Core Console', 'Smarties Gate Core', 'Smarties Secure Gate Core', 'Secure Gate')").run();
db.prepare("UPDATE systems SET slug = 'secure-gate' WHERE id = 'identity-secure-gate' AND slug = 'vektor-core'").run();
db.prepare("UPDATE systems SET slug = 'edgepay-gateway' WHERE id = 'sys-edgepay-gw' AND slug = 'edgepay-api'").run();
db.prepare("UPDATE systems SET name = 'Atlas Analytics' WHERE id = 'sys-atlas-bi' AND name = 'Atlas Analytics Portal'").run();
db.prepare("UPDATE systems SET slug = 'atlas-analytics' WHERE id = 'sys-atlas-bi' AND slug = 'atlas-bi'").run();
db.prepare("UPDATE audit_logs SET system_slug = 'secure-gate' WHERE system_id = 'identity-secure-gate' AND system_slug = 'vektor-core'").run();
db.prepare("UPDATE audit_logs SET system_slug = 'edgepay-gateway' WHERE system_id = 'sys-edgepay-gw' AND system_slug = 'edgepay-api'").run();
db.prepare("UPDATE audit_logs SET system_slug = 'atlas-analytics' WHERE system_id = 'sys-atlas-bi' AND system_slug = 'atlas-bi'").run();
db.prepare("UPDATE users SET email = 'administrator@smarttarget.com.br' WHERE id = 'usr-admin-01' AND email = 'admin@vektor.iam'").run();
db.prepare("UPDATE users SET email = 'operator@smarttarget.com.br' WHERE id = 'usr-clara-02' AND email = 'clara.silva@vektor.iam'").run();
db.prepare("UPDATE audit_logs SET actor_masked = 'ad***@smarttarget.com.br' WHERE actor_masked = 'ad***@vektor.iam'").run();
db.prepare("UPDATE audit_logs SET actor_masked = 'op***@smarttarget.com.br' WHERE actor_masked = 'cl***@vektor.iam'").run();

const existingSystemsForClientId = db.prepare('SELECT id, slug, client_id FROM systems').all() as Array<{
  id: string;
  slug: string;
  client_id: string;
}>;
for (const sys of existingSystemsForClientId) {
  const expectedClientId = `cid_${sys.slug.trim().replace(/-/g, '_').replace(/[^a-z0-9_]/gi, '_')}`;
  if (sys.client_id !== expectedClientId) {
    const conflict = db
      .prepare('SELECT id FROM systems WHERE client_id = ? AND id != ?')
      .get(expectedClientId, sys.id);
    if (!conflict) {
      db.prepare('UPDATE systems SET client_id = ? WHERE id = ?').run(expectedClientId, sys.id);
    }
  }
}

if (process.env.GITHUB_OAUTH_CLIENT_ID) {
  db.prepare(`
    UPDATE identity_providers
    SET client_id = ?, simulation_mode = 0, updated_at = ?
    WHERE id = 'idp-github' AND (client_id != ? OR simulation_mode != 0)
  `).run(
    process.env.GITHUB_OAUTH_CLIENT_ID,
    new Date().toISOString(),
    process.env.GITHUB_OAUTH_CLIENT_ID
  );
}

if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
  db.prepare(`
    UPDATE identity_providers
    SET client_id = ?, simulation_mode = 0, updated_at = ?
    WHERE id = 'idp-google' AND (client_id != ? OR simulation_mode != 0)
  `).run(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    new Date().toISOString(),
    process.env.GOOGLE_OAUTH_CLIENT_ID
  );
}

const healthEventCount = db.prepare('SELECT COUNT(*) as cnt FROM system_health_events').get() as { cnt: number };
if (healthEventCount.cnt === 0) {
  db.prepare(`
    INSERT INTO system_health_events (
      id, previous_status, new_status, avg_latency_ms, max_latency_ms,
      sample_count, error_count, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'hlth-seed-baseline',
    null,
    'healthy',
    1.03,
    1.42,
    2,
    0,
    'Inicialização da plataforma e monitoramento de latência ativo (< 100ms).',
    new Date().toISOString()
  );
}
