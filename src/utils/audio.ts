/**
 * Audio notification utility using Web Audio API synthesis.
 * Does not require external audio assets and works reliably offline/local.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch (err) {
    console.warn('AudioContext not available:', err);
    return null;
  }
}

/** Standard two-tone chime (D5 -> A5) for general notifications */
export const playNotificationSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // First note (D5, 587.33Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.1, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Second note (A5, 880Hz)
    setTimeout(() => {
      try {
        if (ctx.state === 'closed') return;
        const now2 = ctx.currentTime;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now2);
        gain2.gain.setValueAtTime(0.1, now2);
        gain2.gain.exponentialRampToValueAtTime(0.001, now2 + 0.55);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now2);
        osc2.stop(now2 + 0.55);
      } catch {}
    }, 120);
  } catch (err) {
    console.warn('Audio chime failed:', err);
  }
};

/**
 * Vibrant 3-tone chime (E5 -> G#5 -> B5 major triad) specifically for
 * urgent reminders and follow-up callbacks.
 */
export const playFollowUpReminderSound = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [659.25, 830.61, 987.77]; // E5, G#5, B5
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        try {
          if (ctx.state === 'closed') return;
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.45);
        } catch {}
      }, idx * 110);
    });
  } catch (err) {
    console.warn('Follow-up reminder chime failed:', err);
  }
};
