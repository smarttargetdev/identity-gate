/**
 * File: Settings.ts
 * Kind: TypeScript
 * Container: /server
 * Summary: Gerenciamento, validação e persistência de configurações globais da plataforma IAM.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import { db, dbStats, setAuditBatchSize } from './Db.ts';
import {
  MANIFEST_DEFAULT_DESCRIPTION,
  MANIFEST_DEFAULT_NAME,
  readManifest,
  writeManifest,
} from './Manifest.ts';

export type ExecutionEnvironment = 'Desenvolvimento' | 'Homologação' | 'Produção';

export interface PlatformSettings {
  executionEnvironment: ExecutionEnvironment;
  platformName: string;
  platformDescription: string;
  versionNumber: number;
  versionRelease: number;
  versionRevision: number;
  versionBuild: number;
  versionCodename: string;
  companyName: string;
  copyrightYear: string;
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
  infraWorkerName: string;
  infraAccountId: string;
  infraCompatibilityDate: string;
  infraCompatibilityFlags: string;
  infraCustomRoute: string;
  infraWorkersDev: boolean;
  infraWorkerJwtIssuer: string;
  infraD1Binding: string;
  infraD1DatabaseName: string;
  infraD1DatabaseId: string;
  infraKvBinding: string;
  infraKvNamespaceId: string;
  infraBundleFilename: string;
  infraWranglerEnv: string;
  infraIncludeDeployScript: boolean;
  infraIncludeReadme: boolean;
  updatedAt: string;
  updatedBy: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  executionEnvironment: 'Desenvolvimento',
  platformName: MANIFEST_DEFAULT_NAME,
  platformDescription: MANIFEST_DEFAULT_DESCRIPTION,
  versionNumber: 1,
  versionRelease: 1,
  versionRevision: 0,
  versionBuild: 0,
  versionCodename: 'genesis',
  companyName: 'Smart Target',
  copyrightYear: '2026',
  jwtIssuer: process.env.IAM_JWT_ISSUER || 'https://isg.edge.local',
  appBaseUrl: process.env.APP_URL || '',
  defaultJwtTtlSeconds: 3600,
  defaultSigningAlg: 'RS256',
  sessionWarningSeconds: 300,
  oauthCodeTtlSeconds: 300,
  pkceRequired: false,
  allowSelfRegistration: false,
  globalRequireMfa: false,
  globalPasswordMinLength: 8,
  maxLoginAttempts: 5,
  smsOtpTtlSeconds: 300,
  smsSandboxPreview: true,
  jitProvisioningEnabled: true,
  edgeCacheEnabled: true,
  defaultEdgeCacheTtl: 120,
  auditFlushBatchSize: 20,
  auditRetentionDays: 90,
  piiMaskingEnabled: true,
  telemetryStreamEnabled: true,
  healthAlertSoundEnabled: true,
  defaultPrivacyPolicyVersion: '2026.1',
  requireExplicitConsent: true,
  allowDataPortabilityExport: true,
  allowSelfErasure: true,
  systemIdPrefix: 'system',
  clientIdPrefix: 'client',
  normalizeIdentifiers: true,
  systemIdSeparator: '-',
  clientIdSeparator: '_',
  infraWorkerName: 'isg-edge-worker',
  infraAccountId: '',
  infraCompatibilityDate: '2026-03-01',
  infraCompatibilityFlags: 'nodejs_compat',
  infraCustomRoute: '',
  infraWorkersDev: true,
  infraWorkerJwtIssuer: '',
  infraD1Binding: 'DB',
  infraD1DatabaseName: 'isg-d1',
  infraD1DatabaseId: '00000000-0000-0000-0000-000000000000',
  infraKvBinding: 'IAM_KV',
  infraKvNamespaceId: '00000000-0000-0000-0000-000000000000',
  infraBundleFilename: 'isg-cloudflare-d1-bundle',
  infraWranglerEnv: '',
  infraIncludeDeployScript: true,
  infraIncludeReadme: true,
  updatedAt: new Date().toISOString(),
  updatedBy: 'system',
};

let cachedSettings: PlatformSettings | null = null;

function sanitizeEnvironment(val: unknown): ExecutionEnvironment {
  if (val === 'Desenvolvimento' || val === 'Homologação' || val === 'Produção') {
    return val;
  }
  return 'Desenvolvimento';
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function sanitizeSlugToken(val: unknown, fallback: string, allowEmpty = false): string {
  const cleaned = String(val ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned) return allowEmpty ? '' : fallback;
  return cleaned;
}

function sanitizeBindingName(val: unknown, fallback: string): string {
  const cleaned = String(val ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned || !/^[a-zA-Z_]/.test(cleaned)) return fallback;
  return cleaned;
}

function sanitizePlainValue(val: unknown): string {
  return String(val ?? '')
    .trim()
    .replace(/["'`\r\n\\$]/g, '');
}

function normalizeSettings(raw: Partial<PlatformSettings>, updatedBy = 'system'): PlatformSettings {
  const env = sanitizeEnvironment(raw.executionEnvironment ?? DEFAULT_SETTINGS.executionEnvironment);
  const validationCodeTtl = clampInt(
    raw.oauthCodeTtlSeconds ?? raw.smsOtpTtlSeconds,
    DEFAULT_SETTINGS.oauthCodeTtlSeconds,
    60,
    1800
  );
  return {
    executionEnvironment: env,
    platformName: String(raw.platformName ?? DEFAULT_SETTINGS.platformName).trim() || MANIFEST_DEFAULT_NAME,
    platformDescription:
      raw.platformDescription !== undefined
        ? String(raw.platformDescription).trim()
        : DEFAULT_SETTINGS.platformDescription,
    versionNumber: clampInt(raw.versionNumber, DEFAULT_SETTINGS.versionNumber, 0, 999999),
    versionRelease: clampInt(raw.versionRelease, DEFAULT_SETTINGS.versionRelease, 0, 999999),
    versionRevision: clampInt(raw.versionRevision, DEFAULT_SETTINGS.versionRevision, 0, 999999),
    versionBuild: clampInt(raw.versionBuild, DEFAULT_SETTINGS.versionBuild, 0, 999999),
    versionCodename: String(raw.versionCodename ?? DEFAULT_SETTINGS.versionCodename).trim(),
    companyName: String(raw.companyName ?? DEFAULT_SETTINGS.companyName).trim() || 'Smart Target',
    copyrightYear: String(raw.copyrightYear ?? DEFAULT_SETTINGS.copyrightYear).trim() || '2026',
    jwtIssuer: String(raw.jwtIssuer ?? DEFAULT_SETTINGS.jwtIssuer).trim() || DEFAULT_SETTINGS.jwtIssuer,
    appBaseUrl: String(raw.appBaseUrl ?? DEFAULT_SETTINGS.appBaseUrl).trim(),
    defaultJwtTtlSeconds: clampInt(raw.defaultJwtTtlSeconds, DEFAULT_SETTINGS.defaultJwtTtlSeconds, 60, 86400),
    defaultSigningAlg: raw.defaultSigningAlg === 'HS256' ? 'HS256' : 'RS256',
    sessionWarningSeconds: clampInt(raw.sessionWarningSeconds, DEFAULT_SETTINGS.sessionWarningSeconds, 30, 1800),
    oauthCodeTtlSeconds: validationCodeTtl,
    pkceRequired: Boolean(raw.pkceRequired ?? DEFAULT_SETTINGS.pkceRequired),
    allowSelfRegistration: Boolean(raw.allowSelfRegistration ?? DEFAULT_SETTINGS.allowSelfRegistration),
    globalRequireMfa: Boolean(raw.globalRequireMfa ?? DEFAULT_SETTINGS.globalRequireMfa),
    globalPasswordMinLength: clampInt(raw.globalPasswordMinLength, DEFAULT_SETTINGS.globalPasswordMinLength, 6, 64),
    maxLoginAttempts: clampInt(raw.maxLoginAttempts, DEFAULT_SETTINGS.maxLoginAttempts, 3, 50),
    smsOtpTtlSeconds: validationCodeTtl,
    smsSandboxPreview: Boolean(raw.smsSandboxPreview ?? DEFAULT_SETTINGS.smsSandboxPreview),
    jitProvisioningEnabled: Boolean(raw.jitProvisioningEnabled ?? DEFAULT_SETTINGS.jitProvisioningEnabled),
    edgeCacheEnabled: Boolean(raw.edgeCacheEnabled ?? DEFAULT_SETTINGS.edgeCacheEnabled),
    defaultEdgeCacheTtl: clampInt(raw.defaultEdgeCacheTtl, DEFAULT_SETTINGS.defaultEdgeCacheTtl, 0, 3600),
    auditFlushBatchSize: clampInt(raw.auditFlushBatchSize, DEFAULT_SETTINGS.auditFlushBatchSize, 1, 100),
    auditRetentionDays: clampInt(raw.auditRetentionDays, DEFAULT_SETTINGS.auditRetentionDays, 7, 3650),
    piiMaskingEnabled: Boolean(raw.piiMaskingEnabled ?? DEFAULT_SETTINGS.piiMaskingEnabled),
    telemetryStreamEnabled: Boolean(raw.telemetryStreamEnabled ?? DEFAULT_SETTINGS.telemetryStreamEnabled),
    healthAlertSoundEnabled: Boolean(raw.healthAlertSoundEnabled ?? DEFAULT_SETTINGS.healthAlertSoundEnabled),
    defaultPrivacyPolicyVersion:
      String(raw.defaultPrivacyPolicyVersion ?? DEFAULT_SETTINGS.defaultPrivacyPolicyVersion).trim() || '2026.1',
    requireExplicitConsent: Boolean(raw.requireExplicitConsent ?? DEFAULT_SETTINGS.requireExplicitConsent),
    allowDataPortabilityExport: Boolean(raw.allowDataPortabilityExport ?? DEFAULT_SETTINGS.allowDataPortabilityExport),
    allowSelfErasure: Boolean(raw.allowSelfErasure ?? DEFAULT_SETTINGS.allowSelfErasure),
    systemIdPrefix:
      String(raw.systemIdPrefix ?? DEFAULT_SETTINGS.systemIdPrefix)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_SETTINGS.systemIdPrefix,
    clientIdPrefix:
      String(raw.clientIdPrefix ?? DEFAULT_SETTINGS.clientIdPrefix)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_SETTINGS.clientIdPrefix,
    normalizeIdentifiers: Boolean(raw.normalizeIdentifiers ?? DEFAULT_SETTINGS.normalizeIdentifiers),
    systemIdSeparator:
      (raw.systemIdSeparator ??
        (raw as Record<string, unknown>).identifierSeparator ??
        DEFAULT_SETTINGS.systemIdSeparator) === '_'
        ? '_'
        : '-',
    clientIdSeparator:
      (raw.clientIdSeparator ??
        (raw as Record<string, unknown>).identifierSeparator ??
        DEFAULT_SETTINGS.clientIdSeparator) === '-'
        ? '-'
        : '_',
    infraWorkerName: sanitizeSlugToken(
      raw.infraWorkerName ?? DEFAULT_SETTINGS.infraWorkerName,
      DEFAULT_SETTINGS.infraWorkerName
    ),
    infraAccountId: sanitizeSlugToken(raw.infraAccountId ?? DEFAULT_SETTINGS.infraAccountId, '', true),
    infraCompatibilityDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.infraCompatibilityDate ?? '').trim())
      ? String(raw.infraCompatibilityDate).trim()
      : DEFAULT_SETTINGS.infraCompatibilityDate,
    infraCompatibilityFlags:
      String(raw.infraCompatibilityFlags ?? DEFAULT_SETTINGS.infraCompatibilityFlags)
        .split(',')
        .map((f) => f.trim().replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean)
        .join(', ') || DEFAULT_SETTINGS.infraCompatibilityFlags,
    infraCustomRoute: sanitizePlainValue(raw.infraCustomRoute ?? DEFAULT_SETTINGS.infraCustomRoute),
    infraWorkersDev: Boolean(raw.infraWorkersDev ?? DEFAULT_SETTINGS.infraWorkersDev),
    infraWorkerJwtIssuer: sanitizePlainValue(raw.infraWorkerJwtIssuer ?? DEFAULT_SETTINGS.infraWorkerJwtIssuer),
    infraD1Binding: sanitizeBindingName(
      raw.infraD1Binding ?? DEFAULT_SETTINGS.infraD1Binding,
      DEFAULT_SETTINGS.infraD1Binding
    ),
    infraD1DatabaseName: sanitizeSlugToken(
      raw.infraD1DatabaseName ?? DEFAULT_SETTINGS.infraD1DatabaseName,
      DEFAULT_SETTINGS.infraD1DatabaseName
    ),
    infraD1DatabaseId: sanitizeSlugToken(
      raw.infraD1DatabaseId ?? DEFAULT_SETTINGS.infraD1DatabaseId,
      DEFAULT_SETTINGS.infraD1DatabaseId
    ),
    infraKvBinding: sanitizeBindingName(
      raw.infraKvBinding ?? DEFAULT_SETTINGS.infraKvBinding,
      DEFAULT_SETTINGS.infraKvBinding
    ),
    infraKvNamespaceId: sanitizeSlugToken(
      raw.infraKvNamespaceId ?? DEFAULT_SETTINGS.infraKvNamespaceId,
      DEFAULT_SETTINGS.infraKvNamespaceId
    ),
    infraBundleFilename: sanitizeSlugToken(
      raw.infraBundleFilename ?? DEFAULT_SETTINGS.infraBundleFilename,
      DEFAULT_SETTINGS.infraBundleFilename
    ),
    infraWranglerEnv: sanitizeSlugToken(raw.infraWranglerEnv ?? DEFAULT_SETTINGS.infraWranglerEnv, '', true),
    infraIncludeDeployScript: Boolean(raw.infraIncludeDeployScript ?? DEFAULT_SETTINGS.infraIncludeDeployScript),
    infraIncludeReadme: Boolean(raw.infraIncludeReadme ?? DEFAULT_SETTINGS.infraIncludeReadme),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    updatedBy: raw.updatedBy || updatedBy,
  };
}

function syncPrimarySystemIdentity(name: string, description: string): void {
  const existing = db
    .prepare('SELECT name, description, policy_version FROM systems WHERE id = ?')
    .get('identity-secure-gate') as { name: string; description: string; policy_version: number } | undefined;
  if (!existing) return;
  if (existing.name === name && existing.description === description) return;

  const now = new Date().toISOString();
  const nextPolicyVersion = Number(existing.policy_version || 1) + 1;
  db.prepare(
    'UPDATE systems SET name = ?, description = ?, policy_version = ?, updated_at = ? WHERE id = ?'
  ).run(name, description, nextPolicyVersion, now, 'identity-secure-gate');
  db.prepare("INSERT OR REPLACE INTO kv_store (kv_key, kv_value, updated_at) VALUES ('s_ver:identity-secure-gate', ?, ?)").run(
    String(nextPolicyVersion),
    now
  );
  dbStats.totalWrites += 2;
}

function overlayManifest(settings: PlatformSettings): PlatformSettings {
  const manifest = readManifest();
  return {
    ...settings,
    platformName: manifest.system.name,
    platformDescription: manifest.system.description,
    versionNumber: manifest.version.number,
    versionRelease: manifest.version.release,
    versionRevision: manifest.version.revision,
    versionBuild: manifest.version.build,
    versionCodename: manifest.version.codename,
  };
}

function ensureInitialSettingsSeeded(): PlatformSettings {
  const row = db
    .prepare("SELECT setting_value, updated_by, updated_at FROM system_settings WHERE setting_key = 'platform_config'")
    .get() as { setting_value: string; updated_by: string; updated_at: string } | undefined;

  if (row) {
    const parsed = JSON.parse(row.setting_value) as Partial<PlatformSettings>;
    let migrated = false;
    if (
      parsed.platformName === 'Smarties Secure Gate' ||
      parsed.platformName === 'Smarties Gate'
    ) {
      parsed.platformName = 'Identity Secure Gate';
      migrated = true;
    }
    if (
      parsed.jwtIssuer === 'https://smarties-gate.edge.local' ||
      parsed.jwtIssuer === 'https://smarties-secure-gate.edge.local'
    ) {
      parsed.jwtIssuer = 'https://isg.edge.local';
      migrated = true;
    }
    if (
      parsed.systemIdPrefix === 'sys' &&
      parsed.clientIdPrefix === 'cli' &&
      parsed.systemIdSeparator === '_' &&
      parsed.clientIdSeparator === '_'
    ) {
      parsed.systemIdPrefix = 'system';
      parsed.clientIdPrefix = 'client';
      parsed.systemIdSeparator = '-';
      parsed.clientIdSeparator = '_';
      migrated = true;
    }
    const normalized = overlayManifest(
      normalizeSettings({ ...parsed, updatedAt: row.updated_at, updatedBy: row.updated_by })
    );
    if (migrated) {
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE system_settings SET setting_value = ?, updated_at = ? WHERE setting_key = ?'
      ).run(JSON.stringify(normalized), now, 'platform_config');
      dbStats.totalWrites += 1;
    }
    syncPrimarySystemIdentity(normalized.platformName, normalized.platformDescription);
    setAuditBatchSize(normalized.auditFlushBatchSize);
    cachedSettings = normalized;
    return normalized;
  }

  const now = new Date().toISOString();
  const initial = overlayManifest(normalizeSettings({ ...DEFAULT_SETTINGS, updatedAt: now, updatedBy: 'system' }));
  db.prepare(
    'INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES (?, ?, ?, ?)'
  ).run('platform_config', JSON.stringify(initial), 'system', now);
  dbStats.totalWrites += 1;
  syncPrimarySystemIdentity(initial.platformName, initial.platformDescription);
  setAuditBatchSize(initial.auditFlushBatchSize);
  cachedSettings = initial;
  return initial;
}

export function getPlatformSettings(): PlatformSettings {
  if (cachedSettings) return overlayManifest(cachedSettings);
  dbStats.totalReads += 1;
  return ensureInitialSettingsSeeded();
}

export function updatePlatformSettings(
  patch: Partial<PlatformSettings>,
  updatedBy: string
): PlatformSettings {
  const current = getPlatformSettings();
  const now = new Date().toISOString();
  const merged = normalizeSettings(
    {
      ...current,
      ...patch,
      updatedAt: now,
      updatedBy,
    },
    updatedBy
  );

  const writtenManifest = writeManifest({
    system: {
      name: merged.platformName,
      description: merged.platformDescription,
    },
    version: {
      number: merged.versionNumber,
      release: merged.versionRelease,
      revision: merged.versionRevision,
      build: merged.versionBuild,
      codename: merged.versionCodename,
    },
  });

  const synced: PlatformSettings = {
    ...merged,
    platformName: writtenManifest.system.name,
    platformDescription: writtenManifest.system.description,
    versionNumber: writtenManifest.version.number,
    versionRelease: writtenManifest.version.release,
    versionRevision: writtenManifest.version.revision,
    versionBuild: writtenManifest.version.build,
    versionCodename: writtenManifest.version.codename,
  };

  db.prepare(
    'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES (?, ?, ?, ?)'
  ).run('platform_config', JSON.stringify(synced), updatedBy, now);
  dbStats.totalWrites += 1;
  syncPrimarySystemIdentity(synced.platformName, synced.platformDescription);
  setAuditBatchSize(synced.auditFlushBatchSize);
  cachedSettings = synced;
  return synced;
}

export function resetPlatformSettings(updatedBy: string): PlatformSettings {
  const now = new Date().toISOString();
  const defaults = normalizeSettings({ ...DEFAULT_SETTINGS, updatedAt: now, updatedBy }, updatedBy);

  const writtenManifest = writeManifest({
    system: {
      name: defaults.platformName,
      description: defaults.platformDescription,
    },
    version: {
      number: defaults.versionNumber,
      release: defaults.versionRelease,
      revision: defaults.versionRevision,
      build: defaults.versionBuild,
      codename: defaults.versionCodename,
    },
  });

  const synced: PlatformSettings = {
    ...defaults,
    platformName: writtenManifest.system.name,
    platformDescription: writtenManifest.system.description,
    versionNumber: writtenManifest.version.number,
    versionRelease: writtenManifest.version.release,
    versionRevision: writtenManifest.version.revision,
    versionBuild: writtenManifest.version.build,
    versionCodename: writtenManifest.version.codename,
  };

  db.prepare(
    'INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES (?, ?, ?, ?)'
  ).run('platform_config', JSON.stringify(synced), updatedBy, now);
  dbStats.totalWrites += 1;
  syncPrimarySystemIdentity(synced.platformName, synced.platformDescription);
  setAuditBatchSize(synced.auditFlushBatchSize);
  cachedSettings = synced;
  return synced;
}

export function getPublicPlatformConfig() {
  const s = getPlatformSettings();
  return {
    executionEnvironment: s.executionEnvironment,
    platformName: s.platformName,
    platformDescription: s.platformDescription,
    version: {
      number: s.versionNumber,
      release: s.versionRelease,
      revision: s.versionRevision,
      build: s.versionBuild,
      codename: s.versionCodename,
    },
    companyName: s.companyName,
    copyrightYear: s.copyrightYear,
    allowSelfRegistration: s.allowSelfRegistration,
    sessionWarningSeconds: s.sessionWarningSeconds,
    telemetryStreamEnabled: s.telemetryStreamEnabled,
    healthAlertSoundEnabled: s.healthAlertSoundEnabled,
    defaultJwtTtlSeconds: s.defaultJwtTtlSeconds,
    defaultSigningAlg: s.defaultSigningAlg,
    defaultEdgeCacheTtl: s.defaultEdgeCacheTtl,
    defaultPrivacyPolicyVersion: s.defaultPrivacyPolicyVersion,
    pkceRequired: s.pkceRequired,
    systemIdPrefix: s.systemIdPrefix,
    clientIdPrefix: s.clientIdPrefix,
    normalizeIdentifiers: s.normalizeIdentifiers,
    systemIdSeparator: s.systemIdSeparator,
    clientIdSeparator: s.clientIdSeparator,
  };
}

export function buildIdentifierValue(
  prefix: string,
  slug: string,
  normalize: boolean,
  separator: '_' | '-'
): string {
  const sep = separator === '-' ? '-' : '_';
  const rawPrefix = prefix.trim();
  const rawSlug = slug.trim();
  const norm = (val: string) =>
    normalize
      ? val.replace(/[^a-zA-Z0-9]+/g, sep).replace(new RegExp(`^[${sep}]+|[${sep}]+$`, 'g'), '')
      : val.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanPrefix = norm(rawPrefix).replace(/[-_]+$/g, '');
  const cleanSlug = norm(rawSlug).replace(/^[-_]+/g, '');
  if (!cleanPrefix) return cleanSlug;
  if (!cleanSlug) return cleanPrefix;
  return `${cleanPrefix}${sep}${cleanSlug}`;
}
