const HAND_LANDMARK_COUNT = 21;
const DEFAULT_POINT = { x: 0.5, y: 0.5, z: 0.0 };

const DEFAULT_CONFIG = {
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
  smoothingAlpha: 0.2,
  pinchThreshold: 0.055,
  openExtensionThreshold: 0.04,
  fistCurlThreshold: -0.015,
  stateHoldFrames: 2,
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
    this.stableState = 'NONE';
    this.candidateState = 'NONE';
    this.candidateFrames = 0;

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
    this.stableState = 'NONE';
    this.candidateState = 'NONE';
    this.candidateFrames = 0;

    this.publish(this.stableState, makeDefaultLandmarks(), 0);
  }

  onResults(results) {
    const handLandmarks = results?.multiHandLandmarks?.[0];
    const handednessScore = results?.multiHandedness?.[0]?.score;

    if (!handLandmarks || handLandmarks.length !== HAND_LANDMARK_COUNT) {
      this.lastSmoothedLandmarks = null;
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
    const stable = this.commitState(rawState);

    const confidence = clamp01(
      typeof handednessScore === 'number'
        ? handednessScore
        : this.config.minDetectionConfidence
    );

    this.publish(stable, smoothed, confidence);
  }

  smoothLandmarks(current) {
    if (!this.lastSmoothedLandmarks) {
      this.lastSmoothedLandmarks = current.map((p) => ({ ...p }));
      return this.lastSmoothedLandmarks.map((p) => ({ ...p }));
    }

    const alpha = this.config.smoothingAlpha;
    const smoothed = current.map((p, i) => {
      const prev = this.lastSmoothedLandmarks[i];
      return {
        x: alpha * p.x + (1 - alpha) * prev.x,
        y: alpha * p.y + (1 - alpha) * prev.y,
        z: alpha * p.z + (1 - alpha) * prev.z,
      };
    });

    this.lastSmoothedLandmarks = smoothed.map((p) => ({ ...p }));
    return smoothed;
  }

  detectGesture(landmarks) {
    const pinchDist = distance3(landmarks[4], landmarks[8]);
    if (pinchDist < this.config.pinchThreshold) {
      return 'PINCH';
    }

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

      if (delta > this.config.openExtensionThreshold) {
        extendedCount += 1;
      }
      if (delta < this.config.fistCurlThreshold) {
        curledCount += 1;
      }
    }

    const thumbExtended = distance3(landmarks[4], landmarks[2]) > 0.05;
    const thumbCurled = distance3(landmarks[4], landmarks[2]) < 0.03;

    if (extendedCount >= 4 && thumbExtended) {
      return 'OPEN';
    }

    if (curledCount >= 4 && thumbCurled) {
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
  }

  handleError(err) {
    if (this.onError) {
      this.onError(err);
      return;
    }
    console.error('[MediaPipeSensePublisher]', err);
  }
}
