/**
 * VIMATHIC — Mathematical VJ Studio
 * Copyright (c) 2026 S. Melentyev. All rights reserved.
 * Licensed under BUSL-1.1 — see LICENSE.txt
 * https://github.com/vimathic/vimathic
 */

import { fmt } from './utils.js';

/**
 * The 24 critical bands of hearing (Zwicker 1961), as 25 edges in Hz.
 *
 * Why these and not "24 equal slices of the spectrum": a critical band is the
 * width over which the ear integrates energy into one loudness, so equal steps
 * ALONG this list are equal steps to a listener. A linear split would spend
 * twenty of its bands above 5 kHz, where music has little and hearing resolves
 * least, and put the entire bass — every kick and bassline — inside band 0.
 *
 * The top edge is 15 500 rather than the textbook's 20 500: the band above it
 * is empty on every lossy-encoded source (a 128 kbps MP3 is low-passed near
 * 16 kHz, AAC near 17), so a 25th band would read zero on most material and
 * look like a dead ring on the shape.
 */
export const BARK_EDGES = Object.freeze([
  20, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480,
  1720, 2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500,
]);

/** How many bands the shape can address. 24 is not a choice; it is BARK_EDGES. */
export const BAND_COUNT = BARK_EDGES.length - 1;

/**
 * How the 24 band levels are scaled, and why it is NOT a per-band AGC.
 *
 * The first draft normalised each band against its own running floor and peak,
 * so every band reported where it sat in its own range. It passed its unit
 * tests and was wrong in the product, which a probe caught and no unit test
 * could have: driven with a 60 Hz tone and then a 9 kHz one, the rings looked
 * the SAME (difference-from-off centroid 0.346 vs 0.312 of the frame radius).
 * Per-band normalisation divides out exactly the thing the layer exists to
 * show. A band carrying nothing but the spectral leakage of a tone three
 * octaves away still has a range of its own, so it still reaches 1.0, and 24
 * bands all reading 1.0 are one band.
 *
 * What ships instead has no per-band feedback at all:
 *
 *   1. A fixed perceptual TILT. getByteFrequencyData is a dB scale mapped onto
 *      0-255 across the analyser's -85..-10 window, so one byte is 0.294 dB and
 *      a tilt is an ADDITION, not a multiply. Music is roughly pink - about
 *      -3 dB per octave - so +3 dB per octave above 200 Hz is the amount that
 *      makes a cymbal and a kick comparable without pretending they are equal.
 *   2. ONE reference for all 24, tracking the loudest tilted band with a 1.5 s
 *      decay. A quiet passage lifts every band together, which is what a
 *      listener hears, and a band with nothing in it stays dark because the
 *      reference is not its own.
 *
 * So a tone lights its band and leaves the others where they were, which is the
 * claim the whole layer rests on.
 */
/**
 * The smoothing pole, as a TIME CONSTANT rather than a per-frame fraction.
 *
 * The first version wrote `bands[i] = bands[i]*0.3 + norm*0.7` once per rendered
 * frame, which makes the filter's speed a property of the display: tau came out
 * 27.7 ms at 30 fps, 13.8 at 60, 6.9 at 120 and 5.8 at 144 — a 4.8x spread, so
 * the same track visibly behaved differently on two machines. This project has
 * already fixed that exact class twice (the beat fade in FIX(r11), the formula
 * clock in FIX(#50)); this is the third.
 *
 * 60 ms is chosen against two requirements that pull opposite ways. A beat at
 * 120 BPM is 2 Hz and has to come through: |H| = 0.80 there. Hi-hats and 16ths
 * sit near 8 Hz, and this layer reaches the COLOUR ramp as well as the geometry
 * (bands enter the field, the field is vH, vH is the palette parameter), so
 * coherent modulation up there is a flicker risk — the same concern that keeps
 * uBeat pinned to 0 in the vertex shader. At 60 ms, 8 Hz is attenuated to 0.31
 * and the corner sits at 2.65 Hz.
 */
const BAND_TAU = 0.06;

/**
 * Below this raw level a band gets no tilt.
 *
 * The tilt is an addition, and for bands above 1720 Hz it is LARGER than
 * BAND_REF_FLOOR (0.129 to 0.244 against 0.12) — so for half the spectrum the
 * floor stopped being a floor: one nonzero byte anywhere up there made that band
 * the loudest tilted band, which made it the reference, which normalised it to
 * 1.0. Measured on the real engine: a spectrum of all-ones (-84.7 dBFS, i.e.
 * silence) read 0.02 at band 0 rising monotonically to 1.00 at band 23. A
 * microphone in a quiet room would have stood the body up as a static cone.
 * The gate fades the tilt in over the bottom of the range instead, so a band has
 * to carry something before it is treated as though it carried something.
 */
const BAND_TILT_GATE = 0.06;

/**
 * Raw level below which a band is treated as carrying nothing at all.
 *
 * The gate above stops the tilt from inflating near-silence, but it cannot fix
 * the other half: the reference is the loudest tilted band, so SOMETHING is
 * always normalised to 1.0 — including, on an almost-flat spectrum, whatever
 * happens to be marginally loudest. Measured after the gate alone, a spectrum
 * of all-eights (-82.6 dBFS, inaudible) still drove a band to 1.000.
 *
 * 0.06 of the byte scale is -80.5 dBFS in this analyser's window. Nothing
 * musical lives below that, and subtracting it means a band has to clear the
 * noise before it competes for the reference at all. A real tone is untouched:
 * the 60 Hz probe tone reads raw 0.87, so it loses 7 % of its level and none of
 * its rank.
 */
const BAND_NOISE_FLOOR = 0.06;

const BAND_TILT_DB_PER_OCT = 3;
const BAND_TILT_REF_HZ     = 200;
/** The analyser window, in dB, that getByteFrequencyData stretches over 0-255. */
const BAND_DB_SPAN         = 75;
/**
 * Floor under the shared reference, so quiet material cannot become full scale.
 *
 * It has to sit ABOVE the largest tilt (0.244 at band 23), and the first value
 * did not: at 0.12 any band above 1720 Hz could clear the floor on its tilt
 * alone, become the loudest tilted band, become the reference, and normalise
 * itself to 1.0. 0.35 leaves the tilt no way to do that by itself while staying
 * below anything a real mix reaches — a tone at -12 dBFS reads 0.81 here, and
 * even a quiet passage peaking near -55 dBFS reads 0.33 to 0.57, so the
 * adaptive part of the reference still does its job on soft material.
 */
const BAND_REF_FLOOR       = 0.35;
const BAND_REF_HALFLIFE    = 1.5;

/** Per-band tilt in raw units (0-1), from the band's geometric centre. */
const BAND_TILT = Object.freeze(BARK_EDGES.slice(0, -1).map((lo, i) => {
  const fc = Math.sqrt(lo * BARK_EDGES[i + 1]);
  return Math.max(0, Math.log2(fc / BAND_TILT_REF_HZ)) * BAND_TILT_DB_PER_OCT / BAND_DB_SPAN;
}));

/**
 * How far a band may move the body, RELATIVE to the others.
 *
 * bandDepth is one scalar for all 24, which says that a cymbal and a kick
 * deserve the same displacement. Nothing physical or perceptual agrees with
 * that. A body vibrating with constant ENERGY moves less the higher it is
 * driven — amplitude falls as 1/f — and that is also how a listener feels
 * sound: bass arrives as whole-body motion, treble as fine detail on a surface
 * that is not otherwise going anywhere.
 *
 * A literal 1/f is far too steep here: from band 0's 45 Hz centre to band 23's
 * 13.6 kHz is a factor of 300, and the top of the spectrum would stop existing.
 * The exponent is the one number in this law, and 0.2 puts the ratio at 3.1x
 * across the whole range — bass roughly double the mean, cymbals roughly two
 * thirds of it:
 *
 *   band   0    4    8   12   16   20   23
 *   fc    45  452  997 1855 3414 7020 13638 Hz
 *   w   1.94 1.22 1.04 0.92 0.82 0.71  0.62
 *
 * NORMALISED TO MEAN 1, deliberately. Scaling by the maximum would make every
 * band quieter than it was and read as "the layer got weaker" — the profile is
 * meant to redistribute the movement, not remove it. Sum over the 24 is
 * unchanged, so bandDepth keeps meaning what it meant.
 *
 * ── This is not the same thing as BAND_TILT, and it partly opposes it ────────
 * BAND_TILT answers "how loud is this band, given that music is pink" — it
 * makes a cymbal and a kick COMPARABLE AS LEVELS, and without it the top of the
 * spectrum would read as silence. This answers a different question: given two
 * bands that are equally loud, how far should each move the body. So yes, this
 * pulls back some of what the tilt lifted, and that is intended rather than an
 * oversight: the two operate on different quantities, and collapsing them into
 * one curve would mean a quiet cymbal could no longer light its ring at all.
 */
const BAND_DEPTH_EXP = 0.2;
const BAND_DEPTH_PROFILE = Object.freeze((() => {
  const w = BARK_EDGES.slice(0, -1).map(
    (lo, i) => Math.pow(Math.sqrt(lo * BARK_EDGES[i + 1]), -BAND_DEPTH_EXP));
  const mean = w.reduce((a, c) => a + c, 0) / w.length;
  return w.map(v => v / mean);
})());

/** Exported for the tests and for anything that needs to undo the weighting. */
export { BAND_DEPTH_PROFILE };

/**
 * How far apart the two channels have to read, in analyser bytes, before a band
 * counts as hard-panned.
 *
 * One byte is (maxDecibels - minDecibels)/255 = 75/255 = 0.294 dB, so 26 bytes
 * is 7.6 dB between L and R. That is about where a listener stops hearing "a
 * little to the right" and starts hearing "over there", and a genuinely
 * one-sided band is far past it — the quiet channel falls to the analyser's
 * floor, which is the whole 255-byte range away, not a few bytes. The number is
 * a sensitivity, not a maximum.
 *
 * It became a sensitivity when the measurement changed. Against the mono
 * DOWN-MIX, which the first version compared to, a hard-panned source is only
 * 6.02 dB from the mix by construction — 20.5 bytes, short of this threshold,
 * so "hard panned" was literally unreachable and full pan could never be
 * expressed. An external review did that arithmetic. Comparing the channels to
 * each other removes the ceiling along with the phase problem.
 */
const PAN_FULL_BYTES = 26;

/**
 * How much a band's pan may tilt its displacement from side to side.
 *
 * 0.6 means a hard-panned band moves 1.6x on the side it is on and 0.4x on the
 * other. Both paths apply it, inside the single band lookup they share, and it
 * is exactly 1.0 at pan 0 — so mono material, a silent band and a missing side
 * tap all leave the body bit-for-bit where it was.
 */
export const BAND_PAN_TILT = 0.6;

// AudioEngine
// ─────────────────────────────────────────────────────────────────────────────
// Single owner of all audio state. Web Audio graph, file playback, crossfade,
// live capture (mic / tab / system), multi-band analysis, beat & BPM tracking.
// Emits state changes to the UI via callbacks passed at construction time.
export class AudioEngine {
  constructor(callbacks = {}) {
    // Callback contract — overridden by UIController after construction.
    // Defaults are no-ops so the engine can run headless during tests.
    this.cb = {
      onLoading:         (v, pct, msg) => {},
      onPlaylistChange:  ()            => {},
      onPlayState:       (playing)     => {},
      onSeek:            (pct, cur)    => {},
      onDuration:        (dur)         => {},
      onEQ:              (fftData)     => {},
      onLiveMode:        (mode)        => {},   // null | 'mic' | 'tab' | 'display'
      onBeat:            ()            => {},
      onTrackChange:     (_name)       => {},
      ...callbacks,
    };

    // Web Audio graph
    // FIX(#29): dropped `waveData` — it was allocated in ensureCtx() but
    // getByteTimeDomainData() was never called and nothing read the buffer.
    this.audioCtx  = null;
    this.analyser  = null;
    this.fftData   = null;

    // ── The 24-band tap ───────────────────────────────────────────────────
    // A SECOND analyser, and the separation is the point. `analyser` above is
    // sized 1024 because the beat detector reads it: 1024 samples is a 23 ms
    // window at 44.1 kHz, short enough for a kick's attack to stand out from
    // the bar around it. Bark band 0 is 20–100 Hz, which at that size is THREE
    // bins of 43 Hz — the bass would be a step function of three numbers.
    // Widening the shared analyser to 4096 fixes the bands and breaks the beat
    // (a 93 ms window smears the very transient the detector exists to find),
    // so the two jobs get two nodes. The band node is never connected to the
    // destination: an AnalyserNode analyses what reaches its input whether or
    // not its output goes anywhere, so this costs one FFT and no audio path.
    this._bandAnalyser = null;
    this._bandFft      = null;
    this._bandFpb      = 0;
    // ── The side taps ─────────────────────────────────────────────────────
    // An AnalyserNode analyses a MONO DOWN-MIX of its input, so everything
    // above — every band, the beat, the BPM — is the sum of both channels and
    // knows nothing about where in the stereo field a sound sits. Left against
    // right is the largest asymmetry recorded music actually contains, and the
    // body had no way to hear it.
    //
    // A splitter hung off the main analyser's output (its pass-through keeps
    // its channels, unlike its analysis) feeds one 4096-point tap per channel.
    //
    // TWO taps, and the first version of this had ONE — the right channel only,
    // on the argument that the mono tap already carries (L+R)/2 so the
    // difference between it and R is the imbalance. An external review took
    // that apart, and it was wrong twice:
    //   * PHASE. The down-mix sums the two channels as SIGNALS, before the FFT,
    //     so the mono spectrum is |L + R| and not (|L| + |R|)/2. Two channels
    //     at equal level but out of phase cancel in the mix, and the band would
    //     read strongly panned with nothing panned anywhere. Comparing L and R
    //     directly compares two independent magnitude spectra in one dB
    //     mapping, and no phase relationship between them can affect it.
    //   * HARD LEFT. With only a right tap, "R silent while the mix is not" is
    //     both "the splitter gave us no second channel" and "everything is on
    //     the left", and the code has to guess. With both taps the two are
    //     different readings — BOTH silent is a broken graph, one silent is
    //     real content — so the guess disappears.
    // The third FFT is what those two cost, and they are worth it.
    this._bandSplitter = null;
    this._bandL        = null;
    this._bandR        = null;
    this._bandLFft     = null;
    this._bandRFft     = null;
    /** Smoothed, self-normalised band levels, 0…1. What the band CARRIES. */
    this.bands     = new Float32Array(BAND_COUNT);
    /**
     * The same 24 levels weighted by BAND_DEPTH_PROFILE — what the band should
     * MOVE. This is the array the geometry reads; `bands` above stays the
     * measurement, so a test asking "did a 60 Hz tone light band 0" is asking
     * about the spectrum rather than about a rendering decision.
     */
    this.bandsShaped = new Float32Array(BAND_COUNT);
    /**
     * Where each band sits between the speakers: -1 hard left, 0 centred,
     * +1 hard right. Zero everywhere for mono material, for a silent band, and
     * whenever the side tap is missing — so a body that cannot hear a stereo
     * field stands exactly as it did before this existed.
     */
    this.bandPan = new Float32Array(BAND_COUNT);
    /** The one reference all 24 are measured against. See BAND_TILT. */
    this._bandRef = BAND_REF_FLOOR;

    // Live capture (mic / display) — orthogonal to file playback
    this._liveStream = null;
    this._liveSrc    = null;
    this.liveMode    = null;

    // File playback
    this.audioBuffer = null;
    this.audioSrc    = null;
    this.trackStart  = 0;
    this.trackOfs    = 0;
    this.isPlaying   = false;
    // Monotonic id stamped on each created source. Async callbacks (onended,
    // crossfade cleanup) compare against current id to bail out when a newer
    // source has taken over — prevents zombie tracks restarting playback.
    this.sourceId    = 0;
    // FIX: the same guard, one level up. loadPlay() awaits a file read and a
    // decode before it writes anything, so without an id the load that
    // FINISHED last won instead of the one requested last — a big track could
    // land on top of the small one the user switched to, and overwrite a live
    // capture connected in the meantime.
    this.loadId      = 0;
    // Which load raised the loading indicator. Only its owner may take it
    // down, so a load abandoned mid-flight cannot clear the bar of the one
    // that replaced it — see superseded() in loadPlay.
    this._loadingOwner = 0;

    // Per-frame readouts consumed by render/camera. Initial values are
    // mid-range so the visualizer doesn't snap to zero before first analysis.
    this.bass    = 0.3;
    this.mid     = 0.3;
    this.treble  = 0.3;
    this.beatInt = 0;

    // User-tunable response curves (bound to sliders)
    this.bassSens   = 1.2;
    this.trebleSens = 1.0;
    // NOTE(#29): beatPunch has no writer — render.js updateLights() reads it
    // every frame but nothing (UI, MIDI, presets, params.js) assigns it, so it
    // is a constant 1.0. Kept as the binding point for a "beat punch" control.
    this.beatPunch  = 1.0;
    this.waveInt    = 1.0;
    this.amp        = 0.7;
    /**
     * How far the 24-band layer may push a vertex, in world units.
     *
     * This shipped at 0 — off — on the argument that the layer changes what
     * every shape looks like, so it should be something a user turns on rather
     * than something an update turns on for them. That argument was overruled, and
     * the reason it was weak is worth writing down: a feature that
     * ships off and lives three clicks deep in ADVANCED has an impact of exactly
     * zero for everyone who does not go looking, which is nearly everyone. The
     * whole point of the layer is that the body answers the SPECTRUM rather than
     * three lumped numbers, and that cannot be seen from a slider at rest.
     *
     * The half of the old argument that was real — "makes their saved presets
     * render differently" — does not survive contact with the preset format:
     * bandDepth has been in PARAM_FIELDS since v3, and presets older than that
     * are migrated to an explicit 0 (see ui/presets.js). A saved preset restores
     * the depth it was saved with, whatever this line says. Only a session that
     * has never loaded a preset sees this number.
     *
     * 0.30 rather than the 0.5 the slider's midpoint would suggest: at 0.30 the
     * rings read as the body's own texture against a formula field that reaches
     * roughly 1.5 at the factory sliders, so the shape is still the formula's
     * with the music in it. Past ~0.7 the layer starts to be the thing you see
     * first — see the range note in params.js.
     *
     * Lives here, next to bassSens and amp, because it is a response curve —
     * params.js binds it exactly the way it binds those. index.html's slider
     * value= and its <span> are the third copy; tests/params-defaults-alignment
     * pins all three together.
     */
    this.bandDepth  = 0.3;
    /**
     * Whether the 24 bands are laid out by the FORMULA's own texture (true) or
     * by distance from the axis (false). Ships on, because the rings-everywhere
     * layout is the thing being replaced — but the switch stays, since for a
     * genuinely radial formula (a Bessel function) rings are the right answer
     * and the comparison is the only way to see it.
     */
    this.bandCharacter = true;
    this.colorIdx   = 0;

    // Beat detector
    this.lastBeatTime    = 0;
    this.BEAT_COOLDOWN   = 190;   // ms — refractory period; sets BPM ceiling
    // FIX(r11): kept as the near-silence floor and nothing else. It used to be
    // the whole detector — an absolute level a mixed track never drops below —
    // and the relative test in _detectBeat replaced that job.
    // Linear power, so this is a level in dB rather than a fraction of the
    // byte scale: −60 dBFS is quiet enough that nothing musical lives below it.
    this.BEAT_FLOOR      = Math.pow(10, -60 / 10);
    // The relative margins the surge has to clear: 30 % over the running mean
    // AND 1.6 deviations above it. Two conditions rather than one because a
    // steady loud passage has a high mean with a tiny deviation, while a quiet
    // passage has the opposite.
    this.BEAT_RISE       = 1.80;
    this.BEAT_SIGMAS     = 1.4;

    // Multi-band detectors — energy/timestamp pairs for kick/snare/hihat.
    // Used for BPM accuracy; band UI was removed but the data path is kept.
    this.kickEnergy  = 0; this.lastKickTime  = 0;
    this.snareEnergy = 0; this.lastSnareTime = 0;
    this.hihatEnergy = 0; this.lastHihatTime = 0;

    // BPM estimator — sliding average of last 8 inter-beat intervals.
    // Read by CameraSystem for music-synced clip timing.
    this.bpmHistory   = [];
    this.lastBeatMs   = 0;
    this.estimatedBpm = 120;

    // Crossfade state
    this.CROSSFADE_DURATION = 1.5;
    this.isCrossfading = false;
    this._fadeStartTime = 0;
    this._fadeOutGain   = null;
    this._fadeInGain    = null;
    this._fadeOldSrc    = null;

    // Playlist
    this.playlist = [];
    this.trackIdx = -1;
    this.curFile  = null;

    // FFT bin geometry — bin width = nyquist / (fftSize/2). Recomputed in
    // ensureCtx() once the analyser exists; this is just a safe default
    // for callers reading _fpb before any context has been built.
    this._nyq = 22050;
    this._fpb = this._nyq / 512;
  }

  // ── Audio context ─────────────────────────────────────────────────────────
  async ensureCtx() {
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioContext();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 1024;
        // FIX(r11): the dB window the byte spectrum is stretched over was left
        // at the Web Audio defaults, -100 dB to -30 dB. getByteFrequencyData
        // maps that window onto 0…255, so every bin at or above -30 dBFS reads
        // 255 — and on any mixed material the bass bins are far above it. The
        // band energies below were therefore pinned at their ceiling whatever
        // the track did. Measured on a simulated analyser: a plain mix peaking
        // near -12 dBFS read bass = 1.000 constantly, and even white noise at
        // -20 dBFS read 0.863. A -85…-10 window spans the range music actually
        // occupies, and the band multipliers that used to force the issue are
        // gone with it.
        this.analyser.minDecibels = -85;
        this.analyser.maxDecibels = -10;
        this.fftData  = new Uint8Array(this.analyser.frequencyBinCount);
        // FIX(#29): removed the unread `waveData` allocation (see constructor).
        // WARNING(#7): the analyser doubles as the audible path, and
        // captureMicrophone() feeds the mic into it with echoCancellation:false
        // — open speakers plus a real mic close an acoustic loop and howl.
        // A silent tap instead would change how file playback sounds, so the
        // routing stays: mute monitors or capture via a loopback device
        // (VB-Cable / BlackHole).
        this.analyser.connect(this.audioCtx.destination);
        // FIX(r11): _nyq was the constructor's 22050 placeholder — the sample
        // rate of the context was never read, so every band edge below was off
        // by whatever the device's rate is not: 8.8 % on a 48 kHz context, and
        // the "recompute" on this line reproduced the placeholder bit for bit.
        this._nyq = this.audioCtx.sampleRate / 2;
        this._fpb = this._nyq / (this.analyser.frequencyBinCount);

        // The band tap. 4096 points is 2048 bins, i.e. 10.8 Hz each at
        // 44.1 kHz, so Bark band 0 (20–100 Hz) is built from 9 bins instead of
        // the 3 the 1024-point analyser can offer. Fed FROM the main
        // analyser rather than from each source: analyser nodes pass their
        // input through unchanged, so this picks up file playback, crossfades
        // and live capture without any of those paths knowing it exists.
        this._bandAnalyser = this.audioCtx.createAnalyser();
        this._bandAnalyser.fftSize = 4096;
        this._bandAnalyser.minDecibels = this.analyser.minDecibels;
        this._bandAnalyser.maxDecibels = this.analyser.maxDecibels;
        // Its own smoothing is off: the BAND_TAU pole in _updateBands is the
        // one that shapes these, and two smoothers in series would make the
        // outer rings lag the beat by a visible amount.
        this._bandAnalyser.smoothingTimeConstant = 0;
        this._bandFft = new Uint8Array(this._bandAnalyser.frequencyBinCount);
        this._bandFpb = this._nyq / this._bandAnalyser.frequencyBinCount;
        this.analyser.connect(this._bandAnalyser);

        // The side taps. A splitter's channelCountMode is "explicit" with
        // channelCount = numberOfOutputs, so a MONO source is up-mixed to two
        // identical channels rather than leaving output 1 silent. That is spec
        // behaviour and cannot be verified from here — but with both channels
        // measured it no longer has to be: identical taps read as centred
        // whether the up-mix happened or the source was stereo and centred, and
        // BOTH taps silent under a live mix is the one reading that says the
        // splitter delivered nothing.
        //
        // Neither is connected onward, for the same reason as the band tap
        // above: an analyser measures its input whether or not its output goes
        // anywhere. Cost is two more 4096-point FFTs per frame, paid only while
        // the layer is on — _updatePan is the sole reader and it is gated.
        try {
          this._bandSplitter = this.audioCtx.createChannelSplitter(2);
          const side = () => {
            const a = this.audioCtx.createAnalyser();
            a.fftSize = this._bandAnalyser.fftSize;
            a.minDecibels = this.analyser.minDecibels;
            a.maxDecibels = this.analyser.maxDecibels;
            a.smoothingTimeConstant = 0;
            return a;
          };
          this._bandL = side(); this._bandR = side();
          this._bandLFft = new Uint8Array(this._bandL.frequencyBinCount);
          this._bandRFft = new Uint8Array(this._bandR.frequencyBinCount);
          this.analyser.connect(this._bandSplitter);
          this._bandSplitter.connect(this._bandL, 0);
          this._bandSplitter.connect(this._bandR, 1);
        } catch (e) {
          // An engine without createChannelSplitter, or a graph that refuses
          // the connection, costs the stereo term and nothing else: bandPan
          // stays zero and every other number is what it was.
          console.warn('stereo band taps unavailable:', e);
          this._bandSplitter = null;
          this._bandL = null; this._bandR = null;
          this._bandLFft = null; this._bandRFft = null;
        }
      }
      // Chromium auto-suspends contexts created before the first user
      // gesture. Resuming here is the canonical fix.
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    } catch (e) {
      console.warn('AudioContext failed:', e);
      this.audioCtx = null; this.analyser = null;
    }
  }

  // ── Live capture sources ──────────────────────────────────────────────────

  /** Stop any live capture stream (mic / display) without touching file playback. */
  stopLiveCapture() {
    if (this._liveStream) {
      this._liveStream.getTracks().forEach(t => t.stop());
      this._liveStream = null;
    }
    if (this._liveSrc) {
      try { this._liveSrc.disconnect(); } catch (_) {}
      this._liveSrc = null;
    }
    this.liveMode = null;
    this.cb.onLiveMode(null);
  }

  /**
   * FIX(#7): tear down file playback *and* the state that outlives the node.
   * _updateSeek() and getElapsedFraction() key off audioBuffer/trackStart/
   * trackOfs plus isPlaying, which live capture sets true, so plain
   * _stopSource() leaves the seek bar and the camera playhead crawling across a
   * dead track for the whole capture session. File paths keep calling
   * _stopSource() — it must leave audioBuffer intact for _startSource().
   * isPlaying / onPlayState stay untouched here: both callers set the play state
   * on the next lines, and an intermediate "stopped" would flicker the transport
   * button on every source switch.
   */
  _stopFilePlayback() {
    // FIX(r4): a load still in flight has just lost the analyser. loadPlay's
    // two generation checks only ever fired against a NEWER LOAD, because
    // ++this.loadId lived in loadPlay alone — so the capture case named in
    // this.loadId's own comment went unguarded: the abandoned track's decode
    // landed a second later, assigned audioBuffer and called _startSource(),
    // playing the file over the live capture with liveMode still reading 'mic'.
    // Both capture paths come through here, which is why the bump belongs here.
    ++this.loadId;
    this._stopSource();
    this.audioBuffer = null;
    this.trackStart  = 0;
    this.trackOfs    = 0;
    this.cb.onSeek(0, '0:00');
  }

  /**
   * Capture microphone input. Works with virtual loopback devices too
   * (VB-Audio Cable on Windows, BlackHole on macOS).
   * @param {string} [deviceId] specific deviceId from listAudioInputs()
   */
  async captureMicrophone(deviceId) {
    try {
      await this.ensureCtx();

      // Disable browser processing so the visualizer sees the raw signal.
      // Echo cancellation in particular eats bass below ~80 Hz.
      const constraints = {
        audio: {
          deviceId:          deviceId ? { exact: deviceId } : undefined,
          echoCancellation:  false,
          noiseSuppression:  false,
          autoGainControl:   false,
          sampleRate:        44100,
        }
      };
      // FIX(#7, r2): ask for the stream *before* tearing anything down — a
      // denied prompt must leave the playing track, the seek position and
      // isPlaying alone. Nothing below runs unless capture really happened.
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Only one of mic / display / file may drive the analyser, so release the
      // previous capture and the file source now that capture is certain.
      // FIX(#7): _stopFilePlayback(), not _stopSource() — see its docblock.
      this.stopLiveCapture();
      this._stopFilePlayback();

      this._liveSrc    = this.audioCtx.createMediaStreamSource(stream);
      this._liveStream = stream;
      this._liveSrc.connect(this.analyser);
      this.isPlaying = true;
      this.liveMode  = 'mic';
      this.cb.onPlayState(true);
      this.cb.onLiveMode('mic');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * Capture tab audio or system audio via getDisplayMedia.
   * On Windows Chrome, the "Share system audio" checkbox appears only when
   * sharing the entire screen — there's no API surface to force it.
   * @param {'tab'|'display'} hint cosmetic only; actual behaviour depends on the picker
   */
  async captureDisplay(hint = 'tab') {
    // getDisplayMedia with audio is Chromium-only. Firefox returns no audio
    // tracks; Safari throws. Detect upfront so callers get a clean error
    // message instead of a confusing exception.
    const ua = navigator.userAgent;
    const isFirefox = ua.includes('Firefox');
    const isSafari  = ua.includes('Safari') && !ua.includes('Chrome');
    if (isFirefox || isSafari) {
      return { ok: false, error: 'This browser does not support screen audio capture. Use Chrome or a virtual audio cable.' };
    }

    try {
      await this.ensureCtx();

      // FIX(#7, r2): the picker's Cancel rejects with NotAllowedError, so the
      // request comes first and every teardown below waits for a usable stream.
      // Cancelling leaves the playing track and its seek position untouched.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: false,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
        },
      });

      // Firefox sometimes returns a stream with no audio tracks even after
      // the picker — surface that as a graceful error, not a silent no-op.
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        return { ok: false, error: 'No audio track captured. Try sharing a tab with audio enabled.' };
      }

      // Usable capture from here on. MediaStream tracks are not GC'd while the
      // device is held, so release the previous capture together with the file
      // source it replaces. FIX(#7): same teardown as captureMicrophone().
      this.stopLiveCapture();
      this._stopFilePlayback();

      this._liveSrc    = this.audioCtx.createMediaStreamSource(stream);
      this._liveStream = stream;
      this._liveSrc.connect(this.analyser);
      this.isPlaying = true;
      this.liveMode  = hint;
      this.cb.onPlayState(true);
      this.cb.onLiveMode(hint);

      // Auto-stop when the user dismisses the browser's share dialog.
      stream.getAudioTracks()[0].onended = () => {
        this.stopLiveCapture();
        this.isPlaying = false;
        this.cb.onPlayState(false);
      };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Enumerate audio input devices. Permission prompt first so labels populate. */
  async listAudioInputs() {
    try {
      // enumerateDevices() returns empty `label` fields until the user has
      // granted at least one getUserMedia permission. Ask once, then release.
      await navigator.mediaDevices.getUserMedia({ audio: true })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(() => {});
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (_) {
      return [];
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  _startSource(offset) {
    this._stopSource();
    this.sourceId++;
    const id = this.sourceId;
    if (!this.audioCtx || !this.audioBuffer) return;
    // FIX(#7): keep mic/display/file mutually exclusive — capture killed the
    // file source, but no file path killed capture, leaving both on the
    // analyser. This is the choke point for every file start: loadPlay() and
    // seek() come here, and crossfadeToTrack() needs a live audioSrc, which
    // capture nulls. After the buffer guard, so a no-op start can't kill a
    // live session.
    if (this.liveMode) this.stopLiveCapture();
    this.audioSrc = this.audioCtx.createBufferSource();
    this.audioSrc.buffer = this.audioBuffer;
    this.audioSrc.connect(this.analyser);
    // The 200ms delay lets the buffer fully release before nextTrack()
    // requests a new one; without it, rapid track skipping can deadlock.
    this.audioSrc.onended = () => {
      if (id !== this.sourceId) return;
      if (this.isPlaying) setTimeout(() => { if (id !== this.sourceId) return; this.nextTrack(); }, 200);
    };
    this.audioSrc.start(0, offset);
    this.trackStart = this.audioCtx.currentTime;
    this.trackOfs   = offset;
  }

  _stopSource() {
    this._cancelCrossfade();
    if (this.audioSrc) {
      try { this.audioSrc.onended = null; this.audioSrc.stop(); this.audioSrc.disconnect(); } catch (_) {}
      this.audioSrc = null;
    }
  }

  // FIX(#7, r3): stopping releases live capture too. A MediaStream has no
  // resumable position, so "paused" can only mean "not captured"; leaving the
  // mic/display wired while isPlaying is false pushed update() into the idle-LFO
  // branch and drove the visuals off a stream that was still audible.
  stopAudio() {
    if (this.liveMode) this.stopLiveCapture();
    this.isPlaying = false;
    this._stopSource();
    this.cb.onPlayState(false);
    this.cb.onSeek(0, '0:00');
  }

  async togglePlay() {
    // FIX(#7, r3): the isPlaying test comes first. With capture running and an
    // empty playlist the old order opened the file picker and left the mic on.
    if (this.isPlaying) { this.stopAudio(); return; }
    if (!this.curFile && !this.playlist.length) {
      document.getElementById('audio-file').click();
      return;
    }
    await this.ensureCtx();
    if (this.trackIdx < 0 && this.playlist.length) this.trackIdx = 0;
    const f = this.playlist[this.trackIdx]?.file ?? this.curFile;
    if (f) this.loadPlay(f);
  }

  // ── Load & play ───────────────────────────────────────────────────────────
  // `silent` skips the loading indicator. Used for the bundled intro track,
  // which is auto-loaded on boot from browser cache and has no perceptible
  // load time — flashing the indicator for ~200ms looked like a glitch.
  async loadPlay(file, offset = 0, { silent = false } = {}) {
    const loadId = ++this.loadId;   // FIX: see this.loadId in the constructor
    // Has this load lost its claim? Two ways: a newer load, or a live capture
    // that took the analyser (_stopFilePlayback bumps the same token). A newer
    // load owns the loading indicator from here on and clears it when it lands;
    // a capture never touches it, so this load has to take it down on its way
    // out or the bar slides for the rest of the session. Called only after the
    // read has resolved, so no progress event can put it back up.
    const superseded = () => {
      if (loadId === this.loadId) return false;
      // Take the bar down only if it is still OURS. Keying this on liveMode
      // read as "a capture superseded us", and was wrong both ways: after a
      // capture the operator can pick a new file, and then this stale load
      // cleared the bar of a load still decoding; and when captureMicrophone
      // threw before liveMode was set, nobody took the bar down at all. The
      // owner token says exactly what the comment above claims — a newer load
      // stamps its own id when it raises the bar and clears it when it lands.
      if (!silent && this._loadingOwner === loadId) {
        this._loadingOwner = 0;
        this.cb.onLoading(false);
      }
      return true;
    };
    this._cancelCrossfade();
    if (!silent) { this._loadingOwner = loadId; this.cb.onLoading(true, 0, 'LOADING TRACK…'); }
    this._stopSource();
    this.trackStart = 0; this.trackOfs = 0;
    this.cb.onSeek(0, '0:00');
    if (this.audioCtx?.state === 'closed') this.audioCtx = null;
    try {
      await this.ensureCtx();
      const buf = await this._readFile(file, { silent });
      if (superseded()) return;             // a newer load, or a live capture, took over
      if (!silent) this.cb.onLoading(true, 0.7, 'DECODING AUDIO…');
      // Decoded into a local first: assigning straight to this.audioBuffer
      // would clobber the newer load's buffer before the check below.
      const decoded = await this.audioCtx.decodeAudioData(buf);
      if (superseded()) return;             // …or while we decoded
      this.audioBuffer = decoded;
      if (!silent) this.cb.onLoading(true, 1.0, 'READY');
      this._startSource(offset);
      this.cb.onDuration(fmt(this.audioBuffer.duration));
      this.isPlaying = true;
      this.cb.onPlayState(true);
      this.cb.onPlaylistChange();
    } catch (e) {
      // A superseded load failing says nothing about the one that replaced it:
      // reporting it would stop a track that is playing perfectly well.
      if (superseded()) return;
      console.error('Track load error:', e);
      // FIX(#7, r3): same invariant — a failed load must not flip the visuals
      // to idle while a live capture is still feeding the analyser. Nothing
      // here touches the capture, so isPlaying follows whether one is wired.
      this.isPlaying = !!this.liveMode;
      // FIX: and say so. The success path a few lines up pairs isPlaying with
      // onPlayState; this one assigned and returned, so a track that failed to
      // decode left the app silent while #play-btn still read "⏸ STOP" and
      // every play-state consumer — clip sync included — believed it was
      // running. loadPlay stops the previous source before the try block, so
      // by here the old track is already gone.
      this.cb.onPlayState(this.isPlaying);
      if (!silent) { this._loadingOwner = 0; this.cb.onLoading(false); }
      return;
    }
    // Same ownership rule on the way out: this clear lands 200 ms late, and a
    // load started inside that gap has already raised its own bar.
    if (!silent) setTimeout(() => {
      if (this._loadingOwner !== loadId) return;
      this._loadingOwner = 0;
      this.cb.onLoading(false);
    }, 200);
  }

  _readFile(file, { silent = false } = {}) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = e => { if (!silent && e.lengthComputable) this.cb.onLoading(true, e.loaded / e.total * 0.6, 'READING FILE…'); };
      r.onload = () => {
        if (!r.result || r.result.byteLength === 0) reject(new Error('Empty file'));
        else resolve(r.result);
      };
      r.onerror = () => reject(new Error('File read failed'));
      r.readAsArrayBuffer(file);
    });
  }

  // ── Crossfade ─────────────────────────────────────────────────────────────
  // A successful crossfade owns: fadeOutGain (old track), fadeInGain (new
  // track), and a stored cleanup target time. Cleanup runs in update() so it
  // fires on schedule even when the tab is backgrounded — see _checkCrossfadeCleanup.
  _cancelCrossfade() {
    if (this._fadeOutGain) { try { this._fadeOutGain.disconnect(); } catch (_) {} this._fadeOutGain = null; }
    if (this._fadeInGain)  { try { this._fadeInGain.disconnect();  } catch (_) {} this._fadeInGain  = null; }
    if (this._fadeOldSrc)  {
      try { this._fadeOldSrc.onended = null; this._fadeOldSrc.stop(); this._fadeOldSrc.disconnect(); } catch (_) {}
      this._fadeOldSrc = null;
    }
    this.isCrossfading = false;
  }

  _crossfadeOrLoad(file, offset = 0) {
    // FIX(#7): capture clears audioBuffer and audioSrc, so with capture active a
    // track change lands in loadPlay() → _startSource() → live-capture teardown.
    if (!this.audioCtx || this.audioCtx.state === 'closed' || !this.audioBuffer || !this.audioSrc) {
      this.loadPlay(file, offset);
    } else {
      this._cancelCrossfade();
      this.crossfadeToTrack(file, offset);
    }
  }

  async crossfadeToTrack(newFile, offset = 0) {
    // GainNode is in every modern browser, but be defensive — the fallback
    // is a clean hard-cut load rather than a silent failure.
    if (typeof GainNode === 'undefined') { this.loadPlay(newFile, offset); return; }
    try {
      await this.ensureCtx();
      this.cb.onLoading(true, 0, 'LOADING TRACK…');
      const buf = await this._readFile(newFile);
      this.cb.onLoading(true, 0.7, 'DECODING AUDIO…');
      const newBuffer = await this.audioCtx.decodeAudioData(buf);
      this.cb.onLoading(true, 1.0, 'READY');

      this.isCrossfading = true;
      this._fadeStartTime = this.audioCtx.currentTime;

      // Reroute the outgoing source through a fade-out gain stage.
      this._fadeOutGain = this.audioCtx.createGain();
      this._fadeOutGain.gain.setValueAtTime(1.0, this._fadeStartTime);
      this._fadeOldSrc = this.audioSrc;
      try { this.audioSrc.disconnect(); } catch (_) {}
      try { this._fadeOldSrc.connect(this._fadeOutGain); this._fadeOutGain.connect(this.analyser); } catch (_) {}
      this.audioSrc = null;

      // Build the incoming source behind a fade-in gain stage.
      this._fadeInGain = this.audioCtx.createGain();
      this._fadeInGain.gain.setValueAtTime(0.0, this._fadeStartTime);
      this.sourceId++;
      const id = this.sourceId;
      const newSrc = this.audioCtx.createBufferSource();
      newSrc.buffer = newBuffer;
      newSrc.connect(this._fadeInGain);
      this._fadeInGain.connect(this.analyser);
      newSrc.onended = () => {
        if (id !== this.sourceId) return;
        if (this.isPlaying) setTimeout(() => { if (id !== this.sourceId) return; this.nextTrack(); }, 200);
      };
      newSrc.start(0, offset);

      // Linear ramp over CROSSFADE_DURATION on both gains.
      const end = this._fadeStartTime + this.CROSSFADE_DURATION;
      this._fadeOutGain.gain.linearRampToValueAtTime(0.0, end);
      this._fadeInGain.gain.linearRampToValueAtTime(1.0, end);

      // Cleanup time is stored, not scheduled with setTimeout. Background
      // tabs throttle setTimeout to ~1 Hz; audioCtx.currentTime is unthrottled,
      // so checking it every frame inside update() guarantees on-time cleanup
      // regardless of tab visibility.
      this._xfadeEndTime = end;
      this._xfadeNewSrc  = newSrc;
      this._xfadeId      = id;

      this.audioSrc    = newSrc;
      this.audioBuffer = newBuffer;
      this.trackStart  = this.audioCtx.currentTime;
      this.trackOfs    = offset;
      this.isPlaying   = true;
      this.cb.onDuration(fmt(newBuffer.duration));
      this.cb.onPlayState(true);
      this.cb.onPlaylistChange();
      // Notify track-name consumers (overlay banner, clip player).
      const name = this.playlist[this.trackIdx]?.name ?? (this.curFile?.name?.replace(/\.[^.]+$/, '') ?? '');
      this.cb.onTrackChange(name);
      setTimeout(() => this.cb.onLoading(false), 200);
    } catch (e) {
      console.error('Crossfade error, falling back:', e);
      this._cancelCrossfade();
      this.loadPlay(newFile, offset);
    }
  }

  // ── Playlist ──────────────────────────────────────────────────────────────
  // `silent` skips the loading indicator during auto-load (intro track).
  // Caller paths from user actions (drag-drop, file picker) omit it.
  addFiles(files, { silent = false } = {}) {
    Array.from(files)
      .filter(f => f.type.startsWith('audio/'))
      .forEach(f => {
        // FIX: compare like with like. The stored `name` is the display name,
        // stripped of its extension, and this compared it against the raw
        // filename — so for any file that has an extension the guard could
        // never match and the same track piled up a row per drop. Comparing
        // the File's own name also keeps song.mp3 and song.wav as two rows,
        // which deduping by display name would not.
        if (!this.playlist.find(t => t.file?.name === f.name))
          this.playlist.push({ file: f, name: f.name.replace(/\.[^.]+$/, '') });
      });
    this.cb.onPlaylistChange();
    if (this.trackIdx < 0 && this.playlist.length) {
      this.trackIdx = 0; this.curFile = this.playlist[0].file;
      this.loadPlay(this.curFile, 0, { silent });
    }
  }

  nextTrack() {
    if (!this.playlist.length) return;
    this.trackIdx = (this.trackIdx + 1) % this.playlist.length;
    this.curFile  = this.playlist[this.trackIdx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  prevTrack() {
    if (!this.playlist.length) return;
    this.trackIdx = (this.trackIdx - 1 + this.playlist.length) % this.playlist.length;
    this.curFile  = this.playlist[this.trackIdx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  clearPlaylist() {
    // stopAudio() also drops any live capture — "clear" leaves nothing audible.
    this.stopAudio();
    this.playlist = []; this.trackIdx = -1; this.curFile = null; this.audioBuffer = null;
    // Remember explicit user clear so we don't auto-reload the intro track
    // on the next page load. See _loadIntroIfNeeded().
    try { localStorage.setItem('vimathic_intro_cleared', 'true'); } catch {}
    this.cb.onPlaylistChange();
  }

  /**
   * On first load (and every load after, until user clicks Clear), fetch the
   * bundled intro track and add it to the playlist. Once the user clicks
   * Clear, we remember that and don't auto-reload the intro again — they
   * explicitly chose to start fresh.
   *
   * No-ops gracefully if:
   *  - localStorage flag is set ("vimathic_intro_cleared" === "true")
   *  - the intro MP3 fetch fails (offline, file missing, etc.)
   *  - the playlist is already non-empty (e.g. preset restored state)
   *
   * Called once from main.js after AudioEngine instantiation. Async but
   * fire-and-forget — the rest of the app boots in parallel.
   */
  async _loadIntroIfNeeded() {
    // Both refusals, asked as one question — because they have to be asked
    // twice: once before paying for the fetch, and again before acting on it.
    const declined = () => {
      // Don't reload if the user explicitly cleared, now or in a past session.
      try {
        if (localStorage.getItem('vimathic_intro_cleared') === 'true') return true;
      } catch {} // localStorage can throw in some sandboxed contexts
      // Don't override an existing playlist (e.g. from preset restore).
      return this.playlist.length > 0;
    };

    if (declined()) return;

    try {
      // The bundled intro track is emitted to dist/vimathic-intro.mp3 by
      // Vite (from public/). Using a relative URL means this works
      // regardless of where index.html is hosted (vimathic.com, localhost,
      // file://, etc.).
      const response = await fetch('./vimathic-intro.mp3');
      if (!response.ok) return;
      const blob = await response.blob();
      // Wrap as a File so the existing playlist code (which expects File
      // objects from drag-drop / <input>) treats it uniformly.
      const file = new File(
        [blob],
        'S.Melentyev - Vimathic.mp3',
        { type: 'audio/mpeg', lastModified: Date.now() }
      );
      // FIX: ask again. The two refusals above were answered before an await
      // of a 3.9 MB fetch, and acted on seconds later — so a track dropped in
      // that window got the intro mixed into it, and a CLEAR pressed in that
      // window got the intro back AND playing, through addFiles' auto-play
      // branch, moments after the operator asked for it to go. The JSDoc above
      // promises both no-ops.
      if (declined()) return;
      this.addFiles([file], { silent: true });
    } catch (err) {
      // Silent fail — the user simply won't have the intro track in their
      // playlist on this session. They can drag-drop their own files.
      console.warn('[audio] intro track unavailable:', err?.message ?? err);
    }
  }

  playAt(idx) {
    this.trackIdx = idx;
    this.curFile  = this.playlist[idx].file;
    this._crossfadeOrLoad(this.curFile);
  }

  seek(pct) {
    if (!this.audioBuffer || !this.audioCtx || !this.analyser) return;
    const seekTo = Math.max(0, Math.min(this.audioBuffer.duration, pct * this.audioBuffer.duration));
    this._startSource(seekTo);
    this.isPlaying = true;
    this.cb.onPlayState(true);
  }

  // ── Per-frame update — called by main animate() ───────────────────────────

  /**
   * Crossfade cleanup driven by audioCtx.currentTime. Called every frame.
   * Background-tab safe — setTimeout throttling can delay cleanup by up to
   * 30 seconds, during which both old and new sources reach the analyser
   * and the visualizer goes berserk. audioCtx.currentTime is not throttled.
   */
  _checkCrossfadeCleanup() {
    if (!this.isCrossfading || !this._xfadeEndTime) return;
    if (!this.audioCtx || this.audioCtx.currentTime < this._xfadeEndTime + 0.05) return;
    // A newer track started while this crossfade was still in flight — let
    // the newer one own cleanup, just clear our handles.
    if (this._xfadeId !== this.sourceId) {
      this._xfadeEndTime = null; this._xfadeNewSrc = null; this._xfadeId = null;
      return;
    }
    const src = this._xfadeNewSrc;
    try { this._fadeOldSrc?.stop(); this._fadeOldSrc?.disconnect(); } catch (_) {}
    try { this._fadeOutGain?.disconnect(); } catch (_) {}
    try { this._fadeInGain?.disconnect(); if (src) src.connect(this.analyser); } catch (_) {}
    this._fadeOldSrc    = null;
    this._fadeOutGain   = null;
    this._fadeInGain    = null;
    this._xfadeEndTime  = null;
    this._xfadeNewSrc   = null;
    this._xfadeId       = null;
    this.isCrossfading  = false;
  }

  update(time) {
    this._checkCrossfadeCleanup();

    if (this.analyser && this.fftData && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.fftData);
      // Three-band energies with multipliers tuned to roughly equalise
      // perceived response across bass/mid/treble.
      // FIX(r11): the 1.4 and 1.2 were there to lift bands that the -100…-30
      // window had already flattened; with the window set to what music uses,
      // they only bring the ceiling closer. The clamp stays as a guard, not as
      // the operating point.
      const rb = Math.min(1, this._energy(20,   140));
      const rm = Math.min(1, this._energy(140,  2000));
      const rt = Math.min(1, this._energy(2000, 12000));
      // Low-pass smoothing: 70% new value, 30% prior frame. Removes the
      // jagged frame-to-frame jitter from raw FFT bins.
      this.bass   = this.bass   * 0.3 + rb * 0.7;
      this.mid    = this.mid    * 0.3 + rm * 0.7;
      this.treble = this.treble * 0.3 + rt * 0.7;
      // FIX(r11): the detector is handed linear power, not the 0…1 byte
      // average. getByteFrequencyData is a dB scale, and dB compresses exactly
      // the thing an onset detector needs to see: a kick 14 dB over the bed is
      // 25x in power and 19 % of the byte range, so a relative test on bytes
      // cannot be both sensitive to a kick and deaf to a loud passage.
      this._detectBeat(this._energyLinear(20, 140));
      this._detectMultiBandBeats();
      this._updateSeek();
      this.cb.onEQ(this.fftData);
    } else if (!this.isPlaying) {
      // Idle visualization — slow LFO motion so the scene doesn't look frozen
      // when nothing is playing. Three different frequencies so bands don't
      // pulse in lock-step.
      this.bass   = 0.2  + Math.sin(time * 0.7) * 0.1;
      this.mid    = 0.2  + Math.sin(time * 0.9) * 0.09;
      this.treble = 0.15 + Math.cos(time * 1.1) * 0.08;
    }
    // FIX(r11): this used to subtract a fixed 0.04 per CALL, and the call is
    // one animation frame — so the flash lasted 208 ms on a 120 Hz display,
    // 417 ms at 60 Hz and 833 ms on the mobile path, which main.js enters on
    // window width alone (RENDER_FRAME_SKIP with innerWidth < 768). Same track,
    // four-fold spread in the duty cycle a camera script sees on `beat`. It is
    // a wall-clock fade of 0.4 s now, measured with the same guards the volume
    // tick uses against a hidden tab handing back one enormous delta.
    const nowMs = this._now();
    const dt = this._lastBeatFadeMs === undefined ? 1 / 60 : (nowMs - this._lastBeatFadeMs) / 1000;
    this._lastBeatFadeMs = nowMs;
    if (dt > 0 && dt < 1) this.beatInt = Math.max(0, this.beatInt - dt / 0.4);

    // The bands ride the same wall clock and the same guard against a hidden
    // tab handing back one enormous delta. They are updated after the block
    // above so a frame in which playback stopped decays rather than holding the
    // last spectrum on screen.
    if (dt > 0 && dt < 1) {
      // The 4096-point FFT is skipped entirely while the layer is off, which is
      // the shipped default — no reason to pay for a spectrum nothing reads.
      // The decay branch still runs, so switching the slider on starts from
      // rest rather than from a spectrum frozen whenever it was last computed.
      if (this.analyser && this.fftData && this.isPlaying && this.bandDepth > 0) this._updateBands(dt);
      else this._decayBands(dt);
    }
  }

  // ── Analysis helpers ──────────────────────────────────────────────────────
  /**
   * The clock the analysis half runs on. performance.now() is monotonic;
   * Date.now() steps with the system clock, and a step backwards would stall
   * the refractory period until the wall clock caught up. _trackBpm already
   * read performance.now(), so before round 11 the detector's refractory and
   * its BPM estimate were measured on two different clocks.
   */
  _now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  /**
   * Fill `this.bands` from the 4096-point tap: 24 Bark bands, each the mean of
   * its bins, with BAND_NOISE_FLOOR subtracted and the fixed BAND_TILT faded in
   * over BAND_TILT_GATE. Those tilted levels are then normalised against ONE
   * shared reference — the loudest of them, decaying by BAND_REF_HALFLIFE and
   * floored at BAND_REF_FLOOR — and smoothed by a wall-clock one-pole at
   * BAND_TAU. No per-band feedback anywhere: see BAND_TILT for why a per-band
   * AGC is the wrong answer, and BAND_TAU for why the pole is a time constant
   * rather than the 0.3/0.7 per-frame fraction the legacy three still use.
   *
   * @param {number} dt seconds since the previous call — it drives both the
   *   shared reference's decay and the pole
   */
  _updateBands(dt) {
    const fft = this._bandFft, a = this._bandAnalyser;
    if (!fft || !a || !this._bandFpb) return;
    a.getByteFrequencyData(fft);

    // Pass one: the tilted level of every band, and the loudest of them.
    const tilted = this._bandScratch ??= new Float32Array(BAND_COUNT);
    let loudest = 0;
    for (let i = 0; i < BAND_COUNT; i++) {
      // Half-open [lo, hi), and CEIL AT BOTH ENDS — which is what makes that
      // true. The first draft floored the lower edge and ceiled the upper one,
      // so each band's last bin was also the next band's first: measured, 23 of
      // 23 boundaries overlapped at 44.1 kHz and 22 of 23 at 48 kHz, and band 0
      // reached down to 10.8 Hz, below its own 20 Hz edge. A tone sitting on a
      // boundary lit two rings instead of one. Ceiling both ends makes each
      // band end exactly where the next begins: no bin counted twice, none
      // skipped, and band 0 starts at 21.5 Hz rather than under its edge.
      // Found by an external review; the unit tests could not see it because
      // their own tone() helper built spectra with the same floor/ceil pair.
      const lo = Math.ceil(BARK_EDGES[i] / this._bandFpb);
      const hi = Math.min(fft.length, Math.ceil(BARK_EDGES[i + 1] / this._bandFpb));
      let s = 0, c = 0;
      // hi < lo when the band is entirely above Nyquist — an 8 kHz context (some
      // Bluetooth headsets force one) has nothing at all above band 17. The loop
      // simply does not run and the band reads 0, which is the truth about it.
      for (let k = lo; k < hi; k++) { s += fft[k]; c++; }
      // The mean, not the sum: bands are 9 bins wide at the bottom and 650 at
      // the top, and a sum would hand the outer rings a head start that has
      // nothing to do with what is audible.
      const raw = c ? s / c / 255 : 0;
      // Noise subtracted first, then the tilt faded in with what is left. Both
      // are needed: the subtraction decides whether a band competes for the
      // shared reference at all, the gate decides how much the tilt may inflate
      // a band that only just does.
      const q = raw - BAND_NOISE_FLOOR;
      const v = q > 0 ? q + BAND_TILT[i] * Math.min(1, q / BAND_TILT_GATE) : 0;
      tilted[i] = v;
      if (v > loudest) loudest = v;
    }

    // Pass two: one reference, decaying, with a floor under it.
    this._bandRef = Math.max(loudest, this._bandRef * Math.pow(0.5, dt / BAND_REF_HALFLIFE), BAND_REF_FLOOR);
    const ref = this._bandRef;
    // One pole, in SECONDS — see BAND_TAU. Wall-clock rather than per-frame, so
    // the rings behave the same at 30, 60 and 144 Hz.
    const k = 1 - Math.exp(-dt / BAND_TAU);
    for (let i = 0; i < BAND_COUNT; i++) {
      const norm = Math.min(1, Math.max(0, tilted[i] / ref));
      this.bands[i] += (norm - this.bands[i]) * k;
    }
    this._shapeBands();
    this._updatePan(k);
  }

  /**
   * Where each band sits between the speakers, from the two side taps.
   *
   * L and R are compared DIRECTLY, and that is the whole correctness argument.
   * Each tap is the magnitude spectrum of one channel through one dB mapping,
   * so R above L in bytes is R above L in level, band by band, and no phase
   * relationship between the channels can touch it. The first version compared
   * R against the mono down-mix instead; the down-mix sums the channels as
   * SIGNALS before the FFT, so two equal channels in antiphase cancel there and
   * the band would have read hard-panned with nothing panned anywhere.
   *
   * PAN_FULL_BYTES is what counts as hard-panned. A byte is 0.294 dB, so 26 is
   * 7.6 dB between the channels — about where a listener stops hearing "a bit
   * to the right" and starts hearing "over there". A truly one-sided source is
   * far past it and clamps, which is the intended shape.
   *
   * Two limits, stated because they are real and not fixable in this domain.
   * The bytes are clamped at both ends of the analyser's -85..-10 window, so a
   * band whose channels are both above the ceiling reads centred however
   * unequal it is, and past the clamp more imbalance stops moving the number.
   * Both are the price of measuring in the byte domain, which is also what
   * makes this a perceptual balance rather than an energy ratio.
   *
   * Smoothed with the SAME pole as the levels, so a pan cannot flicker faster
   * than a band can — the whole photosensitivity argument for BAND_TAU applies
   * to this number too, and it reaches the geometry by the same route.
   *
   * @param {number} k the already-computed one-pole coefficient for this frame
   */
  _updatePan(k) {
    const L = this._bandL, R = this._bandR;
    const fL = this._bandLFft, fR = this._bandRFft, fft = this._bandFft;
    if (!L || !R || !fL || !fR || !fft || !this._bandFpb) { this._fadePanToZero(k); return; }
    L.getByteFrequencyData(fL);
    R.getByteFrequencyData(fR);

    // The one reading that means the splitter delivered nothing: BOTH channels
    // silent while the mono tap is not. With a single side tap this test could
    // not be made — "the right is silent" was equally "there is no right
    // channel" and "everything is on the left", and the code had to guess,
    // which erased hard-left material. With both taps it is not a guess.
    let sumL = 0, sumR = 0, sumM = 0;
    for (let b = 0; b < fL.length; b++) { sumL += fL[b]; sumR += fR[b]; sumM += fft[b]; }
    if (sumL === 0 && sumR === 0 && sumM > 0) { this._fadePanToZero(k); return; }

    for (let i = 0; i < BAND_COUNT; i++) {
      // The same half-open, ceil-at-both-ends edges _updateBands uses. Sharing
      // the arithmetic is not tidiness: an earlier review found the two ends
      // computed differently there, and every band overlapped its neighbour by
      // one bin.
      const lo = Math.ceil(BARK_EDGES[i] / this._bandFpb);
      const hi = Math.min(fft.length, Math.ceil(BARK_EDGES[i + 1] / this._bandFpb));
      let sL = 0, sR = 0, sM = 0, c = 0;
      for (let b = lo; b < hi; b++) { sL += fL[b]; sR += fR[b]; sM += fft[b]; c++; }
      // A band with nothing in it has no direction, and the gate is the same
      // noise floor that decides whether a band competes for the reference at
      // all. Without it every silent band reports whatever its dither did.
      const mono = c ? sM / c / 255 : 0;
      const want = (c && mono > BAND_NOISE_FLOOR)
        ? Math.max(-1, Math.min(1, ((sR - sL) / c) / PAN_FULL_BYTES))
        : 0;
      this.bandPan[i] += (want - this.bandPan[i]) * k;
    }
  }

  /** Let the pan return to centre at the same rate it would have moved. */
  _fadePanToZero(k) {
    for (let i = 0; i < BAND_COUNT; i++) this.bandPan[i] -= this.bandPan[i] * k;
  }

  /**
   * Write `bandsShaped` from `bands`.
   *
   * Called from BOTH writers of `bands`, and that is the whole discipline here:
   * the geometry reads only the shaped array, so a path that updated `bands`
   * and forgot this one would freeze the body at whatever the previous frame
   * looked like — a failure that shows up as "the shape stopped listening"
   * rather than as an exception. Cheap enough (24 multiplies) that there is no
   * reason to be clever about when it runs.
   */
  _shapeBands() {
    for (let i = 0; i < BAND_COUNT; i++) {
      this.bandsShaped[i] = this.bands[i] * BAND_DEPTH_PROFILE[i];
    }
  }

  /** Let every band fall back to rest — used when nothing is playing. */
  _decayBands(dt) {
    // A 0.15 s half-life, so a band is under a twentieth of its value one
    // second after the music stops rather than still visibly standing.
    const k = Math.pow(0.5, dt / 0.15);
    for (let i = 0; i < BAND_COUNT; i++) this.bands[i] *= k;
    this._shapeBands();
    // The pan settles with the levels. Left holding its last value it would be
    // inert on a silent body — but the first band to come back would arrive
    // already leaning, from a track that is no longer playing.
    for (let i = 0; i < BAND_COUNT; i++) this.bandPan[i] *= k;
    this._bandRef = Math.max(BAND_REF_FLOOR, this._bandRef * Math.pow(0.5, dt / BAND_REF_HALFLIFE));
  }

  /**
   * Mean linear power over a band, undoing the analyser's dB mapping.
   * byte 0…255 spans [minDecibels, maxDecibels], so dB = min + byte/255·(max−min)
   * and power = 10^(dB/10). Used by the beat detector; the display bands stay
   * on the byte average, which is the perceptual curve they want.
   */
  _energyLinear(lo, hi) {
    if (!this.fftData || !this.analyser) return 0;
    const min = this.analyser.minDecibels ?? -100, max = this.analyser.maxDecibels ?? -30;
    let s = 0, c = 0;
    const a = Math.floor(lo / this._fpb);
    const b = Math.min(this.fftData.length - 1, Math.ceil(hi / this._fpb));
    for (let i = a; i <= b; i++) { s += Math.pow(10, (min + this.fftData[i] / 255 * (max - min)) / 10); c++; }
    return c ? s / c : 0;
  }

  _energy(lo, hi) {
    if (!this.fftData) return 0;
    let s = 0, c = 0;
    const a = Math.floor(lo / this._fpb);
    const b = Math.min(this.fftData.length - 1, Math.ceil(hi / this._fpb));
    for (let i = a; i <= b; i++) { s += this.fftData[i]; c++; }
    return c ? s / c / 255 : 0;
  }

  _detectBeat(b) {
    // FIX(r11): this was an absolute level test — `b > 0.65` — with no moving
    // baseline of any kind, so on material whose bass sat above the threshold
    // the condition was simply always true and the only thing setting the beat
    // rate was the 190 ms refractory period: 5.3 "beats" a second, and
    // estimatedBpm converging on ~300 whatever the track was. Everything that
    // calls itself music-synced ran 2.3-2.5x fast on that number — AUTO COLOUR
    // at 8 bars fired every 6.4 s instead of 15, a 4-bar clip step every 3.0 s
    // instead of 7.5.
    //
    // A beat is a local surge now: the band's POWER has to stand above its own
    // recent mean by a margin that scales with how much that mean has been
    // moving, so a loud steady passage is not a beat and a kick in a quiet one
    // is. The floor keeps the detector off in near-silence, where mean and
    // deviation are both tiny and any ripple clears a relative test.
    const h = this._bassHist ??= [];
    h.push(b);
    if (h.length > 60) h.shift();
    let mean = 0;
    for (const v of h) mean += v;
    mean /= h.length;
    let varsum = 0;
    for (const v of h) varsum += (v - mean) * (v - mean);
    const sd = Math.sqrt(varsum / h.length);
    const surging = h.length >= 20 && b > mean * this.BEAT_RISE && b > mean + sd * this.BEAT_SIGMAS && b > this.BEAT_FLOOR;
    const now = this._now();
    if (surging && now - this.lastBeatTime > this.BEAT_COOLDOWN) {
      this.lastBeatTime = now;
      this.beatInt = 1.0;
      this._trackBpm();
      this.cb.onBeat();
      return true;
    }
    return false;
  }

  _trackBpm() {
    // Sliding average of last 8 intervals — short enough to follow tempo
    // changes, long enough to ride out missed beats. Intervals > 2s are
    // dropped (likely a section break, not a real beat).
    const now = performance.now();
    const interval = now - this.lastBeatMs;
    if (this.lastBeatMs > 0 && interval < 2000) {
      this.bpmHistory.push(60000 / interval);
      if (this.bpmHistory.length > 8) this.bpmHistory.shift();
      this.estimatedBpm = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
    }
    this.lastBeatMs = now;
  }

  _detectMultiBandBeats() {
    const now = this._now();
    // Tuned bands and gains chosen empirically against drum mixes.
    // Smoothing constants differ per band: hihats decay faster than kicks.
    this.kickEnergy  = this.kickEnergy  * 0.3 + this._energy(40,    100)   * 1.6 * 0.7;
    this.snareEnergy = this.snareEnergy * 0.3 + this._energy(150,   250)   * 1.4 * 0.7;
    this.hihatEnergy = this.hihatEnergy * 0.2 + this._energy(8000, 15000)  * 2.0 * 0.8;
    // NOTE(#29): lastKick/Snare/HihatTime are written here and read nowhere —
    // the per-band UI that consumed them is gone. Kept as the hook for per-band
    // triggers (band-gated camera cuts, MIDI note-out).
    if (this.kickEnergy  > 0.55 && now - this.lastKickTime  > 200) this.lastKickTime  = now;
    if (this.snareEnergy > 0.45 && now - this.lastSnareTime > 180) this.lastSnareTime = now;
    if (this.hihatEnergy > 0.35 && now - this.lastHihatTime > 80)  this.lastHihatTime = now;
  }

  _updateSeek() {
    if (!this.audioCtx || !this.audioBuffer || !this.isPlaying) return;
    const elapsed = Math.min(this.audioBuffer.duration, this.audioCtx.currentTime - this.trackStart + this.trackOfs);
    const pct = elapsed / this.audioBuffer.duration * 100;
    this.cb.onSeek(pct, fmt(elapsed));
  }

  /** Fraction 0..1 of the current track. Read by the Camera Programmer. */
  getElapsedFraction() {
    // The isPlaying test is the same one _updateSeek() above carries, and it is
    // not optional: audioCtx.currentTime keeps advancing after stopAudio(), so
    // without it the camera-programmer playhead crawls on by itself while the
    // transport says 0:00, and every keyframe added from a stopped track lands
    // at a time that depends on how long the user spent typing. Zero is where
    // stopAudio() already tells the UI the track is.
    if (!this.audioBuffer || !this.audioCtx || !this.isPlaying) return 0;
    const elapsed = Math.min(this.audioBuffer.duration, this.audioCtx.currentTime - this.trackStart + this.trackOfs);
    return elapsed / this.audioBuffer.duration;
  }

  dispose() {
    this._cancelCrossfade();
    this.stopLiveCapture();
    if (this.audioSrc)  try { this.audioSrc.stop(); } catch (_) {}
    if (this.audioCtx)  try { this.audioCtx.close();  } catch (_) {}
  }
}
