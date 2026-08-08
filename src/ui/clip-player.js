// ── ClipPlayer ────────────────────────────────────────────────────────────────
/**
 * Plays through named presets in sequence with configurable hold durations.
 * Each step = { name, holdMs } — the preset is applied, held for holdMs,
 * then the next step starts. Loops until stop() is called.
 *
 * The default transition uses triggerMorphTransition() for visual continuity.
 * Hold time counts from the END of the morph animation (≈800ms after step start).
 *
 * Camera transitions: by default, camera position/target/fov tween smoothly
 * between presets. The duration is derived from the step length (40% of holdMs,
 * clamped to [200, 2500] ms) unless explicitly set via setCameraTransitionMs().
 *
 * ── Who owns the camera ──────────────────────────────────────────────────────
 * Two systems want to move the camera during a clip: the player (restoring each
 * preset's saved viewpoint) and the user (AUTO-ROTATE / the Camera Programmer).
 * The player owns it by default — PLAY always starts that way — but the user
 * outranks it the moment they take manual control mid-clip. claimCamera() is
 * how the UI reports that; from then on every step applies its preset's LOOK
 * (shape, colour, formula, shader…) and leaves the camera alone, so a
 * programmer script armed at step 3 survives steps 4, 5, 6… instead of being
 * switched off by the next preset's `autoRot: false`.
 *
 * releaseCamera() hands ownership back (the user switched AUTO-ROTATE off or
 * dragged the view), and so does the next play().
 *
 * ── Backgrounded-tab behaviour ───────────────────────────────────────────────
 * Timing is driven by `setTimeout` against wall-clock (performance.now()),
 * NOT by requestAnimationFrame counts. This is intentional:
 *   • Audio playback (Web Audio) keeps running when the tab is hidden, so a
 *     wall-clock timeline stays aligned with the music user is hearing.
 *   • An rAF-driven timer would freeze in the background (rAF stops or drops
 *     to ~1Hz), desyncing the visual clip from the still-playing music.
 *
 * The catch with wall-clock: browsers throttle setTimeout in hidden tabs
 * (~1s minimum), so a long-hidden tab returning to focus may have skipped
 * one or more onStep firings. The visibilitychange handler below recomputes
 * which step should be active right now and snaps to it, so the visible
 * frame matches "where we should be" rather than "where the throttled
 * timers happened to land".
 */
export class ClipPlayer {
  constructor(ui) {
    this._ui        = ui;
    this._steps     = [];
    this._idx       = 0;
    this._timerId   = null;
    this._tickTimer = null;
    this.playing    = false;

    // BPM-sync
    this.barsMode      = false;
    this.barsCount     = 8;
    this._stepStartMs  = 0;
    this._stepHoldMs   = 5000;

    // Camera transition between preset steps
    // null = auto-derive from holdMs; number = explicit ms (0 = instant snap, old behaviour)
    this._camTransitionMs = null;

    // Manual camera override — see "Who owns the camera" above.
    // false = the player applies each preset's camera block;
    // true  = the user took over mid-clip and the camera is left untouched.
    this.camOverride = false;

    this.cb = {
      onStep:  (_idx, _step, _holdMs) => {},
      onStop:  ()                     => {},
      onPlay:  ()                     => {},
      onTick:  (_remainMs, _totalMs)  => {},
      onCamOverride: (_active)        => {},
    };

    // ── Catch-up on visibility change ─────────────────────────────────────
    // When the tab becomes visible again, recompute which step we should be
    // on by wall-clock and snap there. We hold a reference so dispose() can
    // remove it if ever needed (currently ClipPlayer has no dispose path —
    // the page tear-down removes the listener with the document).
    this._onVisibility = () => {
      if (!this.playing || document.visibilityState !== 'visible') return;
      this._catchUp();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /**
   * Set the camera transition duration between preset steps.
   * @param {number|null} ms — milliseconds (0 = instant), or null to auto-derive
   */
  setCameraTransitionMs(ms) {
    this._camTransitionMs = ms;
  }

  /**
   * The user took manual control of the camera mid-clip — AUTO-ROTATE switched
   * on, or a Camera Programmer script applied. Subsequent steps stop applying
   * their preset's camera block.
   *
   * No-op while stopped: outside playback there is nothing to claim from, and
   * arming the flag there would silently disarm the camera of the NEXT clip.
   * play() resets it anyway; this keeps `camOverride` honest in between.
   */
  claimCamera() {
    if (!this.playing || this.camOverride) return;
    this.camOverride = true;
    this.cb.onCamOverride(true);
  }

  /**
   * Hand the camera back to the player — the user switched AUTO-ROTATE off or
   * dragged the view. (stop()/play() clear the flag silently; see stop().)
   */
  releaseCamera() {
    if (!this.camOverride) return;
    this.camOverride = false;
    this.cb.onCamOverride(false);
  }

  /**
   * Resolve the camera tween duration for a step.
   * Auto mode: 40% of step's hold time, clamped to a sensible range.
   * Manual mode: respects the explicit setting.
   */
  _resolveCamTransition(holdMs) {
    if (this._camTransitionMs !== null) return this._camTransitionMs;
    return Math.max(200, Math.min(2500, Math.round(holdMs * 0.4)));
  }

  buildFromPresets(defaultHoldMs = 5000) {
    const presets = this._ui._loadPresetList();
    this._steps = presets.map(p => ({ name: p.name, holdMs: p.holdMs ?? defaultHoldMs }));
    return this._steps;
  }

  setSteps(steps)          { this._steps = steps; }
  setStepHold(idx, holdMs) { if (this._steps[idx]) this._steps[idx].holdMs = holdMs; }

  _resolveHoldMs(step) {
    // Positivity test, not `??`: a legacy or hand-built step carrying holdMs 0
    // would otherwise schedule a step shorter than the morph itself.
    if (!this.barsMode) return step.holdMs > 0 ? step.holdMs : 5000;
    const bpm   = this._ui.audio.estimatedBpm || 120;
    const barMs = (60000 / bpm) * 4;
    return Math.round(barMs * (step.bars ?? this.barsCount));
  }

  play(startIdx = 0) {
    if (!this._steps.length) return;
    // stop() also clears camOverride: a new clip always starts on the player's
    // own camera logic, whatever the last one ended on — the user re-arms the
    // programmer by hand afterwards if they want it.
    this.stop();
    this.playing = true;
    this._idx    = startIdx % this._steps.length;
    this.cb.onPlay();
    this._runStep();
  }

  stop() {
    this.playing = false;
    // Camera ownership is per-clip. Cleared silently rather than through
    // releaseCamera(): cb.onStop tears the status line down a few lines below,
    // and announcing a handover to a player that just stopped reads as noise.
    this.camOverride = false;
    clearTimeout(this._timerId);
    clearInterval(this._tickTimer);
    this._timerId = null;
    this._tickTimer = null;
    this.cb.onStop();
  }

  skip() {
    if (!this.playing) return;
    clearTimeout(this._timerId);
    clearInterval(this._tickTimer);
    this._idx = (this._idx + 1) % this._steps.length;
    this._runStep();
  }

  _runStep() {
    if (!this.playing || !this._steps.length) return;
    const step   = this._steps[this._idx];
    const entry  = this._ui._loadPresetList().find(p => p.name === step.name);

    const holdMs   = this._resolveHoldMs(step);
    const camMs    = this._resolveCamTransition(holdMs);

    // preserveCamera carries the ownership decision into applyState: with the
    // user driving, the step is a look-only apply (no tween, no physics, no
    // auto-rotate wish, no programmer swap).
    if (entry) this._ui.applyState(entry.state, {
      cameraTransitionMs: camMs,
      preserveCamera:     this.camOverride,
    });

    const morphMs     = this._ui.render.isMobile ? 800 : 1600;
    this._stepHoldMs  = holdMs;
    this._stepStartMs = performance.now() + morphMs;

    this.cb.onStep(this._idx, step, holdMs);

    clearInterval(this._tickTimer);
    this._tickTimer = setInterval(() => {
      if (!this.playing) return;
      const remain = Math.max(0, holdMs - (performance.now() - this._stepStartMs));
      this.cb.onTick(remain, holdMs);
    }, 100);

    this._timerId = setTimeout(() => {
      clearInterval(this._tickTimer);
      if (!this.playing) return;
      this._idx = (this._idx + 1) % this._steps.length;
      this._runStep();
    }, holdMs + morphMs);
  }

  /**
   * Reconcile player position with wall-clock after a long throttled period.
   *
   * Called when the tab returns to visibility. The browser may have throttled
   * our setTimeout for seconds-to-minutes; meanwhile audio kept playing and
   * the user's perceived timeline advanced. We compute how much real time has
   * passed since the current step's start, walk forward through the step
   * sequence until we find the one that should be active *now*, and jump
   * there with a fresh _runStep().
   *
   * If we are still inside the current step's window, do nothing — the
   * already-scheduled setTimeout will fire as expected (browser usually
   * resumes pending timers promptly after focus regain).
   */
  _catchUp() {
    if (!this._steps.length) return;

    // Time already spent on the current step, counted from the moment its
    // hold window opened (post-morph). Negative if we are still inside the
    // morph transition — treat as 0.
    const elapsed = Math.max(0, performance.now() - this._stepStartMs);
    if (elapsed <= this._stepHoldMs) return;  // still inside current step

    // We are overdue. Walk forward step by step, subtracting each step's
    // hold from `overshoot` until we land in a step whose hold covers
    // the remaining overshoot. That's where the player should be now.
    let overshoot = elapsed - this._stepHoldMs;
    let idx       = (this._idx + 1) % this._steps.length;

    // Hard cap iterations at 2× pool size as a paranoid guard against an
    // accidental zero-hold step turning this into an infinite loop.
    for (let guard = 0; guard < this._steps.length * 2; guard++) {
      const h = this._resolveHoldMs(this._steps[idx]);
      if (overshoot < h || h <= 0) break;
      overshoot -= h;
      idx = (idx + 1) % this._steps.length;
    }

    // Cancel any leftover scheduled work from the throttled state and jump.
    clearTimeout(this._timerId);
    clearInterval(this._tickTimer);
    this._idx = idx;
    this._runStep();
  }
}
