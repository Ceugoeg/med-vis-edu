const HAND_LANDMARK_COUNT = 21;
const DEFAULT_POINT = { x: 0.5, y: 0.5, z: 0.0 };

const DEFAULT_CONFIG = {
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
  smoothingAlpha: 0.2,
  adaptiveSmoothing: true,
  minAdaptiveAlpha: 0.16,
  maxAdaptiveAlpha: 0.5,
  velocityLow: 0.003,
  velocityHigh: 0.03,
  pinchThreshold: 0.055,
  dynamicPinch: true,
  pinchRatioThreshold: 0.34,
  pinchOpenBaselineCount: 2,
  openEnterExtensionThreshold: 0.035,
  openExitExtensionThreshold: 0.02,
  openEnterYGapThreshold: -0.065,
  openExitYGapThreshold: -0.045,
  fistEnterCurlThreshold: -0.01,
  fistExitCurlThreshold: -0.004,
  fistEnterYGapAbsThreshold: 0.065,
  fistExitYGapAbsThreshold: 0.08,
  thumbExtendedEnterThreshold: 0.05,
  thumbExtendedExitThreshold: 0.04,
  thumbCurledEnterThreshold: 0.065,
  thumbCurledExitThreshold: 0.075,
  stateVoteWindow: 5,
  openConfirmFramesAfterAction: 2,
  stateHoldFrames: 1,
  flipY: false,
  debug: false,
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function makeDefaultLandmarks() {
  return Array.from({ length: HAND_LANDMARK_COUNT }, () => ({ ...DEFAULT_POINT }));
}

function distance3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class MediaPipeSensePublisher {
  constructor({
    videoElement,
    handDataTarget = window,
    config = {},
    onError = null,
  } = {}) {
    if (!videoElement) {
      throw new Error('MediaPipeSensePublisher 需要 videoElement。');
    }

    this.videoElement = videoElement;
    this.handDataTarget = handDataTarget;
    this.onError = onError;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.hands = null;
    this.camera = null;
    this.stream = null;

    this.lastSmoothedLandmarks = null;
    this.lastRawLandmarks = null;
    this.lastAdaptiveAlpha = this.config.smoothingAlpha;
    this.stableState = 'NONE';
    this.candidateState = 'NONE';
    this.candidateFrames = 0;
    this.stateHistory = [];
    this.openCandidateFrames = 0;

    this.publish(this.stableState, makeDefaultLandmarks(), 0);
  }

  async start() {
    try {
      if (!window.Hands) {
        throw new Error('未检测到 MediaPipe Hands。请先加载 hands.js。');
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      this.hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this.hands.setOptions({
        maxNumHands: this.config.maxNumHands,
        modelComplexity: this.config.modelComplexity,
        minDetectionConfidence: this.config.minDetectionConfidence,
        minTrackingConfidence: this.config.minTrackingConfidence,
      });

      this.hands.onResults((results) => this.onResults(results));

      if (window.Camera) {
        this.camera = new window.Camera(this.videoElement, {
          onFrame: async () => {
            await this.hands.send({ image: this.videoElement });
          },
          width: this.videoElement.videoWidth || 1280,
          height: this.videoElement.videoHeight || 720,
        });
        await this.camera.start();
      } else {
        const loop = async () => {
          if (!this.hands || !this.videoElement.srcObject) return;
          await this.hands.send({ image: this.videoElement });
          requestAnimationFrame(loop);
        };
        loop();
      }

      if (this.config.debug) {
        console.log('[MediaPipeSensePublisher] 启动成功');
      }
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }

  async stop() {
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }

    if (this.hands) {
      this.hands.close();
      this.hands = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.videoElement.srcObject = null;

    this.lastSmoothedLandmarks = null;
    this.lastRawLandmarks = null;
    this.lastAdaptiveAlpha = this.config.smoothingAlpha;
    this.stableState = 'NONE';
    this.candidateState = 'NONE';
    this.candidateFrames = 0;
    this.stateHistory = [];
    this.openCandidateFrames = 0;

    this.publish(this.stableState, makeDefaultLandmarks(), 0);
  }

  onResults(results) {
    const handLandmarks = results?.multiHandLandmarks?.[0];
    const handednessScore = results?.multiHandedness?.[0]?.score;

    if (!handLandmarks || handLandmarks.length !== HAND_LANDMARK_COUNT) {
      this.lastSmoothedLandmarks = null;
      this.lastRawLandmarks = null;
      this.lastAdaptiveAlpha = this.config.smoothingAlpha;
      this.stateHistory = [];
      this.openCandidateFrames = 0;
      const state = this.commitState('NONE');
      this.publish(state, makeDefaultLandmarks(), 0);
      return;
    }

    const normalized = handLandmarks.map((lm) => ({
      x: clamp01(lm.x),
      y: this.config.flipY ? clamp01(1 - lm.y) : clamp01(lm.y),
      z: clamp01((lm.z + 0.5) / 1.0),
    }));

    const smoothed = this.smoothLandmarks(normalized);
    const rawState = this.detectGesture(smoothed);
    const constrainedState = this.applyTransitionConstraints(rawState);
    const votedState = this.voteState(constrainedState);
    const stable = this.commitState(votedState);

    const confidence = clamp01(
      typeof handednessScore === 'number'
        ? handednessScore
        : this.config.minDetectionConfidence
    );

    this.publish(stable, smoothed, confidence);
  }

  applyTransitionConstraints(rawState) {
    if (rawState === 'OPEN') {
      this.openCandidateFrames += 1;
    } else {
      this.openCandidateFrames = 0;
    }

    const fromState = this.stableState;
    const leavingCriticalState = fromState === 'FIST' || fromState === 'PINCH';
    if (
      leavingCriticalState &&
      rawState === 'OPEN' &&
      this.openCandidateFrames < this.config.openConfirmFramesAfterAction
    ) {
      return 'NONE';
    }

    return rawState;
  }

  voteState(state) {
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.config.stateVoteWindow) {
      this.stateHistory.shift();
    }

    const counts = new Map();
    for (const s of this.stateHistory) {
      counts.set(s, (counts.get(s) || 0) + 1);
    }

    let winner = this.stableState;
    let winnerCount = -1;
    for (const [candidate, count] of counts.entries()) {
      if (count > winnerCount) {
        winner = candidate;
        winnerCount = count;
      } else if (count === winnerCount && candidate === this.stableState) {
        winner = candidate;
      }
    }

    return winner;
  }

  smoothLandmarks(current) {
    if (!this.lastSmoothedLandmarks) {
      this.lastRawLandmarks = current.map((p) => ({ ...p }));
      this.lastSmoothedLandmarks = current.map((p) => ({ ...p }));
      return this.lastSmoothedLandmarks.map((p) => ({ ...p }));
    }

    const alpha = this.computeAdaptiveAlpha(current);
    this.lastAdaptiveAlpha = alpha;
    const smoothed = current.map((p, i) => {
      const prev = this.lastSmoothedLandmarks[i];
      return {
        x: alpha * p.x + (1 - alpha) * prev.x,
        y: alpha * p.y + (1 - alpha) * prev.y,
        z: alpha * p.z + (1 - alpha) * prev.z,
      };
    });

    this.lastRawLandmarks = current.map((p) => ({ ...p }));
    this.lastSmoothedLandmarks = smoothed.map((p) => ({ ...p }));
    return smoothed;
  }

  computeAdaptiveAlpha(current) {
    if (!this.config.adaptiveSmoothing || !this.lastRawLandmarks) {
      return this.config.smoothingAlpha;
    }

    const v = distance3(current[8], this.lastRawLandmarks[8]);
    const low = this.config.velocityLow;
    const high = this.config.velocityHigh;
    const t = clamp01((v - low) / Math.max(1e-6, high - low));
    return this.config.minAdaptiveAlpha + (this.config.maxAdaptiveAlpha - this.config.minAdaptiveAlpha) * t;
  }

  detectGesture(landmarks) {
    const pinchDist = distance3(landmarks[4], landmarks[8]);
    const handScale = Math.max(distance3(landmarks[0], landmarks[5]), 1e-6);
    const pinchRatio = pinchDist / handScale;
    const pinchMatched = this.config.dynamicPinch
      ? pinchRatio < this.config.pinchRatioThreshold
      : pinchDist < this.config.pinchThreshold;

    const wrist = landmarks[0];
    const fingerPairs = [
      [8, 5],
      [12, 9],
      [16, 13],
      [20, 17],
    ];

    let extendedCount = 0;
    let curledCount = 0;

    for (const [tipIndex, mcpIndex] of fingerPairs) {
      const tipDist = distance3(landmarks[tipIndex], wrist);
      const mcpDist = distance3(landmarks[mcpIndex], wrist);
      const delta = tipDist - mcpDist;

      if (delta > this.config.openEnterExtensionThreshold) {
        extendedCount += 1;
      }
      if (delta < this.config.fistEnterCurlThreshold) {
        curledCount += 1;
      }
    }

    const thumbDist = distance3(landmarks[4], landmarks[2]);
    const isOpenSticky = this.stableState === 'OPEN';
    const isFistSticky = this.stableState === 'FIST';

    const openDeltaThreshold = isOpenSticky
      ? this.config.openExitExtensionThreshold
      : this.config.openEnterExtensionThreshold;
    const fistDeltaThreshold = isFistSticky
      ? this.config.fistExitCurlThreshold
      : this.config.fistEnterCurlThreshold;
    const openCountThreshold = isOpenSticky ? 3 : 4;
    const fistCountThreshold = isFistSticky ? 3 : 4;
    const thumbOpenThreshold = isOpenSticky
      ? this.config.thumbExtendedExitThreshold
      : this.config.thumbExtendedEnterThreshold;
    const thumbFistThreshold = isFistSticky
      ? this.config.thumbCurledExitThreshold
      : this.config.thumbCurledEnterThreshold;
    const openYGapThreshold = isOpenSticky
      ? this.config.openExitYGapThreshold
      : this.config.openEnterYGapThreshold;
    const fistYGapAbsThreshold = isFistSticky
      ? this.config.fistExitYGapAbsThreshold
      : this.config.fistEnterYGapAbsThreshold;

    const openCount = fingerPairs.reduce((acc, [tipIndex, mcpIndex]) => {
      const tipDist = distance3(landmarks[tipIndex], wrist);
      const mcpDist = distance3(landmarks[mcpIndex], wrist);
      return acc + (tipDist - mcpDist > openDeltaThreshold ? 1 : 0);
    }, 0);

    const fistCount = fingerPairs.reduce((acc, [tipIndex, mcpIndex]) => {
      const tipDist = distance3(landmarks[tipIndex], wrist);
      const mcpDist = distance3(landmarks[mcpIndex], wrist);
      return acc + (tipDist - mcpDist < fistDeltaThreshold ? 1 : 0);
    }, 0);
    const openYCount = fingerPairs.reduce((acc, [tipIndex, mcpIndex]) => {
      const yGap = landmarks[tipIndex].y - landmarks[mcpIndex].y;
      return acc + (yGap < openYGapThreshold ? 1 : 0);
    }, 0);
    const fistYCount = fingerPairs.reduce((acc, [tipIndex, mcpIndex]) => {
      const yGapAbs = Math.abs(landmarks[tipIndex].y - landmarks[mcpIndex].y);
      return acc + (yGapAbs < fistYGapAbsThreshold ? 1 : 0);
    }, 0);

    const thumbExtendedHys = thumbDist > thumbOpenThreshold;
    const thumbCurledHys = thumbDist < thumbFistThreshold;
    const pinchBaselineReady =
      this.stableState === 'PINCH' ||
      this.stableState === 'OPEN' ||
      openYCount >= this.config.pinchOpenBaselineCount;
    const fistYCountThreshold = isFistSticky ? 3 : 4;

    if (pinchMatched && pinchBaselineReady) {
      return 'PINCH';
    }

    if (
      openCount >= openCountThreshold &&
      openYCount >= openCountThreshold &&
      thumbExtendedHys &&
      extendedCount >= 3
    ) {
      return 'OPEN';
    }

    if (
      fistCount >= fistCountThreshold &&
      fistYCount >= fistYCountThreshold &&
      thumbCurledHys &&
      curledCount >= 2
    ) {
      return 'FIST';
    }

    return 'NONE';
  }

  commitState(rawState) {
    if (rawState !== this.candidateState) {
      this.candidateState = rawState;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }

    if (
      this.candidateState !== this.stableState &&
      this.candidateFrames >= this.config.stateHoldFrames
    ) {
      this.stableState = this.candidateState;
    }

    return this.stableState;
  }

  publish(state, landmarks, confidence) {
    this.handDataTarget.handData = {
      state,
      landmarks,
      confidence,
    };
    if (this.config.debug) {
      this.handDataTarget.handData.meta = {
        adaptiveAlpha: this.lastAdaptiveAlpha,
      };
    }
  }

  handleError(err) {
    if (this.onError) {
      this.onError(err);
      return;
    }
    console.error('[MediaPipeSensePublisher]', err);
  }
}
