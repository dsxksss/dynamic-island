// Play a short notification chime using the Web Audio API (no asset needed).
// Lazy-creates the AudioContext on first use (browsers require a user gesture,
// but inside Tauri the WebView is more permissive).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** A pleasant two-tone chime (E6 → A5), ~0.25s. */
export function playChime(): void {
  const ac = getCtx();
  if (!ac) return;
  // resume in case it was suspended
  ac.resume().catch(() => {});

  const now = ac.currentTime;
  const notes = [
    { freq: 1318.51, start: 0.0, dur: 0.12 }, // E6
    { freq: 880.0, start: 0.09, dur: 0.18 }, // A5
  ];

  for (const n of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;

    // envelope: quick attack, soft decay
    const t0 = now + n.start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);

    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + n.dur + 0.02);
  }
}
