/**
 * File: CryptoAuth.ts
 * Kind: TypeScript
 * Container: /server
 * Summary: Criptografia de senhas/segredos, chaves RSA JWKS, emissão/validação de JWT e TOTP 2FA.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  jwtVerify,
  type JWK,
  type CryptoKey,
} from 'jose';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { db, type SystemRow, type UserRow } from './Db.ts';
import { getPlatformSettings } from './Settings.ts';

const MASTER_SECRET = process.env.IAM_MASTER_SECRET || 'smarties-gate-edge-master-secret-2026-dev-32b';
const DEFAULT_JWT_ISSUER = process.env.IAM_JWT_ISSUER || 'https://isg.edge.local';

interface PersistedRsaKeys {
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
}

let cachedRsaPrivateKey: CryptoKey | null = null;
let cachedRsaPublicKey: CryptoKey | null = null;
let cachedPublicJwk: JWK | null = null;
let cachedKid = 'vektor-rs256-2026-01';

export async function ensureRsaKeys(): Promise<{
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JWK;
}> {
  if (cachedRsaPrivateKey && cachedRsaPublicKey && cachedPublicJwk) {
    return {
      kid: cachedKid,
      privateKey: cachedRsaPrivateKey,
      publicKey: cachedRsaPublicKey,
      publicJwk: cachedPublicJwk,
    };
  }

  const row = db
    .prepare("SELECT kv_value FROM kv_store WHERE kv_key = 'iam:rsa_keypair'")
    .get() as { kv_value: string } | undefined;

  if (row) {
    const parsed = JSON.parse(row.kv_value) as PersistedRsaKeys;
    cachedKid = parsed.kid;
    cachedPublicJwk = parsed.publicJwk;
    cachedRsaPrivateKey = (await importJWK(parsed.privateJwk, 'RS256')) as CryptoKey;
    cachedRsaPublicKey = (await importJWK(parsed.publicJwk, 'RS256')) as CryptoKey;
    return {
      kid: cachedKid,
      privateKey: cachedRsaPrivateKey,
      publicKey: cachedRsaPublicKey,
      publicJwk: cachedPublicJwk,
    };
  }

  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.kid = cachedKid;
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  privateJwk.kid = cachedKid;
  privateJwk.use = 'sig';
  privateJwk.alg = 'RS256';

  const payload: PersistedRsaKeys = { kid: cachedKid, publicJwk, privateJwk };
  db.prepare(
    "INSERT OR REPLACE INTO kv_store (kv_key, kv_value, updated_at) VALUES ('iam:rsa_keypair', ?, ?)"
  ).run(JSON.stringify(payload), new Date().toISOString());

  cachedRsaPrivateKey = privateKey;
  cachedRsaPublicKey = publicKey;
  cachedPublicJwk = publicJwk;
  return { kid: cachedKid, privateKey, publicKey, publicJwk };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

export function maskIp(ip: string | undefined): string {
  if (!ip) return '0.0.x.x';
  const clean = ip.replace(/^::ffff:/, '');
  const v4 = clean.split('.');
  if (v4.length === 4) {
    return `${v4[0]}.${v4[1]}.x.x`;
  }
  return `${clean.slice(0, 8)}:xxxx`;
}

export function hashSubjectForAudit(userId: string): string {
  return sha256Hex(`audit:${userId}`).slice(0, 16);
}

// Symmetric encryption for TOTP secrets at rest
function getAesKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_SECRET).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAesKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string {
  const [ivHex, tagHex, dataHex] = cipherText.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getAesKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

export async function generateTotpEnrollment(email: string): Promise<{
  secretBase32: string;
  otpauthUri: string;
  qrSvg: string;
}> {
  const issuerName = getPlatformSettings().platformName || 'Identity Secure Gate';
  const totp = new OTPAuth.TOTP({
    issuer: issuerName,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  const otpauthUri = totp.toString();
  const qrSvg = await QRCode.toString(otpauthUri, {
    type: 'svg',
    margin: 1,
    width: 180,
    color: { dark: '#F1F5F9', light: '#0F172A' },
  });
  return {
    secretBase32: totp.secret.base32,
    otpauthUri,
    qrSvg,
  };
}

export function verifyTotpToken(secretBase32: string, code: string): boolean {
  const cleanCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const issuerName = getPlatformSettings().platformName || 'Identity Secure Gate';
  const totp = new OTPAuth.TOTP({
    issuer: issuerName,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: cleanCode, window: 1 });
  return delta !== null;
}

export function generateBackupCodes(): { plainCodes: string[]; hashedCodes: string[] } {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashedCodes.push(sha256Hex(formatted));
  }
  return { plainCodes, hashedCodes };
}

export interface ResolvedUserClaims {
  roles: string[];
  permissions: string[];
  customClaims: Record<string, string | number | boolean | unknown>;
  roleScopeHash: string;
}

const stmtUserSystemClaims = db.prepare(`
  SELECT
    r.id as role_id,
    r.name as role_name,
    p.code as perm_code,
    c.claim_key as claim_key,
    c.claim_value as claim_value,
    c.value_type as value_type
  FROM user_system_bindings usb
  JOIN roles r ON r.id = usb.role_id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id
  LEFT JOIN custom_claims c ON c.role_id = r.id
  WHERE usb.user_id = ? AND usb.system_id = ?
`);

export function resolveUserSystemClaims(userId: string, systemId: string): ResolvedUserClaims {
  const rows = stmtUserSystemClaims.all(userId, systemId) as Array<{
    role_id: string;
    role_name: string;
    perm_code: string | null;
    claim_key: string | null;
    claim_value: string | null;
    value_type: string | null;
  }>;

  const rolesSet = new Set<string>();
  const permsSet = new Set<string>();
  const customClaims: Record<string, unknown> = {};

  for (const r of rows) {
    rolesSet.add(r.role_name);
    if (r.perm_code) permsSet.add(r.perm_code);
    if (r.claim_key && r.claim_value !== null) {
      if (r.value_type === 'number') {
        customClaims[r.claim_key] = Number(r.claim_value);
      } else if (r.value_type === 'boolean') {
        customClaims[r.claim_key] = r.claim_value === 'true';
      } else if (r.value_type === 'json') {
        try {
          customClaims[r.claim_key] = JSON.parse(r.claim_value);
        } catch {
          customClaims[r.claim_key] = r.claim_value;
        }
      } else {
        customClaims[r.claim_key] = r.claim_value;
      }
    }
  }

  const roles = Array.from(rolesSet).sort();
  const permissions = Array.from(permsSet).sort();
  const roleScopeHash = sha256Hex(`${roles.join(',')}|${permissions.join(',')}`).slice(0, 12);

  return { roles, permissions, customClaims, roleScopeHash };
}

export interface VerifiedJwtContext {
  sub: string;
  email: string;
  name: string;
  sys: string;
  systemId: string;
  aud: string;
  jti: string;
  exp: number;
  iat: number;
  roles: string[];
  permissions: string[];
  claims: Record<string, unknown>;
  perm_ver: number;
  pol_ver: number;
  amr: string[];
}

export async function issueSystemJwt(params: {
  user: UserRow;
  system: SystemRow;
  amr: string[];
}): Promise<{
  token: string;
  jti: string;
  expiresAt: string;
  expEpoch: number;
  resolved: ResolvedUserClaims;
}> {
  const { user, system, amr } = params;
  const resolved = resolveUserSystemClaims(user.id, system.id);
  const jti = `jti_${crypto.randomUUID()}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const expEpoch = nowSec + system.jwt_ttl_seconds;
  const expiresAt = new Date(expEpoch * 1000).toISOString();

  const payload = {
    email: user.email,
    name: user.display_name,
    sys: system.slug,
    system_id: system.id,
    roles: resolved.roles,
    permissions: resolved.permissions,
    claims: resolved.customClaims,
    perm_ver: user.perm_version,
    pol_ver: system.policy_version,
    amr,
    scope_hash: resolved.roleScopeHash,
  };

  const activeIssuer = getJwtIssuer();
  let token: string;
  if (system.signing_alg === 'HS256') {
    const secretBytes = new TextEncoder().encode(system.hs256_secret);
    token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(activeIssuer)
      .setSubject(user.id)
      .setAudience(system.client_id)
      .setJti(jti)
      .setIssuedAt(nowSec)
      .setExpirationTime(expEpoch)
      .sign(secretBytes);
  } else {
    const { kid, privateKey } = await ensureRsaKeys();
    token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
      .setIssuer(activeIssuer)
      .setSubject(user.id)
      .setAudience(system.client_id)
      .setJti(jti)
      .setIssuedAt(nowSec)
      .setExpirationTime(expEpoch)
      .sign(privateKey);
  }

  return { token, jti, expiresAt, expEpoch, resolved };
}

export async function verifyIncomingJwt(token: string): Promise<VerifiedJwtContext | null> {
  try {
    // Decode header/payload safely to find target system signing algorithm
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
    const unverifiedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      system_id?: string;
    };

    if (!unverifiedPayload.system_id) return null;
    const system = db
      .prepare('SELECT * FROM systems WHERE id = ? AND status = ?')
      .get(unverifiedPayload.system_id, 'active') as SystemRow | undefined;
    if (!system) return null;

    const activeIssuer = getJwtIssuer();
    let verifiedPayload: Record<string, unknown>;
    if (header.alg === 'HS256' && system.signing_alg === 'HS256') {
      const secretBytes = new TextEncoder().encode(system.hs256_secret);
      const result = await jwtVerify(token, secretBytes, {
        issuer: activeIssuer,
        audience: system.client_id,
      });
      verifiedPayload = result.payload as Record<string, unknown>;
    } else {
      const { publicKey } = await ensureRsaKeys();
      const result = await jwtVerify(token, publicKey, {
        issuer: activeIssuer,
        audience: system.client_id,
      });
      verifiedPayload = result.payload as Record<string, unknown>;
    }

    // Check session revocation in SQLite
    const jti = String(verifiedPayload.jti || '');
    if (jti) {
      const revoked = db
        .prepare('SELECT revoked_at FROM sessions WHERE jti = ?')
        .get(jti) as { revoked_at: string | null } | undefined;
      if (revoked && revoked.revoked_at) {
        return null;
      }
    }

    return {
      sub: String(verifiedPayload.sub || ''),
      email: String(verifiedPayload.email || ''),
      name: String(verifiedPayload.name || ''),
      sys: String(verifiedPayload.sys || ''),
      systemId: String(verifiedPayload.system_id || ''),
      aud: String(verifiedPayload.aud || ''),
      jti,
      exp: Number(verifiedPayload.exp || 0),
      iat: Number(verifiedPayload.iat || 0),
      roles: Array.isArray(verifiedPayload.roles) ? (verifiedPayload.roles as string[]) : [],
      permissions: Array.isArray(verifiedPayload.permissions)
        ? (verifiedPayload.permissions as string[])
        : [],
      claims:
        verifiedPayload.claims && typeof verifiedPayload.claims === 'object'
          ? (verifiedPayload.claims as Record<string, unknown>)
          : {},
      perm_ver: Number(verifiedPayload.perm_ver || 1),
      pol_ver: Number(verifiedPayload.pol_ver || 1),
      amr: Array.isArray(verifiedPayload.amr) ? (verifiedPayload.amr as string[]) : [],
    };
  } catch {
    return null;
  }
}

export function getJwtIssuer(): string {
  try {
    return getPlatformSettings().jwtIssuer || DEFAULT_JWT_ISSUER;
  } catch {
    return DEFAULT_JWT_ISSUER;
  }
}

// Keep unused fs/path clean if needed
void fs;
void path;
