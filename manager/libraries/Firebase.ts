/**
 * File: Firebase.ts
 * Kind: TypeScript
 * Container: /manager/libraries
 * Summary: Inicialização do SDK Firebase (Auth e Firestore), validação de conexão no boot, sanitização conforme blueprint e tratamento estruturado de erros.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

void testConnection();

export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_\-]+$/,
  idMaxLength: 128,
  displayNameMaxLength: 120,
  emailMaxLength: 254,
  defaultTabPattern: /^[a-z0-9\-]+$/,
  defaultTabMaxLength: 40,
} as const;

export type ConsoleTheme = 'dark' | 'contrast';

export interface SanitizedConsolePreferenceInput {
  theme: ConsoleTheme;
  defaultTab: string;
  sidebarCollapsed: boolean;
}

export function sanitizeDisplayName(raw: string | null | undefined, fallback = 'Usuário'): string {
  const trimmed = (raw || '').trim();
  const safe = trimmed.length >= 1 ? trimmed : fallback;
  return safe.slice(0, BLUEPRINT_LIMITS.displayNameMaxLength);
}

export function sanitizeConsolePreferenceInput(input: {
  theme?: string;
  defaultTab?: string;
  sidebarCollapsed?: boolean;
}): SanitizedConsolePreferenceInput {
  const theme: ConsoleTheme = input.theme === 'contrast' ? 'contrast' : 'dark';
  const normalizedTab = (input.defaultTab || 'overview')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BLUEPRINT_LIMITS.defaultTabMaxLength);
  const defaultTab =
    normalizedTab.length >= 1 && BLUEPRINT_LIMITS.defaultTabPattern.test(normalizedTab)
      ? normalizedTab
      : 'overview';
  return {
    theme,
    defaultTab,
    sidebarCollapsed: Boolean(input.sidebarCollapsed),
  };
}
