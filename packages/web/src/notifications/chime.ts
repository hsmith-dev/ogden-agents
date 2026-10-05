/**
 * The attention sound (backlog story 8): two short sine notes made by the
 * browser's audio engine, so it ships with the app as code, needs no file and
 * no network, and passes the gate's Content-Security-Policy (which blocks
 * audio from `data:` URLs). Browsers play it only once the user has
 * interacted with the page; until then, or with no audio engine, it is silent.
 */

type AudioContextClass = new () => AudioContext;

let shared: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  if (shared !== undefined) return shared;
  const Ctor = (globalThis as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass }).AudioContext ?? (globalThis as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (Ctor === undefined) return undefined;
  try {
    shared = new Ctor();
  } catch {
    return undefined;
  }
  return shared;
}

/** The two notes, in hertz, and how long each lasts. */
export const CHIME_NOTES = [880, 1318.5] as const;
export const NOTE_SECONDS = 0.16;

/** Plays the chime at `volume` (0 to 1). Never throws. */
export function playChime(volume: number): void {
  if (!(volume > 0)) return;
  const context = audioContext();
  if (context === undefined) return;
  try {
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime + 0.01;
    CHIME_NOTES.forEach((frequency, i) => {
      const at = start + i * NOTE_SECONDS;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      // A soft attack and a decay, so the notes do not click.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.4 * Math.min(1, volume)), at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS * 1.6);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + NOTE_SECONDS * 1.7);
    });
  } catch {
    // No sound is never an error: the Needs you row and the title count still show.
  }
}

/** For tests: forget the audio engine made by an earlier test. */
export function resetChimeForTests(): void {
  shared = undefined;
}
