/**
 * File: VersionBadge.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Badge sutil de versão da aplicação lido de manifest.json no formato X.Y.Z-CODEBASE.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React from 'react';
import manifest from '../../manifest.json';
import type { PlatformVersionInfo } from '../domains/Identity';

interface ManifestVersion {
  release?: number;
  revision?: number;
  build?: number;
  number?: number;
  codename?: string;
  codebase?: string;
}

interface VersionBadgeProps {
  className?: string;
  version?: Partial<PlatformVersionInfo> | null;
}

export const VersionBadge: React.FC<VersionBadgeProps> = ({ className = '', version: liveVersion }) => {
  const manifestVersion = (manifest?.version ?? {}) as ManifestVersion;
  const version: ManifestVersion = liveVersion ?? manifestVersion;
  const release = Number(version.release ?? 1);
  const revision = Number(version.revision ?? 0);
  const build = Number(version.build ?? 0);
  const rawCodebase = String(version.codebase ?? version.codename ?? '').trim();
  const codebase = rawCodebase.toLowerCase();

  const label = codebase ? `Versão ${release}.${revision}.${build} - ${codebase}` : `Versão ${release}.${revision}.${build}`;

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center px-2 py-0.5 rounded border border-slate-800/90 bg-[#0D131F] font-mono tabular-nums text-[11px] text-slate-400 tracking-tight ${className}`.trim()}
    >
      {label}
    </span>
  );
};
