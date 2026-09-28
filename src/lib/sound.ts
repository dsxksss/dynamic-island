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

/** A warmer three-note cue reserved for water reminders. */
export function playWaterReminderChime(): () => void {
  return playWaterNotes([
    { freq: 783.99, start: 0, dur: 0.16 }, // G5
    { freq: 987.77, start: 0.1, dur: 0.18 }, // B5
    { freq: 1174.66, start: 0.2, dur: 0.24 }, // D6
  ]);
}

/** A bright ascending resolution, distinct from the repeating reminder. */
export function playWaterConfirmedSound(): void {
  playWaterNotes([
    { freq: 523.25, start: 0, dur: 0.22 },
    { freq: 659.25, start: 0.09, dur: 0.25 },
    { freq: 1046.5, start: 0.18, dur: 0.42 },
  ]);
}

/** Rise with the fill animation; release/cancel immediately disconnects it. */
export function startWaterHoldSound(durationMs: number): () => void {
  const ac = getCtx();
  if (!ac) return () => {};
  ac.resume().catch(() => {});
  const now = ac.currentTime;
  const duration = durationMs / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(330, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + duration);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.04);
  gain.gain.setValueAtTime(0.07, now + duration - 0.06);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  osc.start(now);
  osc.stop(now + duration);
  return () => {
    gain.disconnect();
    try { osc.stop(); } catch { /* Already ended. */ }
  };
}

function playWaterNotes(notes: Array<{ freq: number; start: number; dur: number }>): () => void {
  const ac = getCtx();
  if (!ac) return () => {};
  ac.resume().catch(() => {});

  const now = ac.currentTime;

  const voices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  for (const note of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;

    const t0 = now + note.start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);

    osc.connect(gain);
    gain.connect(ac.destination);
    voices.push({ osc, gain });
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
  return () => {
    for (const { osc, gain } of voices) {
      gain.disconnect();
      try { osc.stop(); } catch { /* Already ended. */ }
    }
  };
}

/** Repeat until the absolute deadline; the returned function stops even a note
 * already playing. Check wall time so waking from sleep never replays a chime. */
export function startWaterReminderSound(expiresAt: number): () => void {
  let stopNote = () => {};
  let timer: number | undefined;
  const stop = () => { window.clearInterval(timer); stopNote(); };
  const play = () => {
    if (Date.now() >= expiresAt) { stop(); return; }
    stopNote();
    stopNote = playWaterReminderChime();
  };
  timer = window.setInterval(play, 2500);
  play();
  return stop;
}
