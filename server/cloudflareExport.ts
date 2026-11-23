import JSZip from 'jszip';
import { D1_SCHEMA_SQL } from './db.ts';
import { getPlatformSettings, type PlatformSettings } from './settings.ts';

export interface CloudflareArtifactFile {
  path: string;
  language: string;
  description: string;
  content: string;
}

export function buildWranglerToml(s: PlatformSettings): string {
  const workerName = s.infraWorkerName || 'isg-edge-worker';
  const compatibilityDate = s.infraCompatibilityDate || '2026-03-01';
  const compatFlags = (s.infraCompatibilityFlags || 'nodejs_compat')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const d1Binding = s.infraD1Binding || 'DB';
  const d1Name = s.infraD1DatabaseName || 'isg-d1';
  const d1Id = s.infraD1DatabaseId || '00000000-0000-0000-0000-000000000000';
  const kvBinding = s.infraKvBinding || 'IAM_KV';
  const kvId = s.infraKvNamespaceId || '00000000-0000-0000-0000-000000000000';
  const issuer = s.infraWorkerJwtIssuer || s.jwtIssuer || 'https://iam.sua-empresa.workers.dev';
  const edgeTtl = String(s.defaultEdgeCacheTtl ?? 120);
  const wranglerEnv = s.infraWranglerEnv;

  const lines: string[] = [
    `name = "${workerName}"`,
    `main = "src/worker.ts"`,
    `compatibility_date = "${compatibilityDate}"`,
    `compatibility_flags = [${compatFlags.map((f) => `"${f}"`).join(', ')}]`,
  ];

  if (s.infraAccountId) {
    lines.push(`account_id = "${s.infraAccountId}"`);
  }
  lines.push(`workers_dev = ${s.infraWorkersDev ? 'true' : 'false'}`);

  if (s.infraCustomRoute) {
    lines.push(
      `routes = [`,
      `  { pattern = "${s.infraCustomRoute}", custom_domain = true }`,
      `]`
    );
  }

  lines.push(
    ``,
    `# Cloudflare D1 (SQLite na Borda)`,
    `[[d1_databases]]`,
    `binding = "${d1Binding}"`,
    `database_name = "${d1Name}"`,
    `database_id = "${d1Id}"`,
    ``,
    `# Cloudflare Workers KV (Versionamento de permissoes, revogacao JTI e rate limit)`,
    `[[kv_namespaces]]`,
    `binding = "${kvBinding}"`,
    `id = "${kvId}"`,
    ``,
    `[vars]`,
    `IAM_JWT_ISSUER = "${issuer}"`,
    `DEFAULT_EDGE_CACHE_TTL = "${edgeTtl}"`
  );

  if (wranglerEnv) {
    lines.push(
      ``,
      `# Ambiente dedicado (${wranglerEnv})`,
      `[env.${wranglerEnv}]`,
      `name = "${workerName}-${wranglerEnv}"`,
      ``,
      `[[env.${wranglerEnv}.d1_databases]]`,
      `binding = "${d1Binding}"`,
      `database_name = "${d1Name}"`,
      `database_id = "${d1Id}"`,
      ``,
      `[[env.${wranglerEnv}.kv_namespaces]]`,
      `binding = "${kvBinding}"`,
      `id = "${kvId}"`,
      ``,
      `[env.${wranglerEnv}.vars]`,
      `IAM_JWT_ISSUER = "${issuer}"`,
      `DEFAULT_EDGE_CACHE_TTL = "${edgeTtl}"`
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildWorkerTs(s: PlatformSettings): string {
  const workerName = s.infraWorkerName || 'isg-edge-worker';
  const d1Binding = s.infraD1Binding || 'DB';
  const kvBinding = s.infraKvBinding || 'IAM_KV';
  const edgeTtl = Number(s.defaultEdgeCacheTtl ?? 120);

  return `import { jwtVerify, SignJWT } from 'jose';
import { buildSchema, graphql } from 'graphql';

export interface Env {
  ${d1Binding}: D1Database;
  ${kvBinding}: KVNamespace;
  IAM_JWT_ISSUER: string;
  DEFAULT_EDGE_CACHE_TTL: string;
  JWT_HMAC_FALLBACK: string;
}

const schema = buildSchema(\`
  type Query {
    systems: [System!]!
    users(systemId: ID): [User!]!
    me: User
  }
  type System {
    id: ID!
    name: String!
    slug: String!
    clientId: String!
    jwtTtlSeconds: Int!
    edgeCacheTtl: Int!
    requireMfa: Boolean!
    policyVersion: Int!
  }
  type User {
    id: ID!
    email: String!
    displayName: String!
    status: String!
    permVersion: Int!
  }
\`);

async function computeEdgeKey(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const started = performance.now();

    // 1. OAuth 2.0 / UserInfo & Edge GraphQL via JWT + Cache API + KV Versioning
    if (url.pathname === '/graphql' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace(/^Bearer\\s+/i, '');
      if (!token) {
        return Response.json({ errors: [{ message: 'Missing Bearer JWT' }] }, { status: 401 });
      }

      const secret = new TextEncoder().encode(env.JWT_HMAC_FALLBACK);
      const { payload } = await jwtVerify(token, secret, { issuer: env.IAM_JWT_ISSUER });
      const sub = String(payload.sub || '');
      const sysId = String(payload.system_id || '');
      const jwtExp = Number(payload.exp || 0);
      const nowSec = Math.floor(Date.now() / 1000);

      // Check KV revocation & permission version
      const [revoked, kvPermVer, kvPolVer] = await Promise.all([
        env.${kvBinding}.get(\`revoked:\${payload.jti}\`),
        env.${kvBinding}.get(\`u_ver:\${sub}\`),
        env.${kvBinding}.get(\`s_ver:\${sysId}\`),
      ]);
      if (revoked) {
        return Response.json({ errors: [{ message: 'JWT revoked at edge' }] }, { status: 401 });
      }

      const body = (await request.json()) as { query: string; variables?: Record<string, unknown> };
      const isMutation = body.query.trim().startsWith('mutation');
      const cache = caches.default;

      if (!isMutation) {
        const edgeHash = await computeEdgeKey([
          body.query,
          JSON.stringify(body.variables || {}),
          sysId,
          sub,
          String(kvPermVer || payload.perm_ver || 1),
          String(kvPolVer || payload.pol_ver || 1),
        ]);
        const cacheReq = new Request(\`https://edge-cache.internal/gql/\${edgeHash}\`);
        const cached = await cache.match(cacheReq);
        if (cached) {
          const hitRes = new Response(cached.body, cached);
          hitRes.headers.set('CF-Cache-Status', 'HIT');
          hitRes.headers.set('X-Query-Duration-Ms', (performance.now() - started).toFixed(2));
          return hitRes;
        }

        // Execute batched D1 queries on Cache MISS
        const result = await graphql({
          schema,
          source: body.query,
          variableValues: body.variables,
          rootValue: {
            systems: async () => {
              const { results } = await env.${d1Binding}.prepare(
                'SELECT id, name, slug, client_id as clientId, jwt_ttl_seconds as jwtTtlSeconds, edge_cache_ttl as edgeCacheTtl, require_mfa as requireMfa, policy_version as policyVersion FROM systems WHERE status = ?'
              ).bind('active').all();
              return results;
            },
            users: async ({ systemId }: { systemId?: string }) => {
              if (systemId) {
                const { results } = await env.${d1Binding}.prepare(
                  'SELECT u.id, u.email, u.display_name as displayName, u.status, u.perm_version as permVersion FROM users u JOIN user_system_bindings b ON b.user_id = u.id WHERE b.system_id = ?'
                ).bind(systemId).all();
                return results;
              }
              const { results } = await env.${d1Binding}.prepare(
                'SELECT id, email, display_name as displayName, status, perm_version as permVersion FROM users'
              ).all();
              return results;
            },
            me: async () => {
              return env.${d1Binding}.prepare(
                'SELECT id, email, display_name as displayName, status, perm_version as permVersion FROM users WHERE id = ?'
              ).bind(sub).first();
            },
          },
        });

        const policyTtl = Number(env.DEFAULT_EDGE_CACHE_TTL || ${edgeTtl});
        const effectiveTtl = Math.max(0, Math.min(policyTtl, jwtExp - nowSec));
        const res = Response.json(result, {
          headers: {
            'Cache-Control': \`public, max-age=\${effectiveTtl}\`,
            'CF-Cache-Status': 'MISS',
            'X-Cache-TTL-Remaining': String(effectiveTtl),
            'X-Query-Duration-Ms': (performance.now() - started).toFixed(2),
          },
        });

        if (effectiveTtl > 0) {
          ctx.waitUntil(cache.put(cacheReq, res.clone()));
        }
        return res;
      }
    }

    // 2. OAuth Token Endpoint on Edge Worker
    if (url.pathname === '/api/oauth/token' && request.method === 'POST') {
      const secret = new TextEncoder().encode(env.JWT_HMAC_FALLBACK);
      const jwt = await new SignJWT({ sys: 'secure-gate', roles: ['member'] })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(env.IAM_JWT_ISSUER)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);
      return Response.json({ access_token: jwt, token_type: 'Bearer', expires_in: 3600 });
    }

    return Response.json({ service: '${workerName}', status: 'ok' });
  },
};
`;
}

function buildDeployScript(s: PlatformSettings): string {
  const workerName = s.infraWorkerName || 'isg-edge-worker';
  const d1Name = s.infraD1DatabaseName || 'isg-d1';
  const kvBinding = s.infraKvBinding || 'IAM_KV';
  const envFlag = s.infraWranglerEnv ? ` --env ${s.infraWranglerEnv}` : '';

  const lines: string[] = [
    `#!/usr/bin/env bash`,
    `set -euo pipefail`,
    ``,
    `# ${s.platformName} — Script de Implementacao de Infraestrutura (Cloudflare Workers + D1 + KV)`,
    `WORKER_NAME="${workerName}"`,
    `D1_NAME="${d1Name}"`,
    `KV_BINDING="${kvBinding}"`,
  ];

  if (s.infraAccountId) {
    lines.push(`export CLOUDFLARE_ACCOUNT_ID="\${CLOUDFLARE_ACCOUNT_ID:-${s.infraAccountId}}"`);
  }

  lines.push(
    ``,
    `echo "==> 1/4 Criando banco D1 ($D1_NAME)..."`,
    `npx wrangler d1 create "$D1_NAME" || true`,
    ``,
    `echo "==> 2/4 Aplicando schema SQL no D1 ($D1_NAME)..."`,
    `npx wrangler d1 execute "$D1_NAME" --remote --file=./schema.d1.sql${envFlag}`,
    ``,
    `echo "==> 3/4 Criando namespace Workers KV ($KV_BINDING)..."`,
    `npx wrangler kv namespace create "$KV_BINDING" || true`,
    ``,
    `echo "==> 4/4 Publicando Edge Worker ($WORKER_NAME)..."`,
    `npx wrangler deploy${envFlag}`,
    ``
  );

  return lines.join('\n');
}

function buildDeployReadme(s: PlatformSettings): string {
  const workerName = s.infraWorkerName || 'isg-edge-worker';
  const d1Name = s.infraD1DatabaseName || 'isg-d1';
  const d1Binding = s.infraD1Binding || 'DB';
  const kvBinding = s.infraKvBinding || 'IAM_KV';
  const issuer = s.infraWorkerJwtIssuer || s.jwtIssuer || 'https://iam.sua-empresa.workers.dev';
  const envFlag = s.infraWranglerEnv ? ` --env ${s.infraWranglerEnv}` : '';

  return `# ${s.platformName} — Pacote Cloudflare Workers + D1 + KV

Configuracao gerada:
- Worker: \`${workerName}\`
- Banco D1: \`${d1Name}\` (binding \`${d1Binding}\`)
- Namespace KV: binding \`${kvBinding}\`
- Emissor JWT: \`${issuer}\`
- Edge Cache TTL: \`${s.defaultEdgeCacheTtl}s\`
${s.infraWranglerEnv ? `- Ambiente Wrangler: \`${s.infraWranglerEnv}\`\n` : ''}
## Provisionamento Passo a Passo

1. Crie o banco D1 na Cloudflare:
   \`npx wrangler d1 create ${d1Name}\`

2. Aplique o schema SQL otimizado para leitura e indices de cobertura:
   \`npx wrangler d1 execute ${d1Name} --remote --file=./schema.d1.sql${envFlag}\`

3. Crie o namespace KV para versoes de permissoes e revogacao instantanea de JWT:
   \`npx wrangler kv namespace create ${kvBinding}\`

4. Defina o segredo HMAC de fallback (opcional para HS256):
   \`npx wrangler secret put JWT_HMAC_FALLBACK${envFlag}\`

5. Atualize os IDs em \`wrangler.toml\` (caso use placeholders) e publique na borda:
   \`npx wrangler deploy${envFlag}\`
`;
}

export function getInfraBundleFilename(): string {
  const s = getPlatformSettings();
  return s.infraBundleFilename || 'isg-cloudflare-d1-bundle';
}

export function getCloudflareBundleFiles(): CloudflareArtifactFile[] {
  const s = getPlatformSettings();
  const files: CloudflareArtifactFile[] = [
    {
      path: 'wrangler.toml',
      language: 'toml',
      description: 'Manifesto Cloudflare Workers com bindings D1 (SQLite na borda) e Workers KV.',
      content: buildWranglerToml(s),
    },
    {
      path: 'schema.d1.sql',
      language: 'sql',
      description: 'Schema D1 completo com indices compostos de cobertura e tabelas LGPD/RBAC.',
      content: D1_SCHEMA_SQL.trim(),
    },
    {
      path: 'src/worker.ts',
      language: 'typescript',
      description: 'Edge Worker com verificacao JWT, Cache API limitada ao exp do token, KV versioning e GraphQL sobre D1.',
      content: buildWorkerTs(s),
    },
  ];

  if (s.infraIncludeDeployScript) {
    files.push({
      path: 'deploy.sh',
      language: 'bash',
      description: 'Script Shell automatizado para criacao do D1, aplicacao de schema, criacao de KV e deploy via Wrangler.',
      content: buildDeployScript(s),
    });
  }

  if (s.infraIncludeReadme) {
    files.push({
      path: 'README.md',
      language: 'markdown',
      description: 'Instrucoes de provisionamento D1, KV e deploy via Wrangler.',
      content: buildDeployReadme(s),
    });
  }

  return files;
}

export async function createCloudflareBundleZip(): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of getCloudflareBundleFiles()) {
    zip.file(file.path, file.content);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
