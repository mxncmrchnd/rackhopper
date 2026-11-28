// Writing WAV files by hand, from a rendered AudioBuffer.
//
// A WAV file is a 44-byte header followed by the raw samples:
//
//   "RIFF" <file size - 8> "WAVE"
//   "fmt " <16> <format: 1 = PCM> <channels> <sample rate> <bytes per second>
//          <bytes per frame> <bits per sample>
//   "data" <data size> <samples...>
//
// Samples are 16-bit signed integers, interleaved (left, right, left, right...).
// Unlike MIDI files, WAV numbers are little-endian (least significant byte
// first), hence the `true` passed to every DataView setter below.

export interface WavResult {
  blob: Blob
  /** True if some samples went past full scale (-1..1) and had to be clipped. */
  clipped: boolean
}

/** Encode the first `frames` sample frames of `buffer` as a 16-bit PCM WAV file. */
export function encodeWav(buffer: AudioBuffer, frames = buffer.length): WavResult {
  const channels = buffer.numberOfChannels
  const bytesPerFrame = channels * 2
  const dataSize = frames * bytesPerFrame
  const view = new DataView(new ArrayBuffer(44 + dataSize))

  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // size of the fmt chunk
  view.setUint16(20, 1, true) // 1 = uncompressed PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * bytesPerFrame, true)
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, dataSize, true)

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  let offset = 44
  let clipped = false
  for (let i = 0; i < frames; i++) {
    for (const channel of data) {
      let sample = channel[i]
      if (sample > 1 || sample < -1) {
        clipped = true
        sample = Math.max(-1, Math.min(1, sample))
      }
      // -1..1 to -32768..32767 (the negative side has one more step).
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return { blob: new Blob([view.buffer], { type: 'audio/wav' }), clipped }
}

/**
 * The frame after the last audible sample (above -80 dB on any channel), but
 * never before `minFrames`. Used to trim the silent end of the tail.
 */
export function audibleLength(buffer: AudioBuffer, minFrames: number): number {
  const threshold = 1e-4 // -80 dB
  const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  for (let i = buffer.length - 1; i >= minFrames; i--) {
    if (data.some((channel) => Math.abs(channel[i]) > threshold)) {
      return Math.min(buffer.length, i + 1 + Math.round(buffer.sampleRate * 0.05)) // + 50 ms
    }
  }
  return Math.min(buffer.length, minFrames)
}
