import { MediaPipeSensePublisher } from './mediapipe_hand_publisher.js';

const video = document.getElementById('camera-preview');
const output = document.getElementById('output');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

let publisher = null;
let timer = null;

function render() {
  const handData = window.handData || {
    state: 'NONE',
    confidence: 0,
    landmarks: [],
  };

  const finger = handData.landmarks?.[8] || { x: 0, y: 0, z: 0 };
  output.textContent = JSON.stringify(
    {
      state: handData.state,
      confidence: Number(handData.confidence || 0).toFixed(3),
      index8: finger,
      points: handData.landmarks?.length || 0,
    },
    null,
    2
  );
}

startBtn.addEventListener('click', async () => {
  if (publisher) return;

  publisher = new MediaPipeSensePublisher({
    videoElement: video,
    config: {
      smoothingAlpha: 0.2,
      stateHoldFrames: 2,
      flipY: true,
      debug: true,
    },
  });

  try {
    await publisher.start();
    timer = setInterval(render, 100);
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    publisher = null;
    alert(`启动失败: ${err.message}`);
  }
});

stopBtn.addEventListener('click', async () => {
  if (!publisher) return;
  await publisher.stop();
  publisher = null;
  clearInterval(timer);
  timer = null;
  render();
  startBtn.disabled = false;
  stopBtn.disabled = true;
});

render();
