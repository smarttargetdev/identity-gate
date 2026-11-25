/**
 * File: HealthAlertAudio.ts
 * Kind: TypeScript
 * Container: /manager/libraries
 * Summary: Síntese de alertas sonoros via Web Audio API para transições de degradação ou falha crítica.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-25
 * Developer: Osvandir Júnior
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

export function unlockHealthAlertAudio(): void {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  } catch {
    // Ignore audio context restrictions
  }
}

function scheduleTone(
  ctx: AudioContext,
  startTime: number,
  frequency: number,
  durationSec: number,
  type: OscillatorType,
  peakGain: number
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.02);
}

export async function playHealthAlertSound(level: 'degraded' | 'critical'): Promise<boolean> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const now = ctx.currentTime + 0.01;
    if (level === 'critical') {
      scheduleTone(ctx, now, 880, 0.12, 'triangle', 0.14);
      scheduleTone(ctx, now + 0.14, 659.25, 0.12, 'triangle', 0.12);
      scheduleTone(ctx, now + 0.28, 880, 0.22, 'triangle', 0.15);
    } else {
      scheduleTone(ctx, now, 587.33, 0.13, 'sine', 0.11);
      scheduleTone(ctx, now + 0.15, 440, 0.18, 'sine', 0.1);
    }
    return true;
  } catch {
    return false;
  }
}
