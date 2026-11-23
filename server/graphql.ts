import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import DataLoader from 'dataloader';
import { buildSchema, graphql, parse } from 'graphql';
import {
  db,
  dbStats,
  flushAuditQueue,
  type AuditLogRow,
  type CustomClaimRow,
  type IdentityProviderRow,
  type PermissionRow,
  type RoleRow,
  type SystemRow,
  type SystemErrorLogRow,
  type UserRow,
} from './db.ts';
import {
  decryptSecret,
  encryptSecret,
  ensureRsaKeys,
  generateBackupCodes,
  generateTotpEnrollment,
  hashPassword,
  maskEmail,
  maskIp,
  resolveUserSystemClaims,
  sha256Hex,
  verifyIncomingJwt,
  verifyPassword,
  verifyTotpToken,
  type VerifiedJwtContext,
} from './cryptoAuth.ts';
import {
  buildEdgeCacheKey,
  bumpSystemPolicyVersion,
  bumpUserPermVersion,
  computeEffectiveCacheTtl,
  getEdgeCached,
  getEdgeMetricsSnapshot,
  getKvSystemPolicyVersion,
  getKvUserPermVersion,
  purgeAllEdgeCache,
  purgeSystemEdgeCache,
  recordEdgeCacheOutcome,
  setEdgeCached,
} from './edgeCache.ts';
import {
  clearSystemErrors,
  evaluateSystemHealthTransition,
  getActiveSseCount,
  getRecentSystemErrors,
  recordStructuredAudit,
  recordSystemException,
  type SystemHealthEventRow,
} from './telemetry.ts';
import {
  getPlatformSettings,
  resetPlatformSettings,
  updatePlatformSettings,
  type PlatformSettings,
} from './settings.ts';

const schema = buildSchema(`
  type CustomClaim {
    id: ID!
    roleId: ID!
    claimKey: String!
    claimValue: String!
    valueType: String!
  }

  type Permission {
    id: ID!
    systemId: ID!
    code: String!
    description: String!
  }

  type Role {
    id: ID!
    systemId: ID!
    name: String!
    description: String!
    isDefault: Boolean!
    permissions: [Permission!]!
    claims: [CustomClaim!]!
  }

  type System {
    id: ID!
    name: String!
    slug: String!
    description: String!
    clientId: String!
    redirectUris: [String!]!
    allowedGrants: [String!]!
    allowedIdps: [String!]!
    jwtTtlSeconds: Int!
    signingAlg: String!
    requireMfa: Boolean!
    allowedMfaMethods: [String!]!
    passwordMinLength: Int!
    edgeCacheTtl: Int!
    policyVersion: Int!
    privacyPolicyVersion: String!
    status: String!
    createdAt: String!
    updatedAt: String!
    roles: [Role!]!
    permissions: [Permission!]!
    userCount: Int!
  }

  type UserBinding {
    id: ID!
    userId: ID!
    systemId: ID!
    systemName: String!
    systemSlug: String!
    roleId: ID!
    roleName: String!
    permissions: [String!]!
    createdAt: String!
  }

  type UserSession {
    id: ID!
    systemId: ID!
    systemName: String!
    jti: String!
    authMethod: String!
    ipMasked: String!
    userAgent: String!
    expiresAt: String!
    revokedAt: String
    createdAt: String!
  }

  type ConsentRecord {
    id: ID!
    userId: ID!
    systemId: ID!
    systemName: String!
    policyVersion: String!
    purposes: [String!]!
    granted: Boolean!
    ipMasked: String!
    updatedAt: String!
  }

  type ExternalIdentity {
    id: ID!
    providerType: String!
    externalEmail: String!
    linkedAt: String!
  }

  type User {
    id: ID!
    email: String!
    displayName: String!
    phoneNumber: String
    phoneVerified: Boolean!
    mfaPreferredMethod: String!
    totpEnabled: Boolean!
    status: String!
    permVersion: Int!
    lastLoginAt: String
    anonymizedAt: String
    createdAt: String!
    updatedAt: String!
    bindings: [UserBinding!]!
    sessions: [UserSession!]!
    consents: [ConsentRecord!]!
    externalIdentities: [ExternalIdentity!]!
  }

  type IdentityProvider {
    id: ID!
    name: String!
    providerType: String!
    issuerUrl: String!
    authUrl: String!
    tokenUrl: String!
    userinfoUrl: String!
    clientId: String!
    scopes: String!
    simulationMode: Boolean!
    enabled: Boolean!
    updatedAt: String!
  }

  type AuditLog {
    id: ID!
    traceId: String!
    actorHash: String!
    actorMasked: String!
    systemId: ID
    systemSlug: String
    action: String!
    resourceType: String!
    resourceId: String!
    status: String!
    cacheStatus: String!
    durationMs: Float!
    ipMasked: String!
    detailsJson: String!
    createdAt: String!
  }

  type EdgeMetrics {
    cacheHits: Int!
    cacheMisses: Int!
    cacheBypasses: Int!
    cachePurges: Int!
    cachedEntriesCount: Int!
    cacheHitRatioPct: Float!
    kvVersionReads: Int!
    p50LatencyMs: Float!
    p95LatencyMs: Float!
    avgHitLatencyMs: Float!
    avgMissLatencyMs: Float!
    sqliteTotalReads: Int!
    sqliteTotalWrites: Int!
    sqliteReadRatioPct: Float!
    batchedAuditFlushes: Int!
    queuedAuditLogs: Int!
    activeSseStreams: Int!
  }

  type LatencyTrendBucket {
    minuteIso: String!
    avgLatencyMs: Float!
    maxLatencyMs: Float!
    sampleCount: Int!
  }

  type SystemHealth {
    status: String!
    avgLatencyMs: Float!
    maxLatencyMs: Float!
    sampleCount: Int!
    errorCount: Int!
    measuredAt: String!
    latencyTrend: [LatencyTrendBucket!]!
  }

  type SystemHealthEvent {
    id: ID!
    previousStatus: String
    newStatus: String!
    avgLatencyMs: Float!
    maxLatencyMs: Float!
    sampleCount: Int!
    errorCount: Int!
    reason: String!
    createdAt: String!
  }

  type SystemErrorLog {
    id: ID!
    traceId: String!
    errorName: String!
    message: String!
    stackTrace: String!
    source: String!
    operationOrRoute: String!
    httpMethod: String!
    statusCode: Int!
    actorMasked: String!
    systemSlug: String
    metadataJson: String!
    createdAt: String!
  }

  type ComplianceSummary {
    totalUsers: Int!
    anonymizedUsers: Int!
    activeConsents: Int!
    revokedConsents: Int!
    mfaAdoptedUsers: Int!
    totpUsers: Int!
    smsUsers: Int!
    piiMaskedLogsCount: Int!
  }

  type TotpSetupPayload {
    secretBase32: String!
    otpauthUri: String!
    qrSvg: String!
  }

  type TotpVerifyPayload {
    enabled: Boolean!
    backupCodes: [String!]!
  }

  type SmsOtpPayload {
    sent: Boolean!
    maskedPhone: String!
    expiresInSeconds: Int!
    sandboxCodePreview: String!
  }

  type SecretRotationPayload {
    systemId: ID!
    clientId: String!
    newClientSecret: String!
  }

  type MutationResult {
    success: Boolean!
    message: String!
  }

  type RuntimeSettingsInfo {
    sqliteJournalMode: String!
    d1Compatible: Boolean!
    rsaKeyId: String!
    activeSystemsCount: Int!
    activeUsersCount: Int!
  }

  type SystemSettings {
    executionEnvironment: String!
    platformName: String!
    jwtIssuer: String!
    appBaseUrl: String!
    defaultJwtTtlSeconds: Int!
    defaultSigningAlg: String!
    sessionWarningSeconds: Int!
    oauthCodeTtlSeconds: Int!
    pkceRequired: Boolean!
    allowSelfRegistration: Boolean!
    globalRequireMfa: Boolean!
    globalPasswordMinLength: Int!
    maxLoginAttempts: Int!
    smsOtpTtlSeconds: Int!
    smsSandboxPreview: Boolean!
    jitProvisioningEnabled: Boolean!
    edgeCacheEnabled: Boolean!
    defaultEdgeCacheTtl: Int!
    auditFlushBatchSize: Int!
    auditRetentionDays: Int!
    piiMaskingEnabled: Boolean!
    telemetryStreamEnabled: Boolean!
    healthAlertSoundEnabled: Boolean!
    defaultPrivacyPolicyVersion: String!
    requireExplicitConsent: Boolean!
    allowDataPortabilityExport: Boolean!
    allowSelfErasure: Boolean!
    updatedAt: String!
    updatedBy: String!
    runtime: RuntimeSettingsInfo!
  }

  input SystemSettingsInput {
    executionEnvironment: String!
    platformName: String!
    jwtIssuer: String!
    appBaseUrl: String
    defaultJwtTtlSeconds: Int!
    defaultSigningAlg: String!
    sessionWarningSeconds: Int!
    oauthCodeTtlSeconds: Int!
    pkceRequired: Boolean!
    allowSelfRegistration: Boolean!
    globalRequireMfa: Boolean!
    globalPasswordMinLength: Int!
    maxLoginAttempts: Int!
    smsOtpTtlSeconds: Int!
    smsSandboxPreview: Boolean!
    jitProvisioningEnabled: Boolean!
    edgeCacheEnabled: Boolean!
    defaultEdgeCacheTtl: Int!
    auditFlushBatchSize: Int!
    auditRetentionDays: Int!
    piiMaskingEnabled: Boolean!
    telemetryStreamEnabled: Boolean!
    healthAlertSoundEnabled: Boolean
    defaultPrivacyPolicyVersion: String!
    requireExplicitConsent: Boolean!
    allowDataPortabilityExport: Boolean!
    allowSelfErasure: Boolean!
  }

  input SystemInput {
    name: String!
    slug: String!
    description: String
    redirectUris: [String!]
    allowedGrants: [String!]
    allowedIdps: [String!]
    jwtTtlSeconds: Int!
    signingAlg: String!
    requireMfa: Boolean!
    allowedMfaMethods: [String!]
    passwordMinLength: Int
    edgeCacheTtl: Int!
    privacyPolicyVersion: String
    status: String
  }

  input CreateUserInput {
    email: String!
    displayName: String!
    password: String!
    phoneNumber: String
    systemId: ID
    roleId: ID
  }

  input UpdateUserInput {
    displayName: String
    email: String
    phoneNumber: String
    status: String
  }

  input ClaimInput {
    claimKey: String!
    claimValue: String!
    valueType: String!
  }

  input RoleInput {
    systemId: ID!
    name: String!
    description: String
    isDefault: Boolean
    permissionIds: [ID!]
    claims: [ClaimInput!]
  }

  input IdpUpdateInput {
    name: String
    issuerUrl: String
    authUrl: String
    tokenUrl: String
    userinfoUrl: String
    clientId: String
    scopes: String
    simulationMode: Boolean
    enabled: Boolean
  }

  type Query {
    me: User
    systems: [System!]!
    system(id: ID!): System
    users(search: String, systemId: ID, status: String, limit: Int): [User!]!
    user(id: ID!): User
    rolesBySystem(systemId: ID!): [Role!]!
    permissionsBySystem(systemId: ID!): [Permission!]!
    identityProviders: [IdentityProvider!]!
    auditLogs(systemId: ID, action: String, limit: Int): [AuditLog!]!
    edgeMetrics: EdgeMetrics!
    systemHealth(limit: Int): SystemHealth!
    systemHealthHistory(limit: Int): [SystemHealthEvent!]!
    complianceSummary: ComplianceSummary!
    exportMyDataJson: String!
    systemSettings: SystemSettings!
    systemErrorLogs(limit: Int): [SystemErrorLog!]!
  }

  type Mutation {
    createSystem(input: SystemInput!): System!
    updateSystem(id: ID!, input: SystemInput!): System!
    deleteSystem(id: ID!): MutationResult!
    rotateSystemSecret(id: ID!): SecretRotationPayload!

    createUser(input: CreateUserInput!): User!
    updateUser(id: ID!, input: UpdateUserInput!): User!
    deleteUser(id: ID!): MutationResult!

    assignUserSystemRole(userId: ID!, systemId: ID!, roleId: ID!): MutationResult!
    removeUserSystemBinding(bindingId: ID!): MutationResult!

    createRole(input: RoleInput!): Role!
    updateRole(id: ID!, name: String!, description: String, isDefault: Boolean, permissionIds: [ID!], claims: [ClaimInput!]): Role!
    deleteRole(id: ID!): MutationResult!
    createPermission(systemId: ID!, code: String!, description: String): Permission!

    updateIdentityProvider(id: ID!, input: IdpUpdateInput!): IdentityProvider!

    setupTotp: TotpSetupPayload!
    verifyAndEnableTotp(code: String!): TotpVerifyPayload!
    disableTotp: MutationResult!
    requestSmsSetup(phoneNumber: String!): SmsOtpPayload!
    verifyAndEnableSms(phoneNumber: String!, code: String!): MutationResult!
    disableSms: MutationResult!
    setPreferredMfaMethod(method: String!): MutationResult!

    updateProfile(displayName: String!, phoneNumber: String): User!
    changePassword(currentPassword: String!, newPassword: String!): MutationResult!
    revokeSession(sessionId: ID!): MutationResult!

    recordConsent(systemId: ID!, granted: Boolean!, purposes: [String!]): MutationResult!
    anonymizeUserAccount(userId: ID!): MutationResult!
    purgeEdgeCache(systemId: ID): Int!

    updateSystemSettings(input: SystemSettingsInput!): SystemSettings!
    resetSystemSettings: SystemSettings!
    triggerDiagnosticException(message: String): SystemErrorLog!
    clearSystemErrorLogs: Int!
  }
`);

interface GraphQLRequestContext {
  jwt: VerifiedJwtContext | null;
  ip: string;
  sqlQueriesCount: number;
  trackRead: () => void;
  loaders: {
    bindingsByUser: DataLoader<string, Array<{
      id: string;
      user_id: string;
      system_id: string;
      system_name: string;
      system_slug: string;
      role_id: string;
      role_name: string;
      created_at: string;
    }>>;
    rolesBySystem: DataLoader<string, RoleRow[]>;
    permsBySystem: DataLoader<string, PermissionRow[]>;
    permsByRole: DataLoader<string, PermissionRow[]>;
    claimsByRole: DataLoader<string, CustomClaimRow[]>;
    userCountBySystem: DataLoader<string, number>;
    sessionsByUser: DataLoader<string, Array<{
      id: string;
      user_id: string;
      system_id: string;
      system_name: string;
      jti: string;
      auth_method: string;
      ip_masked: string;
      user_agent: string;
      expires_at: string;
      revoked_at: string | null;
      created_at: string;
    }>>;
    consentsByUser: DataLoader<string, Array<{
      id: string;
      user_id: string;
      system_id: string;
      system_name: string;
      policy_version: string;
      purposes_json: string;
      granted: number;
      ip_masked: string;
      updated_at: string;
    }>>;
    externalIdsByUser: DataLoader<string, Array<{
      id: string;
      user_id: string;
      provider_type: string;
      external_email: string;
      linked_at: string;
    }>>;
  };
}

function createLoaders(trackRead: () => void): GraphQLRequestContext['loaders'] {
  return {
    bindingsByUser: new DataLoader(async (userIds) => {
      trackRead();
      const placeholders = userIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT usb.id, usb.user_id, usb.system_id, s.name as system_name, s.slug as system_slug,
                  usb.role_id, r.name as role_name, usb.created_at
           FROM user_system_bindings usb
           JOIN systems s ON s.id = usb.system_id
           JOIN roles r ON r.id = usb.role_id
           WHERE usb.user_id IN (${placeholders})
           ORDER BY s.name ASC`
        )
        .all(...userIds) as Array<{
          id: string;
          user_id: string;
          system_id: string;
          system_name: string;
          system_slug: string;
          role_id: string;
          role_name: string;
          created_at: string;
        }>;
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = map.get(r.user_id) || [];
        list.push(r);
        map.set(r.user_id, list);
      }
      return userIds.map((id) => map.get(id) || []);
    }),

    rolesBySystem: new DataLoader(async (systemIds) => {
      trackRead();
      const placeholders = systemIds.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT * FROM roles WHERE system_id IN (${placeholders}) ORDER BY name ASC`)
        .all(...systemIds) as RoleRow[];
      const map = new Map<string, RoleRow[]>();
      for (const r of rows) {
        const list = map.get(r.system_id) || [];
        list.push(r);
        map.set(r.system_id, list);
      }
      return systemIds.map((id) => map.get(id) || []);
    }),

    permsBySystem: new DataLoader(async (systemIds) => {
      trackRead();
      const placeholders = systemIds.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT * FROM permissions WHERE system_id IN (${placeholders}) ORDER BY code ASC`)
        .all(...systemIds) as PermissionRow[];
      const map = new Map<string, PermissionRow[]>();
      for (const r of rows) {
        const list = map.get(r.system_id) || [];
        list.push(r);
        map.set(r.system_id, list);
      }
      return systemIds.map((id) => map.get(id) || []);
    }),

    permsByRole: new DataLoader(async (roleIds) => {
      trackRead();
      const placeholders = roleIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT rp.role_id, p.*
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id IN (${placeholders})
           ORDER BY p.code ASC`
        )
        .all(...roleIds) as Array<PermissionRow & { role_id: string }>;
      const map = new Map<string, PermissionRow[]>();
      for (const r of rows) {
        const list = map.get(r.role_id) || [];
        list.push(r);
        map.set(r.role_id, list);
      }
      return roleIds.map((id) => map.get(id) || []);
    }),

    claimsByRole: new DataLoader(async (roleIds) => {
      trackRead();
      const placeholders = roleIds.map(() => '?').join(',');
      const rows = db
        .prepare(`SELECT * FROM custom_claims WHERE role_id IN (${placeholders}) ORDER BY claim_key ASC`)
        .all(...roleIds) as CustomClaimRow[];
      const map = new Map<string, CustomClaimRow[]>();
      for (const r of rows) {
        const list = map.get(r.role_id) || [];
        list.push(r);
        map.set(r.role_id, list);
      }
      return roleIds.map((id) => map.get(id) || []);
    }),

    userCountBySystem: new DataLoader(async (systemIds) => {
      trackRead();
      const placeholders = systemIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT system_id, COUNT(DISTINCT user_id) as cnt
           FROM user_system_bindings
           WHERE system_id IN (${placeholders})
           GROUP BY system_id`
        )
        .all(...systemIds) as Array<{ system_id: string; cnt: number }>;
      const map = new Map(rows.map((r) => [r.system_id, r.cnt]));
      return systemIds.map((id) => map.get(id) ?? 0);
    }),

    sessionsByUser: new DataLoader(async (userIds) => {
      trackRead();
      const placeholders = userIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT ses.*, s.name as system_name
           FROM sessions ses
           JOIN systems s ON s.id = ses.system_id
           WHERE ses.user_id IN (${placeholders})
           ORDER BY ses.created_at DESC
           LIMIT 30`
        )
        .all(...userIds) as Array<{
          id: string;
          user_id: string;
          system_id: string;
          system_name: string;
          jti: string;
          auth_method: string;
          ip_masked: string;
          user_agent: string;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        }>;
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = map.get(r.user_id) || [];
        list.push(r);
        map.set(r.user_id, list);
      }
      return userIds.map((id) => map.get(id) || []);
    }),

    consentsByUser: new DataLoader(async (userIds) => {
      trackRead();
      const placeholders = userIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT cr.*, s.name as system_name
           FROM consent_records cr
           JOIN systems s ON s.id = cr.system_id
           WHERE cr.user_id IN (${placeholders})
           ORDER BY cr.updated_at DESC`
        )
        .all(...userIds) as Array<{
          id: string;
          user_id: string;
          system_id: string;
          system_name: string;
          policy_version: string;
          purposes_json: string;
          granted: number;
          ip_masked: string;
          updated_at: string;
        }>;
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = map.get(r.user_id) || [];
        list.push(r);
        map.set(r.user_id, list);
      }
      return userIds.map((id) => map.get(id) || []);
    }),

    externalIdsByUser: new DataLoader(async (userIds) => {
      trackRead();
      const placeholders = userIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, user_id, provider_type, external_email, linked_at
           FROM external_identities
           WHERE user_id IN (${placeholders})`
        )
        .all(...userIds) as Array<{
          id: string;
          user_id: string;
          provider_type: string;
          external_email: string;
          linked_at: string;
        }>;
      const map = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = map.get(r.user_id) || [];
        list.push(r);
        map.set(r.user_id, list);
      }
      return userIds.map((id) => map.get(id) || []);
    }),
  };
}

function requireAuth(ctx: GraphQLRequestContext): VerifiedJwtContext {
  if (!ctx.jwt) {
    throw new Error('UNAUTHENTICATED: Token JWT ausente, invalido ou expirado.');
  }
  return ctx.jwt;
}

function requirePermission(ctx: GraphQLRequestContext, perm: string): VerifiedJwtContext {
  const jwt = requireAuth(ctx);
  const isSuperAdmin = jwt.roles.includes('super_admin');
  if (!isSuperAdmin && !jwt.permissions.includes(perm)) {
    throw new Error(`FORBIDDEN: Permissao necessaria (${perm}).`);
  }
  return jwt;
}

function requireSuperAdmin(ctx: GraphQLRequestContext): VerifiedJwtContext {
  const jwt = requireAuth(ctx);
  if (!jwt.roles.includes('super_admin')) {
    throw new Error('FORBIDDEN: Acesso restrito exclusivamente ao administrador (super_admin).');
  }
  return jwt;
}

async function buildSystemSettingsPayload(settings: PlatformSettings, ctx: GraphQLRequestContext) {
  ctx.trackRead();
  const rsa = await ensureRsaKeys();
  const sysCount = (db.prepare("SELECT COUNT(*) as cnt FROM systems WHERE status = 'active'").get() as { cnt: number }).cnt;
  const usrCount = (db.prepare("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'").get() as { cnt: number }).cnt;
  return {
    ...settings,
    runtime: {
      sqliteJournalMode: 'WAL',
      d1Compatible: true,
      rsaKeyId: rsa.kid,
      activeSystemsCount: sysCount,
      activeUsersCount: usrCount,
    },
  };
}

function mapSystemErrorLog(row: SystemErrorLogRow) {
  return {
    id: row.id,
    traceId: row.trace_id,
    errorName: row.error_name,
    message: row.message,
    stackTrace: row.stack_trace,
    source: row.source,
    operationOrRoute: row.operation_or_route,
    httpMethod: row.http_method,
    statusCode: row.status_code,
    actorMasked: row.actor_masked,
    systemSlug: row.system_slug,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
  };
}

function mapRole(row: RoleRow, ctx: GraphQLRequestContext) {
  return {
    id: row.id,
    systemId: row.system_id,
    name: row.name,
    description: row.description,
    isDefault: Boolean(row.is_default),
    permissions: async () => {
      const perms = await ctx.loaders.permsByRole.load(row.id);
      return perms.map((p) => ({
        id: p.id,
        systemId: p.system_id,
        code: p.code,
        description: p.description,
      }));
    },
    claims: async () => {
      const claims = await ctx.loaders.claimsByRole.load(row.id);
      return claims.map((c) => ({
        id: c.id,
        roleId: c.role_id,
        claimKey: c.claim_key,
        claimValue: c.claim_value,
        valueType: c.value_type,
      }));
    },
  };
}

function mapSystem(row: SystemRow, ctx: GraphQLRequestContext) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    clientId: row.client_id,
    redirectUris: JSON.parse(row.redirect_uris || '[]') as string[],
    allowedGrants: JSON.parse(row.allowed_grants || '[]') as string[],
    allowedIdps: JSON.parse(row.allowed_idps || '[]') as string[],
    jwtTtlSeconds: row.jwt_ttl_seconds,
    signingAlg: row.signing_alg,
    requireMfa: Boolean(row.require_mfa),
    allowedMfaMethods: JSON.parse(row.allowed_mfa_methods || '["totp","sms"]') as string[],
    passwordMinLength: row.password_min_length,
    edgeCacheTtl: row.edge_cache_ttl,
    policyVersion: row.policy_version,
    privacyPolicyVersion: row.privacy_policy_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roles: async () => {
      const roles = await ctx.loaders.rolesBySystem.load(row.id);
      return roles.map((r) => mapRole(r, ctx));
    },
    permissions: async () => {
      const perms = await ctx.loaders.permsBySystem.load(row.id);
      return perms.map((p) => ({
        id: p.id,
        systemId: p.system_id,
        code: p.code,
        description: p.description,
      }));
    },
    userCount: () => ctx.loaders.userCountBySystem.load(row.id),
  };
}

function mapUser(row: UserRow, ctx: GraphQLRequestContext) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    phoneVerified: Boolean(row.phone_verified),
    mfaPreferredMethod: row.mfa_preferred_method,
    totpEnabled: Boolean(row.totp_enabled),
    status: row.status,
    permVersion: row.perm_version,
    lastLoginAt: row.last_login_at,
    anonymizedAt: row.anonymized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bindings: async () => {
      const bindings = await ctx.loaders.bindingsByUser.load(row.id);
      return Promise.all(
        bindings.map(async (b) => {
          const perms = await ctx.loaders.permsByRole.load(b.role_id);
          return {
            id: b.id,
            userId: b.user_id,
            systemId: b.system_id,
            systemName: b.system_name,
            systemSlug: b.system_slug,
            roleId: b.role_id,
            roleName: b.role_name,
            permissions: perms.map((p) => p.code),
            createdAt: b.created_at,
          };
        })
      );
    },
    sessions: async () => {
      const sessions = await ctx.loaders.sessionsByUser.load(row.id);
      return sessions.map((s) => ({
        id: s.id,
        systemId: s.system_id,
        systemName: s.system_name,
        jti: s.jti,
        authMethod: s.auth_method,
        ipMasked: s.ip_masked,
        userAgent: s.user_agent,
        expiresAt: s.expires_at,
        revokedAt: s.revoked_at,
        createdAt: s.created_at,
      }));
    },
    consents: async () => {
      const consents = await ctx.loaders.consentsByUser.load(row.id);
      return consents.map((c) => ({
        id: c.id,
        userId: c.user_id,
        systemId: c.system_id,
        systemName: c.system_name,
        policyVersion: c.policy_version,
        purposes: JSON.parse(c.purposes_json || '[]') as string[],
        granted: Boolean(c.granted),
        ipMasked: c.ip_masked,
        updatedAt: c.updated_at,
      }));
    },
    externalIdentities: async () => {
      const ids = await ctx.loaders.externalIdsByUser.load(row.id);
      return ids.map((e) => ({
        id: e.id,
        providerType: e.provider_type,
        externalEmail: e.external_email,
        linkedAt: e.linked_at,
      }));
    },
  };
}

function mapIdp(row: IdentityProviderRow) {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    issuerUrl: row.issuer_url,
    authUrl: row.auth_url,
    tokenUrl: row.token_url,
    userinfoUrl: row.userinfo_url,
    clientId: row.client_id,
    scopes: row.scopes,
    simulationMode: Boolean(row.simulation_mode),
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: AuditLogRow) {
  return {
    id: row.id,
    traceId: row.trace_id,
    actorHash: row.actor_hash,
    actorMasked: row.actor_masked,
    systemId: row.system_id,
    systemSlug: row.system_slug,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    status: row.status,
    cacheStatus: row.cache_status,
    durationMs: row.duration_ms,
    ipMasked: row.ip_masked,
    detailsJson: row.details_json,
    createdAt: row.created_at,
  };
}

const rootValue = {
  me: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    ctx.trackRead();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.sub) as UserRow | undefined;
    return row ? mapUser(row, ctx) : null;
  },

  systems: (_args: unknown, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const rows = db.prepare('SELECT * FROM systems ORDER BY created_at ASC').all() as SystemRow[];
    return rows.map((r) => mapSystem(r, ctx));
  },

  system: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow | undefined;
    return row ? mapSystem(row, ctx) : null;
  },

  users: (
    { search, systemId, status, limit }: { search?: string; systemId?: string; status?: string; limit?: number },
    ctx: GraphQLRequestContext
  ) => {
    requirePermission(ctx, 'iam:users:read');
    ctx.trackRead();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (systemId) {
      clauses.push('EXISTS (SELECT 1 FROM user_system_bindings usb WHERE usb.user_id = u.id AND usb.system_id = ?)');
      params.push(systemId);
    }
    if (status) {
      clauses.push('u.status = ?');
      params.push(status);
    }
    if (search && search.trim()) {
      clauses.push('(u.email LIKE ? OR u.display_name LIKE ?)');
      const q = `%${search.trim()}%`;
      params.push(q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const lim = Math.min(200, Math.max(1, limit ?? 100));
    const rows = db
      .prepare(`SELECT u.* FROM users u ${whereSql} ORDER BY u.created_at DESC LIMIT ?`)
      .all(...params, lim) as UserRow[];
    return rows.map((r) => mapUser(r, ctx));
  },

  user: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    if (jwt.sub !== id) {
      requirePermission(ctx, 'iam:users:read');
    }
    ctx.trackRead();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? mapUser(row, ctx) : null;
  },

  rolesBySystem: ({ systemId }: { systemId: string }, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const rows = db
      .prepare('SELECT * FROM roles WHERE system_id = ? ORDER BY name ASC')
      .all(systemId) as RoleRow[];
    return rows.map((r) => mapRole(r, ctx));
  },

  permissionsBySystem: ({ systemId }: { systemId: string }, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const rows = db
      .prepare('SELECT * FROM permissions WHERE system_id = ? ORDER BY code ASC')
      .all(systemId) as PermissionRow[];
    return rows.map((p) => ({
      id: p.id,
      systemId: p.system_id,
      code: p.code,
      description: p.description,
    }));
  },

  identityProviders: (_args: unknown, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const rows = db.prepare('SELECT * FROM identity_providers ORDER BY name ASC').all() as IdentityProviderRow[];
    return rows.map(mapIdp);
  },

  auditLogs: (
    { systemId, action, limit }: { systemId?: string; action?: string; limit?: number },
    ctx: GraphQLRequestContext
  ) => {
    requirePermission(ctx, 'iam:audit:read');
    flushAuditQueue();
    ctx.trackRead();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (systemId) {
      clauses.push('system_id = ?');
      params.push(systemId);
    }
    if (action && action.trim()) {
      clauses.push('action LIKE ?');
      params.push(`%${action.trim()}%`);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const lim = Math.min(200, Math.max(1, limit ?? 50));
    const rows = db
      .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, lim) as AuditLogRow[];
    return rows.map(mapAudit);
  },

  edgeMetrics: (_args: unknown, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    return {
      ...getEdgeMetricsSnapshot(),
      activeSseStreams: getActiveSseCount(),
    };
  },

  systemHealth: ({ limit }: { limit?: number }, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    flushAuditQueue();
    ctx.trackRead();
    const lim = Math.min(200, Math.max(1, limit ?? 50));
    const rows = db
      .prepare('SELECT duration_ms, status FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(lim) as Array<{ duration_ms: number; status: string }>;

    const sampleCount = rows.length;
    let total = 0;
    let maxLatencyMs = 0;
    let errorCount = 0;
    for (const r of rows) {
      const d = Number(r.duration_ms || 0);
      total += d;
      if (d > maxLatencyMs) maxLatencyMs = d;
      if (r.status === 'error') errorCount += 1;
    }
    const avgLatencyMs = sampleCount > 0 ? Number((total / sampleCount).toFixed(2)) : 0;
    const status =
      avgLatencyMs >= 300 ? 'critical' : avgLatencyMs >= 100 ? 'degraded' : 'healthy';

    evaluateSystemHealthTransition({
      avgLatencyMs,
      maxLatencyMs: Number(maxLatencyMs.toFixed(2)),
      sampleCount,
      errorCount,
      status,
    });

    const currentMinuteMs = Math.floor(Date.now() / 60000) * 60000;
    const windowStartIso = new Date(currentMinuteMs - 9 * 60000).toISOString();
    ctx.trackRead();
    const trendRows = db
      .prepare('SELECT duration_ms, created_at FROM audit_logs WHERE created_at >= ? ORDER BY created_at ASC')
      .all(windowStartIso) as Array<{ duration_ms: number; created_at: string }>;

    const buckets = Array.from({ length: 10 }, (_, idx) => {
      const startMs = currentMinuteMs - (9 - idx) * 60000;
      return {
        startMs,
        minuteIso: new Date(startMs).toISOString(),
        sum: 0,
        maxLatencyMs: 0,
        sampleCount: 0,
      };
    });

    for (const row of trendRows) {
      const ts = new Date(row.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      const idx = Math.floor((ts - buckets[0].startMs) / 60000);
      if (idx >= 0 && idx < 10) {
        const d = Number(row.duration_ms || 0);
        buckets[idx].sum += d;
        if (d > buckets[idx].maxLatencyMs) buckets[idx].maxLatencyMs = d;
        buckets[idx].sampleCount += 1;
      }
    }

    const latencyTrend = buckets.map((b) => ({
      minuteIso: b.minuteIso,
      avgLatencyMs: b.sampleCount > 0 ? Number((b.sum / b.sampleCount).toFixed(2)) : 0,
      maxLatencyMs: Number(b.maxLatencyMs.toFixed(2)),
      sampleCount: b.sampleCount,
    }));

    return {
      status,
      avgLatencyMs,
      maxLatencyMs: Number(maxLatencyMs.toFixed(2)),
      sampleCount,
      errorCount,
      measuredAt: new Date().toISOString(),
      latencyTrend,
    };
  },

  systemHealthHistory: ({ limit }: { limit?: number }, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const lim = Math.min(200, Math.max(1, limit ?? 50));
    const rows = db
      .prepare('SELECT * FROM system_health_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(lim) as SystemHealthEventRow[];

    return rows.map((row) => ({
      id: row.id,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      avgLatencyMs: row.avg_latency_ms,
      maxLatencyMs: row.max_latency_ms,
      sampleCount: row.sample_count,
      errorCount: row.error_count,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  },

  complianceSummary: (_args: unknown, ctx: GraphQLRequestContext) => {
    requireAuth(ctx);
    ctx.trackRead();
    const userTotals = db
      .prepare(
        `SELECT
          COUNT(*) as totalUsers,
          SUM(CASE WHEN status = 'anonymized' THEN 1 ELSE 0 END) as anonymizedUsers,
          SUM(CASE WHEN totp_enabled = 1 THEN 1 ELSE 0 END) as totpUsers,
          SUM(CASE WHEN phone_verified = 1 THEN 1 ELSE 0 END) as smsUsers,
          SUM(CASE WHEN totp_enabled = 1 OR phone_verified = 1 THEN 1 ELSE 0 END) as mfaAdoptedUsers
         FROM users`
      )
      .get() as {
      totalUsers: number;
      anonymizedUsers: number;
      totpUsers: number;
      smsUsers: number;
      mfaAdoptedUsers: number;
    };
    ctx.trackRead();
    const consentTotals = db
      .prepare(
        `SELECT
          SUM(CASE WHEN granted = 1 THEN 1 ELSE 0 END) as activeConsents,
          SUM(CASE WHEN granted = 0 THEN 1 ELSE 0 END) as revokedConsents
         FROM consent_records`
      )
      .get() as { activeConsents: number | null; revokedConsents: number | null };
    ctx.trackRead();
    const logsCount = db.prepare('SELECT COUNT(*) as cnt FROM audit_logs').get() as { cnt: number };

    return {
      totalUsers: userTotals.totalUsers || 0,
      anonymizedUsers: userTotals.anonymizedUsers || 0,
      activeConsents: consentTotals.activeConsents || 0,
      revokedConsents: consentTotals.revokedConsents || 0,
      mfaAdoptedUsers: userTotals.mfaAdoptedUsers || 0,
      totpUsers: userTotals.totpUsers || 0,
      smsUsers: userTotals.smsUsers || 0,
      piiMaskedLogsCount: logsCount.cnt || 0,
    };
  },

  exportMyDataJson: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const settings = getPlatformSettings();
    if (!settings.allowDataPortabilityExport && !jwt.roles.includes('super_admin')) {
      throw new Error('FORBIDDEN: A exportação de portabilidade JSON pelo titular está desativada pela política global.');
    }
    ctx.trackRead();
    const user = db.prepare('SELECT id, email, display_name, phone_number, phone_verified, mfa_preferred_method, totp_enabled, status, created_at, updated_at FROM users WHERE id = ?').get(jwt.sub);
    const bindings = db.prepare('SELECT s.name as system, s.slug, r.name as role, usb.created_at FROM user_system_bindings usb JOIN systems s ON s.id = usb.system_id JOIN roles r ON r.id = usb.role_id WHERE usb.user_id = ?').all(jwt.sub);
    const consents = db.prepare('SELECT s.name as system, cr.policy_version, cr.purposes_json, cr.granted, cr.updated_at FROM consent_records cr JOIN systems s ON s.id = cr.system_id WHERE cr.user_id = ?').all(jwt.sub);
    const externalIdentities = db.prepare('SELECT provider_type, external_email, linked_at FROM external_identities WHERE user_id = ?').all(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'LGPD_SAR_DATA_EXPORT',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        regulation: 'LGPD (Art. 18) / GDPR (Art. 20 Data Portability)',
        subject: user,
        systemBindings: bindings,
        consents,
        externalIdentities,
      },
      null,
      2
    );
  },

  systemSettings: (_args: unknown, ctx: GraphQLRequestContext) => {
    requireSuperAdmin(ctx);
    return buildSystemSettingsPayload(getPlatformSettings(), ctx);
  },

  systemErrorLogs: ({ limit }: { limit?: number }, ctx: GraphQLRequestContext) => {
    requireSuperAdmin(ctx);
    ctx.trackRead();
    const safeLimit = Math.min(10, Math.max(1, limit ?? 10));
    return getRecentSystemErrors(safeLimit).map(mapSystemErrorLog);
  },

  // ================== MUTATIONS ==================
  createSystem: ({ input }: { input: Record<string, unknown> }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:systems:write');
    const settings = getPlatformSettings();
    const started = performance.now();
    const id = `sys-${crypto.randomBytes(4).toString('hex')}`;
    const cleanSlug = String(input.slug).trim();
    const clientId = `cid_${cleanSlug.replace(/-/g, '_').replace(/[^a-z0-9_]/gi, '_')}`;
    const rawSecret = `csec_${crypto.randomBytes(20).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO systems (
        id, name, slug, description, client_id, client_secret_hash, redirect_uris,
        allowed_grants, allowed_idps, jwt_ttl_seconds, signing_alg, hs256_secret,
        require_mfa, allowed_mfa_methods, password_min_length, edge_cache_ttl,
        policy_version, privacy_policy_version, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(input.name),
      cleanSlug,
      String(input.description || ''),
      clientId,
      sha256Hex(rawSecret),
      JSON.stringify(input.redirectUris || ['http://localhost:3000/oauth/sandbox']),
      JSON.stringify(input.allowedGrants || ['authorization_code', 'password', 'refresh_token']),
      JSON.stringify(input.allowedIdps || ['google', 'github', 'oidc_generic']),
      Number(input.jwtTtlSeconds || settings.defaultJwtTtlSeconds),
      String(input.signingAlg || settings.defaultSigningAlg),
      crypto.randomBytes(32).toString('hex'),
      input.requireMfa ? 1 : 0,
      JSON.stringify(input.allowedMfaMethods || ['totp', 'sms']),
      Number(input.passwordMinLength || settings.globalPasswordMinLength),
      Number(input.edgeCacheTtl ?? settings.defaultEdgeCacheTtl),
      1,
      String(input.privacyPolicyVersion || settings.defaultPrivacyPolicyVersion),
      String(input.status || 'active'),
      now,
      now
    );

    // Bootstrap default member role & permission
    const defaultRoleId = `role-${crypto.randomBytes(4).toString('hex')}`;
    const defaultPermId = `perm-${crypto.randomBytes(4).toString('hex')}`;
    db.prepare('INSERT INTO roles (id, system_id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      defaultRoleId,
      id,
      'member',
      'Funcao padrao para usuarios vinculados ao sistema',
      1,
      now
    );
    db.prepare('INSERT INTO permissions (id, system_id, code, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
      defaultPermId,
      id,
      `${cleanSlug}:read`,
      'Acesso basico de leitura',
      now
    );
    db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(defaultRoleId, defaultPermId);
    dbStats.totalWrites += 4;
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: id,
      systemSlug: cleanSlug,
      action: 'SYSTEM_CREATED',
      resourceType: 'system',
      resourceId: id,
      status: 'success',
      durationMs: performance.now() - started,
      ip: ctx.ip,
      details: { slug: cleanSlug, clientId, signingAlg: input.signingAlg, jwtTtlSeconds: input.jwtTtlSeconds },
    });

    const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow;
    return mapSystem(row, ctx);
  },

  updateSystem: ({ id, input }: { id: string; input: Record<string, unknown> }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:systems:write');
    const started = performance.now();
    const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Sistema nao encontrado.');

    const nextSlug = String(input.slug ?? existing.slug).trim();
    const nextClientId = `cid_${nextSlug.replace(/-/g, '_').replace(/[^a-z0-9_]/gi, '_')}`;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE systems SET
        name = ?, slug = ?, client_id = ?, description = ?, redirect_uris = ?, allowed_grants = ?,
        allowed_idps = ?, jwt_ttl_seconds = ?, signing_alg = ?, require_mfa = ?,
        allowed_mfa_methods = ?, password_min_length = ?, edge_cache_ttl = ?,
        privacy_policy_version = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(input.name ?? existing.name),
      nextSlug,
      nextClientId,
      String(input.description ?? existing.description),
      JSON.stringify(input.redirectUris ?? JSON.parse(existing.redirect_uris)),
      JSON.stringify(input.allowedGrants ?? JSON.parse(existing.allowed_grants)),
      JSON.stringify(input.allowedIdps ?? JSON.parse(existing.allowed_idps)),
      Number(input.jwtTtlSeconds ?? existing.jwt_ttl_seconds),
      String(input.signingAlg ?? existing.signing_alg),
      input.requireMfa !== undefined ? (input.requireMfa ? 1 : 0) : existing.require_mfa,
      JSON.stringify(input.allowedMfaMethods ?? JSON.parse(existing.allowed_mfa_methods)),
      Number(input.passwordMinLength ?? existing.password_min_length),
      Number(input.edgeCacheTtl ?? existing.edge_cache_ttl),
      String(input.privacyPolicyVersion ?? existing.privacy_policy_version),
      String(input.status ?? existing.status),
      now,
      id
    );
    dbStats.totalWrites += 1;
    bumpSystemPolicyVersion(id);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: id,
      systemSlug: nextSlug,
      action: 'SYSTEM_UPDATED',
      resourceType: 'system',
      resourceId: id,
      status: 'success',
      durationMs: performance.now() - started,
      ip: ctx.ip,
      details: { clientId: nextClientId, jwtTtlSeconds: input.jwtTtlSeconds, requireMfa: input.requireMfa, edgeCacheTtl: input.edgeCacheTtl },
    });

    const row = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow;
    return mapSystem(row, ctx);
  },

  deleteSystem: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:systems:write');
    if (id === 'identity-secure-gate') {
      throw new Error('PROTECTED_RESOURCE: O sistema principal Identity Secure Gate nao pode ser removido.');
    }
    const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Sistema nao encontrado.');

    db.prepare('DELETE FROM systems WHERE id = ?').run(id);
    dbStats.totalWrites += 1;
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: id,
      systemSlug: existing.slug,
      action: 'SYSTEM_DELETED',
      resourceType: 'system',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: `Sistema ${existing.name} removido e cache purgado.` };
  },

  rotateSystemSecret: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:systems:write');
    const existing = db.prepare('SELECT * FROM systems WHERE id = ?').get(id) as SystemRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Sistema nao encontrado.');
    const newClientSecret = `csec_${crypto.randomBytes(24).toString('hex')}`;
    db.prepare('UPDATE systems SET client_secret_hash = ?, updated_at = ? WHERE id = ?').run(
      sha256Hex(newClientSecret),
      new Date().toISOString(),
      id
    );
    dbStats.totalWrites += 1;
    bumpSystemPolicyVersion(id);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: id,
      systemSlug: existing.slug,
      action: 'SYSTEM_SECRET_ROTATED',
      resourceType: 'system',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
    });

    return { systemId: id, clientId: existing.client_id, newClientSecret };
  },

  createUser: ({ input }: { input: Record<string, unknown> }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:users:write');
    const settings = getPlatformSettings();
    const started = performance.now();
    const email = String(input.email).trim().toLowerCase();
    const password = String(input.password || '');
    if (password.length < settings.globalPasswordMinLength) {
      throw new Error(`WEAK_PASSWORD: A senha deve ter no mínimo ${settings.globalPasswordMinLength} caracteres.`);
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) throw new Error('CONFLICT: E-mail ja cadastrado.');

    const id = `usr-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, phone_number, phone_verified,
        mfa_preferred_method, totp_secret_enc, totp_enabled, backup_codes_hash,
        status, perm_version, last_login_at, anonymized_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'none', NULL, 0, NULL, 'active', 1, NULL, NULL, ?, ?)
    `).run(
      id,
      email,
      String(input.displayName),
      hashPassword(String(input.password)),
      input.phoneNumber ? String(input.phoneNumber) : null,
      now,
      now
    );
    dbStats.totalWrites += 1;

    if (input.systemId && input.roleId) {
      db.prepare('INSERT INTO user_system_bindings (id, user_id, system_id, role_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
        `bnd-${crypto.randomBytes(4).toString('hex')}`,
        id,
        String(input.systemId),
        String(input.roleId),
        now
      );
      dbStats.totalWrites += 1;
    }

    purgeAllEdgeCache();
    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: input.systemId ? String(input.systemId) : jwt.systemId,
      systemSlug: jwt.sys,
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: id,
      status: 'success',
      durationMs: performance.now() - started,
      ip: ctx.ip,
      details: { targetEmailMasked: maskEmail(email) },
    });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    return mapUser(row, ctx);
  },

  updateUser: ({ id, input }: { id: string; input: Record<string, unknown> }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:users:write');
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Usuario nao encontrado.');

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET display_name = ?, email = ?, phone_number = ?, status = ?, updated_at = ? WHERE id = ?').run(
      String(input.displayName ?? existing.display_name),
      String(input.email ?? existing.email).trim().toLowerCase(),
      input.phoneNumber !== undefined ? (input.phoneNumber ? String(input.phoneNumber) : null) : existing.phone_number,
      String(input.status ?? existing.status),
      now,
      id
    );
    dbStats.totalWrites += 1;
    bumpUserPermVersion(id);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
      details: { status: input.status ?? existing.status },
    });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    return mapUser(row, ctx);
  },

  deleteUser: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:users:write');
    if (jwt.sub === id) {
      throw new Error('SELF_DELETE_FORBIDDEN: Voce nao pode excluir a propria conta ativa pelo painel admin.');
    }
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Usuario nao encontrado.');

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    dbStats.totalWrites += 1;
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'USER_DELETED',
      resourceType: 'user',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Usuario removido permanentemente e cache invalidado.' };
  },

  assignUserSystemRole: (
    { userId, systemId, roleId }: { userId: string; systemId: string; roleId: string },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requirePermission(ctx, 'iam:users:write');
    const now = new Date().toISOString();
    const exists = db
      .prepare('SELECT id FROM user_system_bindings WHERE user_id = ? AND system_id = ? AND role_id = ?')
      .get(userId, systemId, roleId);
    if (!exists) {
      db.prepare('INSERT INTO user_system_bindings (id, user_id, system_id, role_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
        `bnd-${crypto.randomBytes(4).toString('hex')}`,
        userId,
        systemId,
        roleId,
        now
      );
      dbStats.totalWrites += 1;
    }
    bumpUserPermVersion(userId);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId,
      action: 'USER_ROLE_ASSIGNED',
      resourceType: 'binding',
      resourceId: `${userId}:${systemId}:${roleId}`,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Vinculo de sistema e role aplicado com sucesso.' };
  },

  removeUserSystemBinding: ({ bindingId }: { bindingId: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:users:write');
    const row = db.prepare('SELECT * FROM user_system_bindings WHERE id = ?').get(bindingId) as
      | { user_id: string; system_id: string }
      | undefined;
    if (!row) throw new Error('NOT_FOUND: Vinculo nao encontrado.');

    db.prepare('DELETE FROM user_system_bindings WHERE id = ?').run(bindingId);
    dbStats.totalWrites += 1;
    bumpUserPermVersion(row.user_id);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: row.system_id,
      action: 'USER_BINDING_REMOVED',
      resourceType: 'binding',
      resourceId: bindingId,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Vinculo removido e versao de permissoes atualizada na borda.' };
  },

  createRole: ({ input }: { input: Record<string, unknown> }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:roles:write');
    const roleId = `role-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const systemId = String(input.systemId);

    db.prepare('INSERT INTO roles (id, system_id, name, description, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      roleId,
      systemId,
      String(input.name),
      String(input.description || ''),
      input.isDefault ? 1 : 0,
      now
    );

    const permIds = (input.permissionIds as string[]) || [];
    for (const pid of permIds) {
      db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(roleId, pid);
    }

    const claims = (input.claims as Array<{ claimKey: string; claimValue: string; valueType: string }>) || [];
    for (const c of claims) {
      db.prepare('INSERT OR REPLACE INTO custom_claims (id, role_id, claim_key, claim_value, value_type) VALUES (?, ?, ?, ?, ?)').run(
        `clm-${crypto.randomBytes(4).toString('hex')}`,
        roleId,
        c.claimKey,
        c.claimValue,
        c.valueType || 'string'
      );
    }
    dbStats.totalWrites += 1 + permIds.length + claims.length;
    bumpSystemPolicyVersion(systemId);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId,
      action: 'ROLE_CREATED',
      resourceType: 'role',
      resourceId: roleId,
      status: 'success',
      ip: ctx.ip,
      details: { name: input.name, permissionsCount: permIds.length, claimsCount: claims.length },
    });

    const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as RoleRow;
    return mapRole(row, ctx);
  },

  updateRole: (
    {
      id,
      name,
      description,
      isDefault,
      permissionIds,
      claims,
    }: {
      id: string;
      name: string;
      description?: string;
      isDefault?: boolean;
      permissionIds?: string[];
      claims?: Array<{ claimKey: string; claimValue: string; valueType: string }>;
    },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requirePermission(ctx, 'iam:roles:write');
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Role nao encontrada.');

    const tx = db.transaction(() => {
      db.prepare('UPDATE roles SET name = ?, description = ?, is_default = ? WHERE id = ?').run(
        name,
        description ?? existing.description,
        isDefault !== undefined ? (isDefault ? 1 : 0) : existing.is_default,
        id
      );

      if (permissionIds) {
        db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
        for (const pid of permissionIds) {
          db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(id, pid);
        }
      }

      if (claims) {
        db.prepare('DELETE FROM custom_claims WHERE role_id = ?').run(id);
        for (const c of claims) {
          db.prepare('INSERT INTO custom_claims (id, role_id, claim_key, claim_value, value_type) VALUES (?, ?, ?, ?, ?)').run(
            `clm-${crypto.randomBytes(4).toString('hex')}`,
            id,
            c.claimKey,
            c.claimValue,
            c.valueType || 'string'
          );
        }
      }
    });
    tx();
    dbStats.totalWrites += 1;
    bumpSystemPolicyVersion(existing.system_id);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: existing.system_id,
      action: 'ROLE_UPDATED',
      resourceType: 'role',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
      details: { name, permissionsCount: permissionIds?.length, claimsCount: claims?.length },
    });

    const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow;
    return mapRole(row, ctx);
  },

  deleteRole: ({ id }: { id: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:roles:write');
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Role nao encontrada.');

    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    dbStats.totalWrites += 1;
    bumpSystemPolicyVersion(existing.system_id);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: existing.system_id,
      action: 'ROLE_DELETED',
      resourceType: 'role',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: `Role ${existing.name} removida.` };
  },

  createPermission: (
    { systemId, code, description }: { systemId: string; code: string; description?: string },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requirePermission(ctx, 'iam:roles:write');
    const id = `perm-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO permissions (id, system_id, code, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      systemId,
      code.trim(),
      description || '',
      now
    );
    dbStats.totalWrites += 1;
    purgeSystemEdgeCache(systemId);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId,
      action: 'PERMISSION_CREATED',
      resourceType: 'permission',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
      details: { code },
    });

    return { id, systemId, code: code.trim(), description: description || '' };
  },

  updateIdentityProvider: (
    { id, input }: { id: string; input: Record<string, unknown> },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requirePermission(ctx, 'iam:systems:write');
    const existing = db.prepare('SELECT * FROM identity_providers WHERE id = ?').get(id) as IdentityProviderRow | undefined;
    if (!existing) throw new Error('NOT_FOUND: Provedor IdP nao encontrado.');

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE identity_providers SET
        name = ?, issuer_url = ?, auth_url = ?, token_url = ?, userinfo_url = ?,
        client_id = ?, scopes = ?, simulation_mode = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(input.name ?? existing.name),
      String(input.issuerUrl ?? existing.issuer_url),
      String(input.authUrl ?? existing.auth_url),
      String(input.tokenUrl ?? existing.token_url),
      String(input.userinfoUrl ?? existing.userinfo_url),
      String(input.clientId ?? existing.client_id),
      String(input.scopes ?? existing.scopes),
      input.simulationMode !== undefined ? (input.simulationMode ? 1 : 0) : existing.simulation_mode,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
      now,
      id
    );
    dbStats.totalWrites += 1;
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      action: 'IDP_UPDATED',
      resourceType: 'idp',
      resourceId: id,
      status: 'success',
      ip: ctx.ip,
      details: { providerType: existing.provider_type, enabled: input.enabled },
    });

    const updated = db.prepare('SELECT * FROM identity_providers WHERE id = ?').get(id) as IdentityProviderRow;
    return mapIdp(updated);
  },

  // 2FA Self-Service Mutations (TOTP & SMS)
  setupTotp: async (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const enrollment = await generateTotpEnrollment(jwt.email);
    const encrypted = encryptSecret(enrollment.secretBase32);
    db.prepare('UPDATE users SET totp_secret_enc = ?, updated_at = ? WHERE id = ?').run(
      encrypted,
      new Date().toISOString(),
      jwt.sub
    );
    dbStats.totalWrites += 1;
    return enrollment;
  },

  verifyAndEnableTotp: ({ code }: { code: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.sub) as UserRow | undefined;
    if (!user || !user.totp_secret_enc) {
      throw new Error('PRECONDITION_FAILED: Inicie a configuracao do TOTP primeiro.');
    }
    const secret = decryptSecret(user.totp_secret_enc);
    if (!verifyTotpToken(secret, code)) {
      throw new Error('INVALID_CODE: Codigo TOTP de 6 digitos invalido.');
    }

    const { plainCodes, hashedCodes } = generateBackupCodes();
    const nextPref = user.mfa_preferred_method === 'none' ? 'totp' : user.mfa_preferred_method;
    db.prepare(
      'UPDATE users SET totp_enabled = 1, mfa_preferred_method = ?, backup_codes_hash = ?, updated_at = ? WHERE id = ?'
    ).run(nextPref, JSON.stringify(hashedCodes), new Date().toISOString(), jwt.sub);
    dbStats.totalWrites += 1;
    bumpUserPermVersion(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'MFA_TOTP_ENABLED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return { enabled: true, backupCodes: plainCodes };
  },

  disableTotp: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.sub) as UserRow | undefined;
    const nextPref = user?.phone_verified ? 'sms' : 'none';
    db.prepare(
      'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, backup_codes_hash = NULL, mfa_preferred_method = ?, updated_at = ? WHERE id = ?'
    ).run(nextPref, new Date().toISOString(), jwt.sub);
    dbStats.totalWrites += 1;
    bumpUserPermVersion(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'MFA_TOTP_DISABLED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Autenticador TOTP desativado.' };
  },

  requestSmsSetup: ({ phoneNumber }: { phoneNumber: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const settings = getPlatformSettings();
    const cleanPhone = phoneNumber.trim();
    if (cleanPhone.length < 8) {
      throw new Error('INVALID_PHONE: Informe um numero de telefone valido com DDI/DDD.');
    }
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + settings.smsOtpTtlSeconds * 1000).toISOString();
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO sms_otps (id, user_id, phone_number, code_hash, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(`sms-${crypto.randomBytes(4).toString('hex')}`, jwt.sub, cleanPhone, sha256Hex(code), 'enroll', expiresAt, now);
    dbStats.totalWrites += 1;

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'MFA_SMS_OTP_DISPATCHED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
      details: { purpose: 'enroll' },
    });

    const maskedPhone = `${cleanPhone.slice(0, 4)}****${cleanPhone.slice(-3)}`;
    return {
      sent: true,
      maskedPhone,
      expiresInSeconds: settings.smsOtpTtlSeconds,
      sandboxCodePreview: settings.smsSandboxPreview ? code : '',
    };
  },

  verifyAndEnableSms: ({ phoneNumber, code }: { phoneNumber: string; code: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const cleanPhone = phoneNumber.trim();
    const row = db
      .prepare(
        `SELECT * FROM sms_otps
         WHERE user_id = ? AND phone_number = ? AND purpose = 'enroll' AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(jwt.sub, cleanPhone) as { id: string; code_hash: string; expires_at: string } | undefined;

    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.code_hash !== sha256Hex(code.trim())) {
      throw new Error('INVALID_CODE: Codigo SMS invalido ou expirado.');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE sms_otps SET consumed_at = ? WHERE id = ?').run(now, row.id);
    const user = db.prepare('SELECT mfa_preferred_method FROM users WHERE id = ?').get(jwt.sub) as
      | { mfa_preferred_method: string }
      | undefined;
    const nextPref = user?.mfa_preferred_method === 'none' ? 'sms' : user?.mfa_preferred_method || 'sms';

    db.prepare(
      'UPDATE users SET phone_number = ?, phone_verified = 1, mfa_preferred_method = ?, updated_at = ? WHERE id = ?'
    ).run(cleanPhone, nextPref, now, jwt.sub);
    dbStats.totalWrites += 2;
    bumpUserPermVersion(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'MFA_SMS_ENABLED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Verificacao por SMS ativada com sucesso.' };
  },

  disableSms: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(jwt.sub) as
      | { totp_enabled: number }
      | undefined;
    const nextPref = user?.totp_enabled ? 'totp' : 'none';
    db.prepare('UPDATE users SET phone_verified = 0, mfa_preferred_method = ?, updated_at = ? WHERE id = ?').run(
      nextPref,
      new Date().toISOString(),
      jwt.sub
    );
    dbStats.totalWrites += 1;
    bumpUserPermVersion(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'MFA_SMS_DISABLED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Verificacao por SMS desativada.' };
  },

  setPreferredMfaMethod: ({ method }: { method: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    if (!['totp', 'sms', 'none'].includes(method)) {
      throw new Error('INVALID_METHOD: Metodo 2FA invalido.');
    }
    db.prepare('UPDATE users SET mfa_preferred_method = ?, updated_at = ? WHERE id = ?').run(
      method,
      new Date().toISOString(),
      jwt.sub
    );
    dbStats.totalWrites += 1;
    return { success: true, message: `Metodo 2FA preferencial atualizado para ${method}.` };
  },

  updateProfile: ({ displayName, phoneNumber }: { displayName: string; phoneNumber?: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    db.prepare('UPDATE users SET display_name = ?, phone_number = ?, updated_at = ? WHERE id = ?').run(
      displayName.trim(),
      phoneNumber ? phoneNumber.trim() : null,
      new Date().toISOString(),
      jwt.sub
    );
    dbStats.totalWrites += 1;
    bumpUserPermVersion(jwt.sub);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'PROFILE_UPDATED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.sub) as UserRow;
    return mapUser(row, ctx);
  },

  changePassword: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const settings = getPlatformSettings();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(jwt.sub) as UserRow | undefined;
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      throw new Error('INVALID_CREDENTIALS: Senha atual incorreta.');
    }
    if (newPassword.length < settings.globalPasswordMinLength) {
      throw new Error(`WEAK_PASSWORD: A nova senha deve ter no minimo ${settings.globalPasswordMinLength} caracteres.`);
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      new Date().toISOString(),
      jwt.sub
    );
    dbStats.totalWrites += 1;

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'PASSWORD_CHANGED',
      resourceType: 'user',
      resourceId: jwt.sub,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Senha alterada com seguranca.' };
  },

  revokeSession: ({ sessionId }: { sessionId: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | { id: string; user_id: string; jti: string }
      | undefined;
    if (!session) throw new Error('NOT_FOUND: Sessao nao encontrada.');
    if (session.user_id !== jwt.sub) {
      requirePermission(ctx, 'iam:users:write');
    }
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
    dbStats.totalWrites += 1;
    bumpUserPermVersion(session.user_id);

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'SESSION_REVOKED',
      resourceType: 'session',
      resourceId: sessionId,
      status: 'success',
      ip: ctx.ip,
    });

    return { success: true, message: 'Sessao revogada na borda.' };
  },

  recordConsent: (
    { systemId, granted, purposes }: { systemId: string; granted: boolean; purposes?: string[] },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requireAuth(ctx);
    const system = db.prepare('SELECT * FROM systems WHERE id = ?').get(systemId) as SystemRow | undefined;
    if (!system) throw new Error('NOT_FOUND: Sistema nao encontrado.');

    const now = new Date().toISOString();
    const purposesJson = JSON.stringify(purposes || ['authentication', 'security_audit']);
    db.prepare(`
      INSERT INTO consent_records (id, user_id, system_id, policy_version, purposes_json, granted, ip_masked, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, system_id) DO UPDATE SET
        policy_version = excluded.policy_version,
        purposes_json = excluded.purposes_json,
        granted = excluded.granted,
        ip_masked = excluded.ip_masked,
        updated_at = excluded.updated_at
    `).run(
      `cns-${crypto.randomBytes(4).toString('hex')}`,
      jwt.sub,
      systemId,
      system.privacy_policy_version,
      purposesJson,
      granted ? 1 : 0,
      maskIp(ctx.ip),
      now
    );
    dbStats.totalWrites += 1;

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId,
      systemSlug: system.slug,
      action: granted ? 'LGPD_CONSENT_GRANTED' : 'LGPD_CONSENT_REVOKED',
      resourceType: 'consent',
      resourceId: `${jwt.sub}:${systemId}`,
      status: 'success',
      ip: ctx.ip,
      details: { policyVersion: system.privacy_policy_version },
    });

    return { success: true, message: granted ? 'Consentimento registrado.' : 'Consentimento revogado.' };
  },

  anonymizeUserAccount: ({ userId }: { userId: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireAuth(ctx);
    const settings = getPlatformSettings();
    if (jwt.sub !== userId) {
      requirePermission(ctx, 'iam:users:write');
    } else if (!settings.allowSelfErasure && !jwt.roles.includes('super_admin')) {
      throw new Error('FORBIDDEN: Solicitação de anonimização direta pelo titular está desativada pela política global.');
    }
    const now = new Date().toISOString();
    const anonHash = sha256Hex(`anon:${userId}:${now}`).slice(0, 12);
    db.prepare(`
      UPDATE users SET
        email = ?, display_name = ?, phone_number = NULL, phone_verified = 0,
        totp_secret_enc = NULL, totp_enabled = 0, backup_codes_hash = NULL,
        mfa_preferred_method = 'none', status = 'anonymized', anonymized_at = ?, updated_at = ?
      WHERE id = ?
    `).run(`anon_${anonHash}@redacted.lgpd`, `Titular Anonimizado #${anonHash.slice(0, 6)}`, now, now, userId);
    db.prepare('DELETE FROM external_identities WHERE user_id = ?').run(userId);
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId);
    dbStats.totalWrites += 3;
    bumpUserPermVersion(userId);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'LGPD_RIGHT_TO_ERASURE_EXECUTED',
      resourceType: 'user',
      resourceId: userId,
      status: 'success',
      ip: ctx.ip,
      details: { auditIntegrityPreserved: true },
    });

    return { success: true, message: 'Dados pessoais anonimizados conforme LGPD/GDPR mantendo integridade de auditoria.' };
  },

  purgeEdgeCache: ({ systemId }: { systemId?: string }, ctx: GraphQLRequestContext) => {
    const jwt = requirePermission(ctx, 'iam:cache:purge');
    const purged = systemId ? purgeSystemEdgeCache(systemId) : purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: systemId || jwt.systemId,
      action: 'EDGE_CACHE_PURGED',
      resourceType: 'cache',
      resourceId: systemId || 'global',
      status: 'success',
      ip: ctx.ip,
      details: { purgedEntries: purged },
    });

    return purged;
  },

  updateSystemSettings: (
    { input }: { input: Partial<PlatformSettings> },
    ctx: GraphQLRequestContext
  ) => {
    const jwt = requireSuperAdmin(ctx);
    const started = performance.now();
    const prevEnv = getPlatformSettings().executionEnvironment;
    const updated = updatePlatformSettings(input, jwt.email);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action:
        prevEnv !== updated.executionEnvironment
          ? 'PLATFORM_ENVIRONMENT_CHANGED'
          : 'PLATFORM_SETTINGS_UPDATED',
      resourceType: 'system_settings',
      resourceId: 'platform_config',
      status: 'success',
      durationMs: performance.now() - started,
      ip: ctx.ip,
      details: {
        previousEnvironment: prevEnv,
        executionEnvironment: updated.executionEnvironment,
        edgeCacheEnabled: updated.edgeCacheEnabled,
        globalRequireMfa: updated.globalRequireMfa,
        allowSelfRegistration: updated.allowSelfRegistration,
      },
    });

    return buildSystemSettingsPayload(updated, ctx);
  },

  resetSystemSettings: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireSuperAdmin(ctx);
    const started = performance.now();
    const reset = resetPlatformSettings(jwt.email);
    purgeAllEdgeCache();

    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'PLATFORM_SETTINGS_RESET',
      resourceType: 'system_settings',
      resourceId: 'platform_config',
      status: 'success',
      durationMs: performance.now() - started,
      ip: ctx.ip,
      details: { executionEnvironment: reset.executionEnvironment },
    });

    return buildSystemSettingsPayload(reset, ctx);
  },

  triggerDiagnosticException: ({ message }: { message?: string }, ctx: GraphQLRequestContext) => {
    const jwt = requireSuperAdmin(ctx);
    const reason =
      message?.trim() || 'Exceção de diagnóstico gerada manualmente pelo administrador na aba Configurações.';
    try {
      throw new Error(reason);
    } catch (capturedErr) {
      const recorded = recordSystemException(capturedErr, {
        source: 'diagnostic',
        operationOrRoute: 'Mutation.triggerDiagnosticException',
        httpMethod: 'POST',
        statusCode: 500,
        actorEmail: jwt.email,
        systemSlug: jwt.sys,
        metadata: { triggeredBy: jwt.sub, diagnostic: true },
      });
      if (!recorded) {
        throw new Error('Falha ao persistir exceção de diagnóstico.');
      }
      return mapSystemErrorLog(recorded);
    }
  },

  clearSystemErrorLogs: (_args: unknown, ctx: GraphQLRequestContext) => {
    const jwt = requireSuperAdmin(ctx);
    const removed = clearSystemErrors();
    recordStructuredAudit({
      actorId: jwt.sub,
      actorEmail: jwt.email,
      systemId: jwt.systemId,
      systemSlug: jwt.sys,
      action: 'SYSTEM_ERROR_LOGS_CLEARED',
      resourceType: 'system_error_logs',
      resourceId: 'all',
      status: 'success',
      ip: ctx.ip,
      details: { removedCount: removed },
    });
    return removed;
  },
};

export async function graphqlHandler(req: Request, res: Response): Promise<void> {
  const started = performance.now();
  const { query, variables, operationName } = (req.body || {}) as {
    query?: string;
    variables?: Record<string, unknown>;
    operationName?: string;
  };

  if (!query || typeof query !== 'string') {
    res.status(400).json({ errors: [{ message: 'Query GraphQL obrigatoria.' }] });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const jwt = bearer ? await verifyIncomingJwt(bearer) : null;

  if (!jwt) {
    res.status(401).json({ errors: [{ message: 'UNAUTHENTICATED: Bearer JWT valido requerido.' }] });
    return;
  }

  // Inspect operation type via GraphQL AST
  let isMutation = false;
  let opLabel = operationName || 'anonymous';
  try {
    const doc = parse(query);
    for (const def of doc.definitions) {
      if (def.kind === 'OperationDefinition') {
        if (def.operation === 'mutation') isMutation = true;
        if (def.name?.value) opLabel = def.name.value;
      }
    }
  } catch {
    // Let graphql() return syntax error
  }

  const settings = getPlatformSettings();
  const bypassCache =
    !settings.edgeCacheEnabled ||
    req.headers['x-bypass-cache'] === 'true' ||
    query.includes('edgeMetrics') ||
    query.includes('exportMyDataJson') ||
    query.includes('systemSettings') ||
    query.includes('systemErrorLogs');

  // Distributed Edge Cache Lookup for read queries (respecting JWT expiry & permission version)
  let cacheKey = '';
  let effectiveTtl = 0;

  if (!isMutation && !bypassCache) {
    const systemRow = db
      .prepare('SELECT edge_cache_ttl FROM systems WHERE id = ?')
      .get(jwt.systemId) as { edge_cache_ttl: number } | undefined;
    const policyTtl = systemRow?.edge_cache_ttl ?? settings.defaultEdgeCacheTtl;
    effectiveTtl = computeEffectiveCacheTtl(policyTtl, jwt.exp);

    if (effectiveTtl > 0) {
      const kvUserVer = getKvUserPermVersion(jwt.sub);
      const kvSysVer = getKvSystemPolicyVersion(jwt.systemId);
      const claimsResolved = resolveUserSystemClaims(jwt.sub, jwt.systemId);

      cacheKey = buildEdgeCacheKey({
        operation: query,
        variablesJson: JSON.stringify(variables || {}),
        systemId: jwt.systemId,
        subjectId: jwt.sub,
        roleScopeHash: claimsResolved.roleScopeHash,
        userPermVer: kvUserVer,
        sysPolVer: kvSysVer,
      });

      const cached = getEdgeCached(cacheKey);
      if (cached.hit) {
        const durationMs = performance.now() - started;
        recordEdgeCacheOutcome('HIT', durationMs);
        res.setHeader('CF-Cache-Status', 'HIT');
        res.setHeader('Cache-Control', `private, max-age=${cached.remainingTtlSeconds ?? effectiveTtl}`);
        res.setHeader('X-Cache-Key', cacheKey);
        res.setHeader('X-Cache-TTL-Remaining', String(cached.remainingTtlSeconds ?? effectiveTtl));
        res.setHeader('X-Query-Duration-Ms', durationMs.toFixed(2));
        res.setHeader('X-SQLite-Queries-Count', '0');
        res.json(cached.payload);
        return;
      }
    }
  }

  let sqlQueriesCount = 0;
  const trackRead = () => {
    sqlQueriesCount += 1;
    dbStats.totalReads += 1;
  };

  const ctx: GraphQLRequestContext = {
    jwt,
    ip: req.ip || '0.0.0.0',
    sqlQueriesCount: 0,
    trackRead,
    loaders: createLoaders(trackRead),
  };

  const result = await graphql({
    schema,
    source: query,
    rootValue,
    contextValue: ctx,
    variableValues: variables,
    operationName,
  });

  if (result.errors && result.errors.length > 0) {
    for (const gqlErr of result.errors) {
      recordSystemException(gqlErr.originalError ?? gqlErr, {
        source: 'graphql',
        operationOrRoute: opLabel,
        httpMethod: req.method,
        statusCode: gqlErr.originalError ? 500 : 400,
        actorEmail: jwt.email,
        systemSlug: jwt.sys,
        metadata: {
          path: gqlErr.path,
          locations: gqlErr.locations,
        },
      });
    }
  }

  const durationMs = performance.now() - started;
  const cacheStatus: 'HIT' | 'MISS' | 'BYPASS' =
    !isMutation && !bypassCache && effectiveTtl > 0 && !result.errors ? 'MISS' : 'BYPASS';

  if (cacheStatus === 'MISS' && cacheKey) {
    setEdgeCached({
      key: cacheKey,
      payload: result,
      systemId: jwt.systemId,
      subjectId: jwt.sub,
      ttlSeconds: effectiveTtl,
    });
  }
  recordEdgeCacheOutcome(cacheStatus, durationMs);

  res.setHeader('CF-Cache-Status', cacheStatus);
  res.setHeader('Cache-Control', cacheStatus === 'MISS' ? `private, max-age=${effectiveTtl}` : 'no-store');
  if (cacheKey) res.setHeader('X-Cache-Key', cacheKey);
  res.setHeader('X-Cache-TTL-Remaining', String(effectiveTtl));
  res.setHeader('X-Query-Duration-Ms', durationMs.toFixed(2));
  res.setHeader('X-SQLite-Queries-Count', String(sqlQueriesCount));
  res.setHeader('X-GraphQL-Operation', opLabel);

  res.json(result);
}
