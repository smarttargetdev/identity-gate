/**
 * File: FirebaseProvider.tsx
 * Kind: TypeScript React
 * Container: /manager/components
 * Summary: Contexto React Firebase (Auth Google via popup + sincronização Firestore de perfil e preferências) e ErrorBoundary dedicado.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import React, { Component, createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  googleProvider,
  handleFirestoreError,
  OperationType,
  sanitizeConsolePreferenceInput,
  sanitizeDisplayName,
  testConnection,
  type ConsoleTheme,
  type SanitizedConsolePreferenceInput,
} from '../libraries/Firebase';

export interface CloudConsolePreference {
  ownerId: string;
  theme: ConsoleTheme;
  defaultTab: string;
  sidebarCollapsed: boolean;
}

interface FirebaseContextValue {
  authReady: boolean;
  firebaseUser: User | null;
  connectionOnline: boolean;
  consolePref: CloudConsolePreference | null;
  prefLoaded: boolean;
  firebaseBusy: boolean;
  firebaseError: string | null;
  projectId: string;
  databaseId: string;
  signInWithGoogle: () => Promise<void>;
  signOutFirebase: () => Promise<void>;
  saveConsolePreference: (input: {
    theme: ConsoleTheme;
    defaultTab: string;
    sidebarCollapsed: boolean;
  }) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | undefined>(undefined);

interface ErrorBoundaryState {
  error: Error | null;
}

export class FirebaseErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      let parsedSummary = this.state.error.message;
      try {
        const info = JSON.parse(this.state.error.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (info.error) {
          parsedSummary = `${info.operationType || 'firestore'} (${info.path || '-'}): ${info.error}`;
        }
      } catch {
        // Keep raw error message
      }

      return (
        <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#111827] border border-red-800/70 rounded-lg p-6 space-y-4">
            <p className="text-xs font-medium text-[#F6821F]">Firebase / Firestore</p>
            <h1 className="text-lg font-semibold text-white">Falha na operação de dados em nuvem</h1>
            <p className="text-xs font-mono text-red-200 bg-[#090D16] border border-slate-800 rounded p-3 break-all">
              {parsedSummary}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 text-xs font-semibold bg-[#F6821F] hover:bg-[#e27316] text-slate-950 rounded-md"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

async function ensureUserDocuments(user: User): Promise<void> {
  if (!user.emailVerified) return;

  const profilePath = `users/${user.uid}`;
  const profileRef = doc(db, 'users', user.uid);
  let existingProfile;
  try {
    existingProfile = await getDoc(profileRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, profilePath);
  }

  const displayName = sanitizeDisplayName(user.displayName, user.email?.split('@')[0] || 'Usuário');
  if (!existingProfile.exists()) {
    const isBootstrapAdmin = user.email === 'osvandir.junior@gmail.com' && user.emailVerified;
    try {
      await setDoc(profileRef, {
        uid: user.uid,
        displayName,
        role: isBootstrapAdmin ? 'admin' : 'member',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, profilePath);
    }
  }

  if (user.email && user.email.length >= 3 && user.email.length <= 254) {
    const privatePath = `users/${user.uid}/private/info`;
    const privateRef = doc(db, 'users', user.uid, 'private', 'info');
    let existingPrivate;
    try {
      existingPrivate = await getDoc(privateRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, privatePath);
    }
    if (!existingPrivate.exists()) {
      try {
        await setDoc(privateRef, {
          uid: user.uid,
          email: user.email,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, privatePath);
      }
    }
  }
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [connectionOnline, setConnectionOnline] = useState(true);
  const [consolePref, setConsolePref] = useState<CloudConsolePreference | null>(null);
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [firebaseBusy, setFirebaseBusy] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [boundaryError, setBoundaryError] = useState<Error | null>(null);

  if (boundaryError) {
    throw boundaryError;
  }

  useEffect(() => {
    let active = true;
    void testConnection().then((ok) => {
      if (active) setConnectionOnline(ok);
    });
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setConsolePref(null);
        setPrefLoaded(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    let cancelled = false;
    void ensureUserDocuments(firebaseUser).catch((err) => {
      if (!cancelled) {
        setBoundaryError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    const prefPath = `users/${firebaseUser.uid}/preferences/console`;
    const prefRef = doc(db, 'users', firebaseUser.uid, 'preferences', 'console');
    const unsubscribePref = onSnapshot(
      prefRef,
      (snap) => {
        setPrefLoaded(true);
        if (!snap.exists()) {
          setConsolePref(null);
          return;
        }
        const raw = snap.data() as Partial<CloudConsolePreference>;
        const sanitized = sanitizeConsolePreferenceInput({
          theme: raw.theme,
          defaultTab: raw.defaultTab,
          sidebarCollapsed: raw.sidebarCollapsed,
        });
        setConsolePref({
          ownerId: firebaseUser.uid,
          ...sanitized,
        });
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, prefPath);
        } catch (formatted) {
          setBoundaryError(formatted instanceof Error ? formatted : new Error(String(formatted)));
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribePref();
    };
  }, [authReady, firebaseUser]);

  const signInWithGoogle = async () => {
    setFirebaseBusy(true);
    setFirebaseError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserDocuments(cred.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao autenticar com Google Firebase.';
      setFirebaseError(msg);
      throw err;
    } finally {
      setFirebaseBusy(false);
    }
  };

  const signOutFirebase = async () => {
    setFirebaseBusy(true);
    setFirebaseError(null);
    try {
      await signOut(auth);
      setConsolePref(null);
      setPrefLoaded(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao encerrar sessão Firebase.';
      setFirebaseError(msg);
      throw err;
    } finally {
      setFirebaseBusy(false);
    }
  };

  const saveConsolePreference = async (input: SanitizedConsolePreferenceInput) => {
    if (!auth.currentUser) {
      throw new Error('Autentique-se com Google Firebase antes de salvar preferências em nuvem.');
    }
    const uid = auth.currentUser.uid;
    const sanitized = sanitizeConsolePreferenceInput(input);
    const prefPath = `users/${uid}/preferences/console`;
    const prefRef = doc(db, 'users', uid, 'preferences', 'console');

    setFirebaseBusy(true);
    setFirebaseError(null);
    try {
      await ensureUserDocuments(auth.currentUser);
      let snap;
      try {
        snap = await getDoc(prefRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, prefPath);
      }

      if (!snap.exists()) {
        try {
          await setDoc(prefRef, {
            ownerId: uid,
            theme: sanitized.theme,
            defaultTab: sanitized.defaultTab,
            sidebarCollapsed: sanitized.sidebarCollapsed,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, prefPath);
        }
      } else {
        try {
          await updateDoc(prefRef, {
            theme: sanitized.theme,
            defaultTab: sanitized.defaultTab,
            sidebarCollapsed: sanitized.sidebarCollapsed,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, prefPath);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao gravar preferências no Firestore.';
      setFirebaseError(msg);
      throw err;
    } finally {
      setFirebaseBusy(false);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        authReady,
        firebaseUser,
        connectionOnline,
        consolePref,
        prefLoaded,
        firebaseBusy,
        firebaseError,
        projectId: FIREBASE_PROJECT_ID,
        databaseId: FIRESTORE_DATABASE_ID,
        signInWithGoogle,
        signOutFirebase,
        saveConsolePreference,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase deve ser usado dentro de FirebaseProvider.');
  }
  return ctx;
}
