/**
 * Layered pronunciation, optional Web Audio SFX (off by default),
 * and Android progressive haptic feedback (F5).
 */

const SOUND_PREF_KEY = 'vanilla-sfx-enabled'

export function getSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) === 'true'
  } catch {
    return false
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

export function speakWord(word: string): boolean {
  if (typeof window === 'undefined' || !word.trim()) return false
  try {
    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(word)
      u.lang = 'en-US'
      u.rate = 0.92
      window.speechSynthesis.speak(u)
      return true
    }
  } catch {
    /* Never block study when browser TTS is unavailable (WeChat / headless) */
  }
  return false
}

let audioCtx: AudioContext | null = null

export function playSfx(kind: 'xp' | 'levelup' | 'ring' | 'wrong'): void {
  if (typeof window === 'undefined' || !getSoundEnabled()) return
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    if (!audioCtx) audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
    const now = audioCtx.currentTime
    const notes =
      kind === 'levelup'
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === 'ring'
          ? [587.33, 783.99, 987.77]
          : kind === 'wrong'
            ? [240, 200]
            : [659.25, 880]

    notes.forEach((freq, idx) => {
      if (!audioCtx) return
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = kind === 'wrong' ? 'triangle' : 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.06)
      gain.gain.setValueAtTime(0.06, now + idx * 0.06)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.14)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(now + idx * 0.06)
      osc.stop(now + idx * 0.06 + 0.15)
    })
  } catch {
    /* Ignore Web Audio errors on restricted devices */
  }
}

export function triggerHaptic(ms = 12): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
    }
  } catch {
    /* Optional Android enhancement only */
  }
}
