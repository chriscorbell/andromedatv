import { describe, expect, it } from 'vitest'
import { selectPlaybackTransport } from './use-video-player'

describe('selectPlaybackTransport', () => {
  it('prefers hls.js even when the browser also reports native HLS support', () => {
    // Chrome on macOS returns "maybe" for canPlayType('application/vnd.apple.mpegurl')
    // but cannot decode the raw MPEG-TS segments. Routing it to native HLS is what
    // produced the Chrome-only "Playback stalled" loop, so hls.js must win here.
    expect(
      selectPlaybackTransport({
        hlsJsSupported: true,
        nativeHlsSupported: true,
      }),
    ).toBe('hls')
  })

  it('uses hls.js when native HLS is unsupported (Firefox, Chrome on Win/Linux)', () => {
    expect(
      selectPlaybackTransport({
        hlsJsSupported: true,
        nativeHlsSupported: false,
      }),
    ).toBe('hls')
  })

  it('falls back to native HLS only when hls.js is unsupported (e.g. iOS Safari)', () => {
    expect(
      selectPlaybackTransport({
        hlsJsSupported: false,
        nativeHlsSupported: true,
      }),
    ).toBe('native')
  })

  it('reports no playable transport when neither is available', () => {
    expect(
      selectPlaybackTransport({
        hlsJsSupported: false,
        nativeHlsSupported: false,
      }),
    ).toBe('none')
  })
})
