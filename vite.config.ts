/**
 * File: vite.config.ts
 * Kind: TypeScript
 * Container: /
 * Summary: Configuração do bundler Vite, plugins React/Tailwind e cópia de ativos estáticos de manager.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'sync-manifest-before-build',
        apply: 'build',
        config(): void {
          const manifestPath = path.resolve(__dirname, 'manifest.json');
          const packagePath = path.resolve(__dirname, 'package.json');
          const metadataPath = path.resolve(__dirname, 'metadata.json');

          if (!fs.existsSync(manifestPath)) {
            return;
          }

          const writeFileAtomic = (targetPath: string, content: string): void => {
            const tmpPath = `${targetPath}.${process.pid}.tmp`;
            fs.writeFileSync(tmpPath, content, 'utf-8');
            fs.renameSync(tmpPath, targetPath);
          };

          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
            system?: { name?: string; description?: string };
            version?: {
              release?: number;
              revision?: number;
              build?: number;
              number?: number;
              codename?: string;
            };
          };

          const version = manifest.version ?? {};
          const release = Number(version.release ?? 1);
          const revision = Number(version.revision ?? 0);
          const nextBuild = Number(version.build ?? 0) + 1;

          manifest.version = {
            ...version,
            release,
            revision,
            build: nextBuild,
          };

          writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

          const systemName = manifest.system?.name?.trim() || 'identity-gate';
          const systemDescription = manifest.system?.description?.trim() || '';
          const semver = `${release}.${revision}.${nextBuild}`;
          const npmPackageName = systemName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '');

          if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as Record<string, unknown>;
            pkg.name = npmPackageName || 'identity-gate';
            pkg.description = systemDescription;
            pkg.version = semver;
            writeFileAtomic(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
          }

          if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Record<string, unknown>;
            metadata.name = systemName;
            metadata.description = systemDescription;
            writeFileAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
          }
        },
      },
      // Copies manager/assets into dist/ so root-relative URLs like
      // "/manager/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-manager-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const managerAssets = path.resolve(__dirname, 'manager/assets');
          const distAssets = path.resolve(distDir, 'manager/assets');
          if (fs.existsSync(distDir) && fs.existsSync(managerAssets)) {
            fs.cpSync(managerAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
