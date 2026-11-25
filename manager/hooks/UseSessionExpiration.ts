/**
 * File: UseSessionExpiration.ts
 * Kind: TypeScript
 * Container: /manager/hooks
 * Summary: Hook React para contagem regressiva de expiração do JWT e disparo de aviso preventivo de sessão.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

import { useEffect, useState } from 'react';

export interface SessionExpirationState {
  remainingSeconds: number | null;
  formattedRemaining: string;
  isExpiringSoon: boolean;
  showWarning: boolean;
  dismissWarning: () => void;
}

const FIVE_MINUTES_SECONDS = 300;

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useSessionExpiration(
  expiresAt: string | null,
  onExpired?: () => void,
  thresholdSeconds: number = FIVE_MINUTES_SECONDS
): SessionExpirationState {
  const computeRemaining = (iso: string | null): number | null => {
    if (!iso) return null;
    const targetMs = Date.parse(iso);
    if (Number.isNaN(targetMs)) return null;
    return Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  };

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => computeRemaining(expiresAt));
  const [dismissedForExpiry, setDismissedForExpiry] = useState<string | null>(null);

  useEffect(() => {
    setRemainingSeconds(computeRemaining(expiresAt));
    if (!expiresAt) return;

    const timer = window.setInterval(() => {
      const next = computeRemaining(expiresAt);
      setRemainingSeconds(next);
      if (next !== null && next <= 0) {
        window.clearInterval(timer);
        onExpired?.();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt, onExpired]);

  const isExpiringSoon =
    remainingSeconds !== null && remainingSeconds > 0 && remainingSeconds <= thresholdSeconds;

  const showWarning = Boolean(expiresAt && isExpiringSoon && dismissedForExpiry !== expiresAt);

  return {
    remainingSeconds,
    formattedRemaining: remainingSeconds !== null ? formatDuration(remainingSeconds) : '--:--',
    isExpiringSoon,
    showWarning,
    dismissWarning: () => {
      if (expiresAt) setDismissedForExpiry(expiresAt);
    },
  };
}
