import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

/**
 * Evens out a microphone before it's sent, so a quiet talker (phone held far
 * away, a weak mic) comes through at a normal volume for everyone at the table:
 *
 *   mic → compressor (lifts quiet speech, reins in shouting) → +3 dB → limiter (no distortion) → out
 *
 * Measured with a test tone: a quiet mic comes up ~15 dB, a normal one ~9 dB,
 * a loud one stays put. (The compressor adds its own make-up gain, so the
 * extra +3 dB is enough; more would mostly lift background noise.)
 *
 * It runs on the speaker's own device, so the listeners' audio stays plain and
 * their browsers' echo cancellation keeps working.
 */
export function micLeveler(): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let nodes: AudioNode[] = [];
  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'capicua-mic-leveler',
    async init({ track, audioContext }) {
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.2;
      const makeUp = audioContext.createGain();
      makeUp.gain.value = 1.4;
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;
      const out = audioContext.createMediaStreamDestination();
      source.connect(compressor).connect(makeUp).connect(limiter).connect(out);
      nodes = [source, compressor, makeUp, limiter, out];
      processor.processedTrack = out.stream.getAudioTracks()[0];
    },
    async restart(opts) {
      await processor.destroy();
      await processor.init(opts);
    },
    async destroy() {
      nodes.forEach((n) => n.disconnect());
      nodes = [];
      processor.processedTrack?.stop();
      processor.processedTrack = undefined;
    },
  };
  return processor;
}
