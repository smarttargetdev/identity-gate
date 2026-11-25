/**
 * File: Manifest.ts
 * Kind: TypeScript
 * Container: /server
 * Summary: Leitura e gravação atômica de identidade da plataforma e versão no arquivo manifest.json.
 * Version: 1.0.0
 * Created: 2026-11-25
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import fs from 'fs';
import path from 'path';

export interface ManifestSystem {
  name: string;
  description: string;
}

export interface ManifestVersion {
  number: number;
  release: number;
  revision: number;
  build: number;
  codename: string;
}

export interface ManifestDocument {
  system: ManifestSystem;
  version: ManifestVersion;
  repository?: Record<string, unknown>;
  [key: string]: unknown;
}

export const MANIFEST_DEFAULT_NAME = 'Identity Secure Gate';
export const MANIFEST_DEFAULT_DESCRIPTION =
  'Complete IAM platform for hybrid and multi-cloud environments, supporting OAuth 2.0, OIDC, SAML 2.0, and SCIM. It centralizes identity lifecycle management with RBAC/ABAC, SSO, Adaptive MFA, PAM, and real-time audit logs for GDPR, LGPD, and ISO 27001 compliance.';

const DEFAULT_MANIFEST: ManifestDocument = {
  system: {
    name: MANIFEST_DEFAULT_NAME,
    description: MANIFEST_DEFAULT_DESCRIPTION,
  },
  version: {
    release: 1,
    revision: 0,
    build: 0,
    number: 1,
    codename: 'genesis',
  },
};

function getManifestPath(): string {
  return path.resolve(process.cwd(), 'manifest.json');
}

function toNonNegativeInt(val: unknown, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function writeFileAtomic(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

export function readManifest(): ManifestDocument {
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return {
      system: { ...DEFAULT_MANIFEST.system },
      version: { ...DEFAULT_MANIFEST.version },
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Partial<ManifestDocument>;
    const rawSystem = (raw.system ?? {}) as Partial<ManifestSystem>;
    const rawVersion = (raw.version ?? {}) as Partial<ManifestVersion>;

    return {
      ...raw,
      system: {
        name: String(rawSystem.name ?? DEFAULT_MANIFEST.system.name).trim() || DEFAULT_MANIFEST.system.name,
        description:
          String(rawSystem.description ?? DEFAULT_MANIFEST.system.description).trim() ||
          DEFAULT_MANIFEST.system.description,
      },
      version: {
        release: toNonNegativeInt(rawVersion.release, DEFAULT_MANIFEST.version.release),
        revision: toNonNegativeInt(rawVersion.revision, DEFAULT_MANIFEST.version.revision),
        build: toNonNegativeInt(rawVersion.build, DEFAULT_MANIFEST.version.build),
        number: toNonNegativeInt(rawVersion.number, DEFAULT_MANIFEST.version.number),
        codename:
          String(rawVersion.codename ?? DEFAULT_MANIFEST.version.codename).trim() ||
          DEFAULT_MANIFEST.version.codename,
      },
    };
  } catch {
    return {
      system: { ...DEFAULT_MANIFEST.system },
      version: { ...DEFAULT_MANIFEST.version },
    };
  }
}

export function writeManifest(patch: {
  system?: Partial<ManifestSystem>;
  version?: Partial<ManifestVersion>;
}): ManifestDocument {
  const manifestPath = getManifestPath();
  const current = readManifest();

  const nextSystem: ManifestSystem = {
    name:
      patch.system?.name !== undefined
        ? String(patch.system.name).trim() || current.system.name
        : current.system.name,
    description:
      patch.system?.description !== undefined
        ? String(patch.system.description).trim()
        : current.system.description,
  };

  const nextVersion: ManifestVersion = {
    release:
      patch.version?.release !== undefined
        ? toNonNegativeInt(patch.version.release, current.version.release)
        : current.version.release,
    revision:
      patch.version?.revision !== undefined
        ? toNonNegativeInt(patch.version.revision, current.version.revision)
        : current.version.revision,
    build:
      patch.version?.build !== undefined
        ? toNonNegativeInt(patch.version.build, current.version.build)
        : current.version.build,
    number:
      patch.version?.number !== undefined
        ? toNonNegativeInt(patch.version.number, current.version.number)
        : current.version.number,
    codename:
      patch.version?.codename !== undefined
        ? String(patch.version.codename).trim()
        : current.version.codename,
  };

  const nextDoc: ManifestDocument = {
    ...current,
    system: nextSystem,
    version: nextVersion,
  };

  writeFileAtomic(manifestPath, `${JSON.stringify(nextDoc, null, 2)}\n`);
  return nextDoc;
}
