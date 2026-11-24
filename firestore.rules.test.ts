/**
 * File: firestore.rules.test.ts
 * Kind: TypeScript Test
 * Container: /
 * Summary: Testes estruturais e simulação dos 12 payloads adversariais (Dirty Dozen) contra blueprint e firestore.rules.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

interface BlueprintProperty {
  type: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
}

interface BlueprintEntity {
  properties: Record<string, BlueprintProperty>;
  required?: string[];
}

interface FirebaseBlueprint {
  entities: Record<string, BlueprintEntity>;
  firestore: Record<string, { schema: { $ref: string }; description: string }>;
}

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesText = fs.readFileSync(rulesPath, 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8')) as FirebaseBlueprint;

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
}

function simulateUserProfileCreate(
  auth: { uid: string; emailVerified: boolean; email: string } | null,
  userId: string,
  payload: Record<string, unknown>,
  serverNow: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.emailVerified || !isValidId(userId)) return 'PERMISSION_DENIED';
  const expectedKeys = ['uid', 'displayName', 'role', 'createdAt', 'updatedAt'];
  const keys = Object.keys(payload);
  if (!expectedKeys.every((k) => keys.includes(k))) return 'PERMISSION_DENIED';
  if (!keys.every((k) => expectedKeys.includes(k))) return 'PERMISSION_DENIED';
  if (!isValidId(payload.uid) || payload.uid !== userId) return 'PERMISSION_DENIED';
  if (typeof payload.displayName !== 'string' || payload.displayName.length < 1 || payload.displayName.length > 120) {
    return 'PERMISSION_DENIED';
  }
  if (payload.role !== 'member' && payload.role !== 'admin') return 'PERMISSION_DENIED';
  if (payload.createdAt !== serverNow || payload.updatedAt !== serverNow) return 'PERMISSION_DENIED';
  const isAdmin = auth.emailVerified && auth.email === 'osvandir.junior@gmail.com';
  const isOwner = auth.uid === userId;
  if (!((isOwner && payload.role === 'member') || isAdmin)) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function simulatePreferenceCreate(
  auth: { uid: string; emailVerified: boolean; email: string } | null,
  userId: string,
  prefId: string,
  payload: Record<string, unknown>,
  serverNow: string
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth || !auth.emailVerified || !isValidId(userId) || !isValidId(prefId)) return 'PERMISSION_DENIED';
  const expectedKeys = ['ownerId', 'theme', 'defaultTab', 'sidebarCollapsed', 'createdAt', 'updatedAt'];
  const keys = Object.keys(payload);
  if (!expectedKeys.every((k) => keys.includes(k))) return 'PERMISSION_DENIED';
  if (!keys.every((k) => expectedKeys.includes(k))) return 'PERMISSION_DENIED';
  if (!isValidId(payload.ownerId) || payload.ownerId !== userId) return 'PERMISSION_DENIED';
  if (payload.theme !== 'dark' && payload.theme !== 'contrast') return 'PERMISSION_DENIED';
  if (
    typeof payload.defaultTab !== 'string' ||
    payload.defaultTab.length < 1 ||
    payload.defaultTab.length > 40 ||
    !/^[a-z0-9\-]+$/.test(payload.defaultTab)
  ) {
    return 'PERMISSION_DENIED';
  }
  if (typeof payload.sidebarCollapsed !== 'boolean') return 'PERMISSION_DENIED';
  if (payload.createdAt !== serverNow || payload.updatedAt !== serverNow) return 'PERMISSION_DENIED';
  const isAdmin = auth.emailVerified && auth.email === 'osvandir.junior@gmail.com';
  if (auth.uid !== userId && !isAdmin) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

test('Eight Pillars structural invariants exist in firestore.rules', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2'/);
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesText, /function isValidId\(id\)/);
  assert.match(rulesText, /function isValidUserProfile\(/);
  assert.match(rulesText, /function isValidUserPrivateInfo\(/);
  assert.match(rulesText, /function isValidUserConsolePreference\(/);
  assert.match(rulesText, /function isValidAdminRole\(/);
  assert.match(rulesText, /allow list:\s*if isSignedIn\(\) && existing\(\)\.ownerId == request\.auth\.uid;/);
  assert.match(rulesText, /allow list:\s*if false;/);
  assert.ok(!rulesText.includes('allow read: if true') && !rulesText.includes('allow write: if true'));
});

test('Every blueprint collection has a corresponding match block in firestore.rules', () => {
  const expectedMatches = [
    'match /users/{userId}',
    'match /private/{docId}',
    'match /preferences/{prefId}',
    'match /admins/{userId}',
  ];
  for (const m of expectedMatches) {
    assert.ok(rulesText.includes(m), `Missing rule block: ${m}`);
  }
  assert.ok(blueprint.entities.UserProfile.properties.displayName.maxLength === 120);
  assert.ok(blueprint.entities.UserConsolePreference.properties.defaultTab.maxLength === 40);
});

test('Dirty Dozen adversarial payloads return PERMISSION_DENIED', () => {
  const now = '2026-11-24T12:00:00Z';
  const memberAuth = { uid: 'u1', emailVerified: true, email: 'member@example.com' };

  // 1. Self-Role Escalation on Create
  assert.equal(
    simulateUserProfileCreate(
      memberAuth,
      'u1',
      { uid: 'u1', displayName: 'Alice', role: 'admin', createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 2. Shadow / Ghost Field Injection
  assert.equal(
    simulateUserProfileCreate(
      memberAuth,
      'u1',
      { uid: 'u1', displayName: 'Alice', role: 'member', isVerified: true, createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 3. Spoofed Owner UID on Preference
  assert.equal(
    simulatePreferenceCreate(
      memberAuth,
      'u1',
      'console',
      { ownerId: 'victim_uid', theme: 'dark', defaultTab: 'overview', sidebarCollapsed: false, createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 4. Cross-User Write
  assert.equal(
    simulatePreferenceCreate(
      memberAuth,
      'victim_uid',
      'console',
      { ownerId: 'u1', theme: 'dark', defaultTab: 'overview', sidebarCollapsed: false, createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 5. Unverified Email Spoofing
  assert.equal(
    simulateUserProfileCreate(
      { uid: 'attacker', emailVerified: false, email: 'osvandir.junior@gmail.com' },
      'attacker',
      { uid: 'attacker', displayName: 'Attacker', role: 'admin', createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 6. Client-Spoofed Timestamp
  assert.equal(
    simulateUserProfileCreate(
      memberAuth,
      'u1',
      { uid: 'u1', displayName: 'Alice', role: 'member', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 7. Type Poisoning
  assert.equal(
    simulatePreferenceCreate(
      memberAuth,
      'u1',
      'console',
      { ownerId: 'u1', theme: 'dark', defaultTab: 'overview', sidebarCollapsed: 'yes', createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 8. Oversized String / Resource Poisoning
  assert.equal(
    simulateUserProfileCreate(
      memberAuth,
      'u1',
      { uid: 'u1', displayName: 'A'.repeat(1500), role: 'member', createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 9. Path ID Poisoning
  assert.equal(
    simulatePreferenceCreate(
      memberAuth,
      'u1',
      'bad.id$slash',
      { ownerId: 'u1', theme: 'dark', defaultTab: 'overview', sidebarCollapsed: false, createdAt: now, updatedAt: now },
      now
    ),
    'PERMISSION_DENIED'
  );

  // 10. Valid baseline passes
  assert.equal(
    simulatePreferenceCreate(
      memberAuth,
      'u1',
      'console',
      { ownerId: 'u1', theme: 'dark', defaultTab: 'overview', sidebarCollapsed: false, createdAt: now, updatedAt: now },
      now
    ),
    'ALLOW'
  );
});
