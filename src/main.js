// Rock Paper Scissors — webcam hand game
// Steps 2-4: webcam + hand tracking, gesture detection, and the full game.

import "./style.css";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { sfx, startBgm, toggleMute } from "./audio.js";

// ---- Grab the page elements we need ----
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const placeholder = document.getElementById("stagePlaceholder");
const liveGestureEl = document.getElementById("liveGesture");
const countdownEl = document.getElementById("countdown");
const resultBanner = document.getElementById("resultBanner");
const resultHeadline = document.getElementById("resultHeadline");
const resultDetail = document.getElementById("resultDetail");
const playBtn = document.getElementById("playBtn");
const statusEl = document.getElementById("status");
const playerMoveEl = document.getElementById("playerMove");
const appMoveEl = document.getElementById("appMove");
const playerScoreEl = document.getElementById("playerScore");
const appScoreEl = document.getElementById("appScore");
const roundIndicatorEl = document.getElementById("roundIndicator");
const soundToggle = document.getElementById("soundToggle");
const playerCardEl = playerMoveEl.closest(".move-card");
const appCardEl = appMoveEl.closest(".move-card");

let handLandmarker = null; // the MediaPipe hand-tracking model
let lastVideoTime = -1; // used to skip frames the model has already seen
let currentGesture = "unknown"; // the gesture being shown right now

// ---- Game state ----
const WIN_TARGET = 2; // best of 3 → first to 2 round wins
let playerScore = 0;
let appScore = 0;
let matchOver = false;
let roundInProgress = false;

// How each move is shown to the player.
const MOVE_ICONS = { rock: "ROCK ✊", paper: "PAPER ✋", scissors: "SCISSORS ✌" };

// ============================================================
// STEP 2 — webcam + hand tracking
// ============================================================

// Load the MediaPipe hand-tracking model.
async function createHandLandmarker() {
  // The "wasm" files are MediaPipe's engine. We load them from a CDN.
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO", // we feed it a live video stream
    numHands: 1, // track one hand
  });
}

// Turn on the webcam and size the canvas to match it.
async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      resolve();
    };
  });
  await video.play();
}

// The main loop: runs once per screen frame.
function renderLoop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    drawHand(result);

    // STEP 3 — figure out which gesture the hand is making.
    if (result.landmarks && result.landmarks.length > 0) {
      currentGesture = classifyGesture(result.landmarks[0]);
    } else {
      currentGesture = "unknown";
    }
    liveGestureEl.textContent =
      currentGesture === "unknown"
        ? "SHOW YOUR HAND"
        : currentGesture.toUpperCase();
  }
  requestAnimationFrame(renderLoop);
}

// Draw cyan dots on every detected hand point.
function drawHand(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!result.landmarks || result.landmarks.length === 0) return;

  for (const landmarks of result.landmarks) {
    for (const point of landmarks) {
      // Points are 0..1 ("normalized"). Multiply by canvas size for pixels.
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#29ffe3";
      ctx.shadowColor = "#29ffe3";
      ctx.shadowBlur = 10;
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}

// ============================================================
// STEP 3 — gesture detection
// ============================================================
//
// The hand has 21 points. Point 0 is the wrist. Each finger has a
// fingertip and knuckles. A finger is "extended" (sticking out) when
// its tip is farther from the wrist than its middle knuckle (PIP).
// This trick works no matter how the hand is rotated.
//
//   index  → tip 8,  knuckle 6
//   middle → tip 12, knuckle 10
//   ring   → tip 16, knuckle 14
//   pinky  → tip 20, knuckle 18

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isFingerExtended(landmarks, tipIndex, knuckleIndex) {
  const wrist = landmarks[0];
  return (
    distance(landmarks[tipIndex], wrist) >
    distance(landmarks[knuckleIndex], wrist)
  );
}

function classifyGesture(landmarks) {
  const index = isFingerExtended(landmarks, 8, 6);
  const middle = isFingerExtended(landmarks, 12, 10);
  const ring = isFingerExtended(landmarks, 16, 14);
  const pinky = isFingerExtended(landmarks, 20, 18);

  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;

  if (extendedCount === 0) return "rock"; // closed fist
  if (extendedCount === 4) return "paper"; // open hand
  if (index && middle && !ring && !pinky) return "scissors"; // two fingers
  return "unknown"; // anything in between
}

// ============================================================
// STEP 4 — the full game
// ============================================================

const MOVES = ["rock", "paper", "scissors"];

// Every move you make is recorded so the app can learn your habits.
let playerHistory = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The move that beats the given move.
function counterMove(move) {
  return { rock: "paper", paper: "scissors", scissors: "rock" }[move];
}

// Smart app move: predict your most likely next move and beat it.
// Players repeat favourite moves and fall into patterns, so the app
// counts your past moves, guesses your favourite, and plays the counter.
// It still bluffs randomly ~25% of the time so it isn't unbeatable.
function pickAppMove() {
  if (playerHistory.length < 2 || Math.random() < 0.25) {
    return MOVES[Math.floor(Math.random() * MOVES.length)];
  }

  // Count each move, weighting your most recent moves more heavily.
  const counts = { rock: 0, paper: 0, scissors: 0 };
  playerHistory.forEach((move, i) => {
    const weight = 1 + i / playerHistory.length; // newer moves count more
    counts[move] += weight;
  });

  // Predict your favourite move, then play what beats it.
  let predicted = MOVES[0];
  for (const move of MOVES) {
    if (counts[move] > counts[predicted]) predicted = move;
  }
  return counterMove(predicted);
}

// Show one beat of the countdown ("3", "2", "1", "SHOOT!").
async function showCountdownStep(text) {
  countdownEl.textContent = text;
  countdownEl.classList.remove("show");
  void countdownEl.offsetWidth; // restart the pop animation
  countdownEl.classList.add("show");
  sfx(text === "SHOOT!" ? "shoot" : "tick"); // matching beep
  await sleep(650);
}

// Decide a round. Returns "player", "app", or "tie".
function decideWinner(playerMove, appMove) {
  if (playerMove === appMove) return "tie";
  const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[playerMove] === appMove ? "player" : "app";
}

// Show the big result banner over the stage.
function showResultBanner(headlineText, headlineClass, detailText) {
  resultHeadline.textContent = headlineText;
  resultHeadline.className = "result-headline " + headlineClass;
  resultDetail.textContent = detailText;
  resultBanner.classList.remove("show");
  void resultBanner.offsetWidth; // restart the pop animation
  resultBanner.classList.add("show");
}

function resetMatch() {
  playerScore = 0;
  appScore = 0;
  matchOver = false;
  playerScoreEl.textContent = "0";
  appScoreEl.textContent = "0";
  playerMoveEl.textContent = "—";
  appMoveEl.textContent = "—";
  playerCardEl.classList.remove("winner", "loser");
  appCardEl.classList.remove("winner", "loser");
  roundIndicatorEl.textContent = "BEST OF 3";
  playBtn.textContent = "PLAY ROUND";
  resultBanner.classList.remove("show");
}

// Run one full round when the PLAY ROUND button is pressed.
async function playRound() {
  // If the last match ended, this button press starts a rematch instead.
  if (matchOver) {
    resetMatch();
    statusEl.textContent = "New match! Press PLAY ROUND.";
    return;
  }
  if (roundInProgress) return;

  roundInProgress = true;
  playBtn.disabled = true;
  playerCardEl.classList.remove("winner", "loser");
  appCardEl.classList.remove("winner", "loser");
  resultBanner.classList.remove("show"); // clear last round's banner

  // Countdown — your gesture at "SHOOT!" is your move.
  statusEl.textContent = "Get ready...";
  await showCountdownStep("3");
  await showCountdownStep("2");
  await showCountdownStep("1");
  await showCountdownStep("SHOOT!");

  // Snapshot the gesture you are holding right now.
  const playerMove = currentGesture;
  countdownEl.classList.remove("show");

  // Couldn't read a clear rock/paper/scissors — don't count the round.
  if (playerMove === "unknown") {
    statusEl.textContent = "Couldn't read your hand — try again.";
    showResultBanner(
      "NO HAND READ",
      "tie",
      "Show a clear rock, paper, or scissors."
    );
    playBtn.disabled = false;
    roundInProgress = false;
    return;
  }

  // The app picks its move by predicting yours (see pickAppMove).
  const appMove = pickAppMove();
  // Record your move so the app keeps learning your habits.
  playerHistory.push(playerMove);

  playerMoveEl.textContent = MOVE_ICONS[playerMove];
  appMoveEl.textContent = MOVE_ICONS[appMove];

  // Decide who won the round.
  const result = decideWinner(playerMove, appMove);
  let headline, headlineClass, detail, soundName;

  if (result === "player") {
    playerScore++;
    playerScoreEl.textContent = String(playerScore);
    playerCardEl.classList.add("winner");
    appCardEl.classList.add("loser");
    statusEl.textContent = "You win this round!";
    headline = "YOU WIN THE ROUND";
    headlineClass = "win";
    detail = `${MOVE_ICONS[playerMove]} beats ${MOVE_ICONS[appMove]}`;
    soundName = "win";
  } else if (result === "app") {
    appScore++;
    appScoreEl.textContent = String(appScore);
    appCardEl.classList.add("winner");
    playerCardEl.classList.add("loser");
    statusEl.textContent = "App wins this round.";
    headline = "APP WINS THE ROUND";
    headlineClass = "lose";
    detail = `${MOVE_ICONS[appMove]} beats ${MOVE_ICONS[playerMove]}`;
    soundName = "lose";
  } else {
    statusEl.textContent = "Tie — nobody scores.";
    headline = "TIE ROUND";
    headlineClass = "tie";
    detail = `Both picked ${MOVE_ICONS[playerMove]}`;
    soundName = "tie";
  }

  // Check whether the best-of-3 match is over.
  if (playerScore >= WIN_TARGET || appScore >= WIN_TARGET) {
    matchOver = true;
    const youWon = playerScore > appScore;
    statusEl.textContent = youWon
      ? "YOU WIN THE MATCH! Press for a rematch."
      : "APP WINS THE MATCH. Press for a rematch.";
    roundIndicatorEl.textContent = youWon ? "YOU WIN!" : "APP WINS!";
    playBtn.textContent = "REMATCH";
    // Override the banner with the bigger match result.
    headline = youWon ? "🏆 YOU WIN THE MATCH!" : "APP WINS THE MATCH";
    headlineClass = youWon ? "win" : "lose";
    detail = `Final score — You ${playerScore} : ${appScore} App`;
    soundName = youWon ? "matchWin" : "matchLose";
  }

  showResultBanner(headline, headlineClass, detail);
  sfx(soundName); // play the round / match result sound

  playBtn.disabled = false;
  roundInProgress = false;
}

playBtn.addEventListener("click", () => {
  startBgm(); // start music on first interaction (browsers need a gesture)
  sfx("click");
  playRound();
});

// Sound on/off toggle in the title bar.
soundToggle.addEventListener("click", () => {
  startBgm(); // keep music running so unmuting is instant
  const muted = toggleMute();
  soundToggle.textContent = muted ? "♪ OFF" : "♪ ON";
  soundToggle.classList.toggle("off", muted);
});

// ============================================================
// Start everything
// ============================================================
async function main() {
  try {
    await createHandLandmarker();
    await startWebcam();
    placeholder.classList.add("hidden"); // camera is live — hide the cover
    renderLoop();
  } catch (err) {
    console.error(err);
    placeholder.classList.add("error");
    placeholder.innerHTML =
      "CAMERA ERROR<br /><span>" + (err.message || err) + "</span>";
  }
}

main();
