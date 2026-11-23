export interface DiagnosticHeaders {
  cacheStatus: string;
  cacheKey: string;
  ttlRemaining: number;
  durationMs: number;
  sqliteQueriesCount: number;
  operation: string;
  timestamp: string;
}

export interface CustomClaim {
  id: string;
  roleId: string;
  claimKey: string;
  claimValue: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
}

export interface Permission {
  id: string;
  systemId: string;
  code: string;
  description: string;
}

export interface Role {
  id: string;
  systemId: string;
  name: string;
  description: string;
  isDefault: boolean;
  permissions: Permission[];
  claims: CustomClaim[];
}

export interface IamSystem {
  id: string;
  name: string;
  slug: string;
  description: string;
  clientId: string;
  redirectUris: string[];
  allowedGrants: string[];
  allowedIdps: string[];
  jwtTtlSeconds: number;
  signingAlg: 'RS256' | 'HS256';
  requireMfa: boolean;
  allowedMfaMethods: string[];
  passwordMinLength: number;
  edgeCacheTtl: number;
  policyVersion: number;
  privacyPolicyVersion: string;
  status: 'active' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
  roles?: Role[];
  permissions?: Permission[];
  userCount?: number;
}

export interface UserBinding {
  id: string;
  userId: string;
  systemId: string;
  systemName: string;
  systemSlug: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  createdAt: string;
}

export interface UserSession {
  id: string;
  systemId: string;
  systemName: string;
  jti: string;
  authMethod: string;
  ipMasked: string;
  userAgent: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  systemId: string;
  systemName: string;
  policyVersion: string;
  purposes: string[];
  granted: boolean;
  ipMasked: string;
  updatedAt: string;
}

export interface ExternalIdentity {
  id: string;
  providerType: string;
  externalEmail: string;
  linkedAt: string;
}

export interface IamUser {
  id: string;
  email: string;
  displayName: string;
  phoneNumber: string | null;
  phoneVerified: boolean;
  mfaPreferredMethod: 'totp' | 'sms' | 'none';
  totpEnabled: boolean;
  status: 'active' | 'locked' | 'anonymized';
  permVersion: number;
  lastLoginAt: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bindings: UserBinding[];
  sessions?: UserSession[];
  consents?: ConsentRecord[];
  externalIdentities?: ExternalIdentity[];
}

export interface IdentityProvider {
  id: string;
  name: string;
  providerType: 'google' | 'github' | 'oidc_generic' | 'entra_saml';
  issuerUrl: string;
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  scopes: string;
  simulationMode: boolean;
  enabled: boolean;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  traceId: string;
  actorHash: string;
  actorMasked: string;
  systemId: string | null;
  systemSlug: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  status: 'success' | 'denied' | 'error';
  cacheStatus: string;
  durationMs: number;
  ipMasked: string;
  detailsJson: string;
  createdAt: string;
}

export interface EdgeMetrics {
  cacheHits: number;
  cacheMisses: number;
  cacheBypasses: number;
  cachePurges: number;
  cachedEntriesCount: number;
  cacheHitRatioPct: number;
  kvVersionReads: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgHitLatencyMs: number;
  avgMissLatencyMs: number;
  sqliteTotalReads: number;
  sqliteTotalWrites: number;
  sqliteReadRatioPct: number;
  batchedAuditFlushes: number;
  queuedAuditLogs: number;
  activeSseStreams: number;
}

export interface ComplianceSummary {
  totalUsers: number;
  anonymizedUsers: number;
  activeConsents: number;
  revokedConsents: number;
  mfaAdoptedUsers: number;
  totpUsers: number;
  smsUsers: number;
  piiMaskedLogsCount: number;
}

export interface AuthSessionState {
  token: string;
  expiresAt: string;
  system: {
    id: string;
    name: string;
    slug: string;
    signingAlg?: string;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
    permissions: string[];
    claims: Record<string, unknown>;
  };
}

export type ExecutionEnvironment = 'Desenvolvimento' | 'Homologação' | 'Produção';

export interface LatencyTrendPoint {
  minuteIso: string;
  avgLatencyMs: number;
  maxLatencyMs: number;
  sampleCount: number;
}

export interface SystemHealthEvent {
  id: string;
  previousStatus: 'healthy' | 'degraded' | 'critical' | null;
  newStatus: 'healthy' | 'degraded' | 'critical';
  avgLatencyMs: number;
  maxLatencyMs: number;
  sampleCount: number;
  errorCount: number;
  reason: string;
  createdAt: string;
}

export interface PublicPlatformConfig {
  executionEnvironment: ExecutionEnvironment;
  platformName: string;
  allowSelfRegistration: boolean;
  sessionWarningSeconds: number;
  telemetryStreamEnabled: boolean;
  healthAlertSoundEnabled?: boolean;
  defaultJwtTtlSeconds: number;
  defaultSigningAlg: 'RS256' | 'HS256';
  defaultEdgeCacheTtl: number;
  defaultPrivacyPolicyVersion: string;
  pkceRequired: boolean;
  systemIdPrefix: string;
  clientIdPrefix: string;
  normalizeIdentifiers: boolean;
  systemIdSeparator: '_' | '-';
  clientIdSeparator: '_' | '-';
}

export interface PlatformSystemSettings {
  executionEnvironment: ExecutionEnvironment;
  platformName: string;
  jwtIssuer: string;
  appBaseUrl: string;
  defaultJwtTtlSeconds: number;
  defaultSigningAlg: 'RS256' | 'HS256';
  sessionWarningSeconds: number;
  oauthCodeTtlSeconds: number;
  pkceRequired: boolean;
  allowSelfRegistration: boolean;
  globalRequireMfa: boolean;
  globalPasswordMinLength: number;
  maxLoginAttempts: number;
  smsOtpTtlSeconds: number;
  smsSandboxPreview: boolean;
  jitProvisioningEnabled: boolean;
  edgeCacheEnabled: boolean;
  defaultEdgeCacheTtl: number;
  auditFlushBatchSize: number;
  auditRetentionDays: number;
  piiMaskingEnabled: boolean;
  telemetryStreamEnabled: boolean;
  healthAlertSoundEnabled: boolean;
  defaultPrivacyPolicyVersion: string;
  requireExplicitConsent: boolean;
  allowDataPortabilityExport: boolean;
  allowSelfErasure: boolean;
  systemIdPrefix: string;
  clientIdPrefix: string;
  normalizeIdentifiers: boolean;
  systemIdSeparator: '_' | '-';
  clientIdSeparator: '_' | '-';
  updatedAt: string;
  updatedBy: string;
  runtime?: {
    sqliteJournalMode: string;
    d1Compatible: boolean;
    rsaKeyId: string;
    activeSystemsCount: number;
    activeUsersCount: number;
  };
}

export interface SystemErrorLog {
  id: string;
  traceId: string;
  errorName: string;
  message: string;
  stackTrace: string;
  source: string;
  operationOrRoute: string;
  httpMethod: string;
  statusCode: number;
  actorMasked: string;
  systemSlug: string | null;
  metadataJson: string;
  createdAt: string;
}
