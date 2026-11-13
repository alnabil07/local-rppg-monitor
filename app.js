import { FaceLandmarker, FilesetResolver } from "./vendor/vision_bundle.mjs";
import { OcularTracker, SignalPipeline, metrics } from "./signal.js";

const ids = Object.fromEntries(["video","overlay","wave","state","camera-message","start","camera-toggle","log","download","hr","hrv","rr","blink","perclos"].map(id => [id, document.getElementById(id)]));
const canvas = document.createElement("canvas"), mask = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true }), maskCtx = mask.getContext("2d", { willReadFrequently: true });
const overlay = ids.overlay.getContext("2d"), wave = ids.wave.getContext("2d");
const roiIds = [[10,109,67,69,108,9,337,299,297,338], [116,123,147,187,205,50,101], [345,352,376,411,425,280,330]];
const leftEye = [33,160,158,133,153,144], rightEye = [362,385,387,263,373,380];
let landmarker, stream, facing = "user", running = false, lastVideoTime = -1, lastCompute = 0, signals = null, latest = {}, logging = false, rows = [];
const pipeline = new SignalPipeline(), ocular = new OcularTracker();

function setState(message, good = false) { ids.state.textContent = message; ids.state.style.background = good ? "#173b27" : "#51391a"; }
function value(el, v) { el.textContent = v == null || !Number.isFinite(v) ? "--" : v.toFixed(1); }

async function loadLandmarker() {
  setState("Loading model");
  const vision = await FilesetResolver.forVisionTasks("./vendor/wasm");
  landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: "./models/face_landmarker.task" }, runningMode: "VIDEO", numFaces: 1, minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6, minTrackingConfidence: .6 });
  setState("Ready", true);
}

async function startCamera() {
  if (!landmarker) { ids["camera-message"].textContent = "Model is still loading."; return; }
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
    ids.video.srcObject = stream; await ids.video.play();
    ids.start.textContent = "Stop camera"; ids["camera-toggle"].disabled = false; ids.log.disabled = false; ids["camera-message"].hidden = true; running = true; requestAnimationFrame(loop);
  } catch (error) { ids["camera-message"].textContent = `Camera unavailable: ${error.message}`; setState("Camera error"); }
}
function stopCamera() { running = false; stream?.getTracks().forEach(track => track.stop()); stream = null; ids.start.textContent = "Start camera"; ids["camera-toggle"].disabled = true; ids.log.disabled = true; ids["camera-message"].hidden = false; }

function point(lms, index, width, height) { return [lms[index].x * width, lms[index].y * height]; }
function polygon(lms, indices, width, height) { return indices.map(i => point(lms, i, width, height)); }
function ear(lms, indices) { const p = indices.map(i => [lms[i].x, lms[i].y]); const d = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]); return (d(p[1],p[5]) + d(p[2],p[4])) / (2 * d(p[0],p[3]) + 1e-6); }

function rgbFromSkin(polygons, width, height) {
  canvas.width = mask.width = width; canvas.height = mask.height = height; ctx.drawImage(ids.video, 0, 0, width, height);
  maskCtx.clearRect(0, 0, width, height); maskCtx.fillStyle = "white";
  for (const points of polygons) { maskCtx.beginPath(); points.forEach(([x,y], i) => i ? maskCtx.lineTo(x,y) : maskCtx.moveTo(x,y)); maskCtx.closePath(); maskCtx.fill(); }
  const pixels = ctx.getImageData(0, 0, width, height).data, coverage = maskCtx.getImageData(0, 0, width, height).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < pixels.length; i += 16) { if (!coverage[i + 3]) continue; const R = pixels[i], G = pixels[i+1], B = pixels[i+2]; const cr = .5*R - .419*G - .081*B + 128, cb = -.169*R - .331*G + .5*B + 128; if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) { r += R; g += G; b += B; n++; } }
  return n > 60 ? [r/n, g/n, b/n] : null;
}

function drawRois(polygons, width, height) { overlay.canvas.width = width; overlay.canvas.height = height; overlay.clearRect(0, 0, width, height); overlay.strokeStyle = "#8ff5ae"; overlay.lineWidth = 2; for (const p of polygons) { overlay.beginPath(); p.forEach(([x,y], i) => i ? overlay.lineTo(x,y) : overlay.moveTo(x,y)); overlay.closePath(); overlay.stroke(); } }
function drawWave(samples) { const c = wave.canvas, w = c.width, h = c.height; wave.fillStyle="#0e1a12"; wave.fillRect(0,0,w,h); wave.strokeStyle="#264932"; wave.beginPath(); wave.moveTo(0,h/2); wave.lineTo(w,h/2); wave.stroke(); if (!samples?.length) return; const x = samples.slice(-150), mean=x.reduce((a,b)=>a+b,0)/x.length, max=Math.max(...x.map(v=>Math.abs(v-mean)),1e-6); wave.strokeStyle="#74efa0"; wave.lineWidth=3; wave.beginPath(); x.forEach((v,i)=>{const px=i*w/(x.length-1), py=h/2-(v-mean)/max*h*.36; i?wave.lineTo(px,py):wave.moveTo(px,py);}); wave.stroke(); }
function updateMetrics(m) { value(ids.hr,m.hr); value(ids.hrv,m.hrv); value(ids.rr,m.rr); value(ids.blink,m.blink); value(ids.perclos,m.perclos); }

function logFrame(t, rgb, currentEar) { if (!logging) return; rows.push([t.toFixed(6), rgb ? "1" : "0", ...(rgb || ["","",""]).map(v => v === "" ? "" : v.toFixed(4)), currentEar?.toFixed(5) || "", ...[latest.hr,latest.hrv,latest.rr,latest.blink,latest.perclos].map(v => v == null ? "" : v.toFixed(4))]); ids.download.disabled = false; }
function loop(now) {
  if (!running) return;
  if (ids.video.readyState >= 2 && ids.video.currentTime !== lastVideoTime) {
    lastVideoTime = ids.video.currentTime; const t = performance.now()/1000; const result = landmarker.detectForVideo(ids.video, now); const lms = result.faceLandmarks?.[0];
    let rgb = null, currentEar = null;
    if (lms) { const width=ids.video.videoWidth, height=ids.video.videoHeight, polygons=roiIds.map(set=>polygon(lms,set,width,height)); rgb=rgbFromSkin(polygons,width,height); drawRois(polygons,width,height); currentEar=(ear(lms,leftEye)+ear(lms,rightEye))/2; if (rgb) { pipeline.add(t,rgb); const eye=ocular.add(t,currentEar); if (pipeline.duration >= 10 && t-lastCompute >= .5) { signals=pipeline.process(); latest=metrics(signals,eye); lastCompute=t; } else latest={...latest,...eye}; } }
    else { overlay.clearRect(0,0,overlay.canvas.width,overlay.canvas.height); }
    logFrame(t,rgb,currentEar); drawWave(signals?.pulse);
    if (!lms) setState("Face not found"); else if (!rgb) setState("Improve frontal lighting"); else if (pipeline.duration < 10) setState(`Calibrating ${Math.ceil(10-pipeline.duration)}s`); else setState(logging ? "Logging locally" : "Ready", true);
    updateMetrics(latest);
  }
  requestAnimationFrame(loop);
}

ids.start.onclick = () => running ? stopCamera() : startCamera();
ids["camera-toggle"].onclick = async () => { facing = facing === "user" ? "environment" : "user"; await startCamera(); };
ids.log.onclick = () => { logging = !logging; ids.log.textContent = logging ? "Stop local log" : "Start local log"; if (logging && !rows.length) rows.push(["timestamp_s","face_detected","mean_r","mean_g","mean_b","ear","bpm","rmssd_ms","breaths_per_min","blink_rate_per_min","perclos_percent"]); };
ids.download.onclick = () => { const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], {type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`rppg_${new Date().toISOString().replace(/[:.]/g,"-")}.csv`; a.click(); URL.revokeObjectURL(a.href); };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
loadLandmarker().catch(error => { console.error(error); setState("Model load failed"); ids["camera-message"].textContent = "Could not load the local face model. Open once while online, then retry."; });
