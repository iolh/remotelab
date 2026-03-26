"use strict";

const voiceInputBtn = document.getElementById("voiceInputBtn");
const voiceFileInput = document.getElementById("voiceFileInput");
const voiceInputStatus = document.getElementById("voiceInputStatus");
const voiceSettingsMount = document.getElementById("voiceSettingsMount");

const VOICE_INPUT_PREFS_KEY = "voiceInputPrefs";
const VOICE_INPUT_DIAGNOSTICS_KEY = "voiceInputDiagnostics";
const VOICE_INPUT_DIAGNOSTICS_LIMIT = 120;
const VOICE_INPUT_PREFS_VERSION = 5;
const VOICE_CAPTURE_MODE_BROWSER_DIRECT = "browser-direct";
const VOICE_CAPTURE_MODE_SERVER_RELAY = "server-relay";
const DEFAULT_VOICE_INPUT_PREFS = Object.freeze({
  captureMode: VOICE_CAPTURE_MODE_SERVER_RELAY,
  attachOriginalAudio: false,
  autoSend: false,
  rewriteWithContext: true,
  version: VOICE_INPUT_PREFS_VERSION,
});

const voiceState = {
  config: null,
  loadingConfig: false,
  busy: false,
  recording: false,
  recorder: null,
  stream: null,
  chunks: [],
  startedAt: 0,
  timerId: 0,
  statusTimerId: 0,
  live: null,
  browserRecognition: null,
  composerPreview: null,
  diagnostics: [],
  diagnosticsSummaryEl: null,
  diagnosticsTextEl: null,
  diagnosticsBootstrapped: false,
};

const scheduleTimeout =
  (typeof window !== "undefined" && typeof window.setTimeout === "function" && window.setTimeout.bind(window))
  || (typeof globalThis.setTimeout === "function" && globalThis.setTimeout.bind(globalThis));
const cancelTimeout =
  (typeof window !== "undefined" && typeof window.clearTimeout === "function" && window.clearTimeout.bind(window))
  || (typeof globalThis.clearTimeout === "function" && globalThis.clearTimeout.bind(globalThis));
const scheduleInterval =
  (typeof window !== "undefined" && typeof window.setInterval === "function" && window.setInterval.bind(window))
  || (typeof globalThis.setInterval === "function" && globalThis.setInterval.bind(globalThis));
const cancelInterval =
  (typeof window !== "undefined" && typeof window.clearInterval === "function" && window.clearInterval.bind(window))
  || (typeof globalThis.clearInterval === "function" && globalThis.clearInterval.bind(globalThis));
const SpeechRecognitionCtor =
  (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition))
  || null;

function normalizeVoiceCaptureMode(value) {
  return value === VOICE_CAPTURE_MODE_SERVER_RELAY
    ? VOICE_CAPTURE_MODE_SERVER_RELAY
    : VOICE_CAPTURE_MODE_BROWSER_DIRECT;
}

function normalizeVoiceInputPrefs(raw = {}) {
  return {
    captureMode: normalizeVoiceCaptureMode(raw?.captureMode),
    attachOriginalAudio: raw?.attachOriginalAudio === true,
    autoSend: raw?.autoSend === true,
    rewriteWithContext: raw?.rewriteWithContext !== false,
    version: VOICE_INPUT_PREFS_VERSION,
  };
}

function migrateVoiceInputPrefs(raw = {}) {
  return normalizeVoiceInputPrefs({
    ...DEFAULT_VOICE_INPUT_PREFS,
    captureMode: raw?.version === 3
      ? VOICE_CAPTURE_MODE_SERVER_RELAY
      : raw?.captureMode,
    attachOriginalAudio: raw?.attachOriginalAudio === true,
    autoSend: raw?.version >= VOICE_INPUT_PREFS_VERSION
      ? raw?.autoSend === true
      : false,
    rewriteWithContext: raw?.rewriteWithContext !== false,
  });
}

function readVoiceInputPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_INPUT_PREFS_KEY) || "null");
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULT_VOICE_INPUT_PREFS };
    }
    if (raw.version === VOICE_INPUT_PREFS_VERSION) {
      return normalizeVoiceInputPrefs(raw);
    }
    const migratedPrefs = migrateVoiceInputPrefs(raw);
    localStorage.setItem(VOICE_INPUT_PREFS_KEY, JSON.stringify(migratedPrefs));
    return migratedPrefs;
  } catch {
    return { ...DEFAULT_VOICE_INPUT_PREFS };
  }
}

function writeVoiceInputPrefs(nextPrefs = {}) {
  const prefs = normalizeVoiceInputPrefs({
    ...readVoiceInputPrefs(),
    ...nextPrefs,
  });
  localStorage.setItem(VOICE_INPUT_PREFS_KEY, JSON.stringify(prefs));
  return prefs;
}

function readVoiceInputDiagnostics() {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_INPUT_DIAGNOSTICS_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((entry) => typeof entry === "string" && entry.trim()).slice(-VOICE_INPUT_DIAGNOSTICS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeVoiceInputDiagnostics(entries = []) {
  const nextEntries = Array.isArray(entries)
    ? entries.filter((entry) => typeof entry === "string" && entry.trim()).slice(-VOICE_INPUT_DIAGNOSTICS_LIMIT)
    : [];
  voiceState.diagnostics = nextEntries;
  try {
    localStorage.setItem(VOICE_INPUT_DIAGNOSTICS_KEY, JSON.stringify(nextEntries));
  } catch {}
}

function formatVoiceDiagnosticDetails(details = {}) {
  if (!details || typeof details !== "object") return "";
  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  return entries.join(" ");
}

function getVoiceDiagnosticsText() {
  const buildTitle = window.__REMOTELAB_BUILD__?.title || window.__REMOTELAB_BUILD__?.label || "";
  const summaryLines = [
    buildTitle ? `build=${buildTitle}` : "",
    `captureMode=${resolveVoiceCaptureMode(readVoiceInputPrefs())}`,
    `browserDirect=${supportsBrowserDirectVoiceInput() ? "supported" : "unsupported"}`,
    `relayConfigured=${canUseServerRelayVoiceInput() ? "yes" : "no"}`,
    voiceState.config?.language ? `language=${voiceState.config.language}` : "",
    navigator?.userAgent ? `userAgent=${navigator.userAgent}` : "",
  ].filter(Boolean);
  return [
    ...summaryLines,
    summaryLines.length ? "" : null,
    ...voiceState.diagnostics,
  ].filter(Boolean).join("\n");
}

function syncVoiceDiagnosticsView() {
  if (voiceState.diagnosticsSummaryEl) {
    const lastLine = voiceState.diagnostics[voiceState.diagnostics.length - 1] || "";
    voiceState.diagnosticsSummaryEl.textContent = lastLine
      ? `Last event: ${lastLine}`
      : "No diagnostics yet. Reproduce the issue once and this panel will fill itself.";
  }
  if (voiceState.diagnosticsTextEl) {
    voiceState.diagnosticsTextEl.textContent = getVoiceDiagnosticsText() || "No diagnostics yet.";
  }
}

function appendVoiceDiagnostic(message, details = null) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return;
  const timestamp = new Date().toISOString();
  const detailText = formatVoiceDiagnosticDetails(details || {});
  const line = detailText ? `${timestamp} ${text} | ${detailText}` : `${timestamp} ${text}`;
  writeVoiceInputDiagnostics([...voiceState.diagnostics, line]);
  syncVoiceDiagnosticsView();
  try {
    console.info(`[voice-input] ${line}`);
  } catch {}
}

function clearVoiceDiagnostics() {
  writeVoiceInputDiagnostics([]);
  syncVoiceDiagnosticsView();
}

async function copyVoiceDiagnosticsToClipboard() {
  const text = getVoiceDiagnosticsText();
  if (!text) {
    setVoiceInputStatus("当前还没有语音诊断日志。", { error: true });
    return;
  }
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    setVoiceInputStatus("语音诊断日志已复制。", { persist: true });
    return;
  }
  setVoiceInputStatus("当前浏览器不支持直接复制日志，请手动长按诊断区复制。", { error: true, persist: true });
}

function ensureVoiceDiagnosticsBootstrapped() {
  if (voiceState.diagnosticsBootstrapped) return;
  voiceState.diagnosticsBootstrapped = true;
  writeVoiceInputDiagnostics(readVoiceInputDiagnostics());
  appendVoiceDiagnostic("语音诊断已初始化", {
    requestedMode: readVoiceInputPrefs().captureMode,
    browserDirect: supportsBrowserDirectVoiceInput(),
    relayConfigured: canUseServerRelayVoiceInput(),
  });
}

function setVoiceInputStatus(message, { error = false, persist = false } = {}) {
  if (!voiceInputStatus) return;
  cancelTimeout?.(voiceState.statusTimerId);
  const text = typeof message === "string" ? message.trim() : "";
  voiceInputStatus.textContent = text;
  voiceInputStatus.classList.toggle("visible", !!text);
  voiceInputStatus.classList.toggle("is-error", !!text && !!error);
  if (text && !persist) {
    voiceState.statusTimerId = scheduleTimeout?.(() => {
      if (!voiceState.recording && !voiceState.busy) {
        setVoiceInputStatus("");
      }
    }, error ? 5000 : 3200);
  }
}

function dispatchComposerInput() {
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildVoiceComposerValue(baseValue, transcript) {
  const base = typeof baseValue === "string" ? baseValue : "";
  const normalizedTranscript = typeof transcript === "string" ? transcript.trim() : "";
  if (!normalizedTranscript) return base;
  return base.trim()
    ? `${base.replace(/\s+$/, "")}\n${normalizedTranscript}`
    : normalizedTranscript;
}

function startVoiceComposerPreview() {
  voiceState.composerPreview = {
    baseValue: typeof msgInput.value === "string" ? msgInput.value : "",
    transcript: "",
  };
  msgInput.classList.add("is-voice-live");
}

function updateVoiceComposerPreview(transcript) {
  if (!voiceState.composerPreview) return;
  const normalized = typeof transcript === "string" ? transcript.trim() : "";
  voiceState.composerPreview.transcript = normalized;
  msgInput.value = buildVoiceComposerValue(voiceState.composerPreview.baseValue, normalized);
  dispatchComposerInput();
}

function clearVoiceComposerPreview({ keepCurrent = false } = {}) {
  if (!voiceState.composerPreview) return false;
  const { baseValue = "", transcript = "" } = voiceState.composerPreview;
  if (!keepCurrent) {
    msgInput.value = buildVoiceComposerValue(baseValue, transcript && keepCurrent ? transcript : "");
    dispatchComposerInput();
  }
  msgInput.classList.remove("is-voice-live");
  const baseWasEmpty = !String(baseValue || "").trim();
  voiceState.composerPreview = null;
  return baseWasEmpty;
}

function finishVoiceComposerPreview(finalTranscript = "", { keepLiveText = false } = {}) {
  if (!voiceState.composerPreview) {
    if (typeof finalTranscript === "string") {
      const previousValue = typeof msgInput.value === "string" ? msgInput.value : "";
      msgInput.classList.remove("is-voice-live");
      msgInput.value = buildVoiceComposerValue(previousValue, finalTranscript);
      dispatchComposerInput();
      return !String(previousValue || "").trim();
    }
    return !String(msgInput.value || "").trim();
  }
  const { baseValue = "", transcript = "" } = voiceState.composerPreview;
  const nextTranscript = keepLiveText
    ? transcript
    : (typeof finalTranscript === "string" ? finalTranscript.trim() : "");
  msgInput.value = buildVoiceComposerValue(baseValue, nextTranscript);
  dispatchComposerInput();
  msgInput.classList.remove("is-voice-live");
  const baseWasEmpty = !String(baseValue || "").trim();
  voiceState.composerPreview = null;
  return baseWasEmpty;
}

function resolveVoiceInputWsUrl(sessionId) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const encodedSessionId = encodeURIComponent(typeof sessionId === "string" ? sessionId : "");
  return `${protocol}//${window.location.host}/ws/voice-input?sessionId=${encodedSessionId}`;
}

function convertFloatToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, Number(sample) || 0));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function downsampleVoiceBuffer(input, inputSampleRate, outputSampleRate = 16000) {
  if (!input || input.length === 0) {
    return new Int16Array(0);
  }
  if (!inputSampleRate || inputSampleRate <= outputSampleRate) {
    const direct = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      direct[index] = convertFloatToInt16(input[index]);
    }
    return direct;
  }
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  let offsetBuffer = 0;
  for (let index = 0; index < outputLength; index += 1) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let sampleIndex = offsetBuffer; sampleIndex < nextOffsetBuffer; sampleIndex += 1) {
      sum += input[sampleIndex];
      count += 1;
    }
    const averaged = count > 0
      ? sum / count
      : input[Math.min(offsetBuffer, input.length - 1)] || 0;
    output[index] = convertFloatToInt16(averaged);
    offsetBuffer = nextOffsetBuffer;
  }
  return output;
}

function cloneArrayBuffer(view) {
  const array = view instanceof Int16Array ? view : new Int16Array(view || []);
  return array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength);
}

function formatRecordingDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function isOwnerView() {
  return pageBootstrap?.auth?.role !== "visitor";
}

function supportsBrowserDirectVoiceInput() {
  return typeof SpeechRecognitionCtor === "function";
}

function canUseServerRelayVoiceInput() {
  return !!voiceState.config?.enabled && !!voiceState.config?.configured;
}

function resolveVoiceCaptureMode(prefs = readVoiceInputPrefs()) {
  const requestedMode = normalizeVoiceCaptureMode(prefs?.captureMode);
  if (requestedMode === VOICE_CAPTURE_MODE_BROWSER_DIRECT && supportsBrowserDirectVoiceInput()) {
    return VOICE_CAPTURE_MODE_BROWSER_DIRECT;
  }
  if (canUseServerRelayVoiceInput()) {
    return VOICE_CAPTURE_MODE_SERVER_RELAY;
  }
  if (supportsBrowserDirectVoiceInput()) {
    return VOICE_CAPTURE_MODE_BROWSER_DIRECT;
  }
  return VOICE_CAPTURE_MODE_SERVER_RELAY;
}

function canUseVoiceInput() {
  return voiceState.config?.enabled !== false
    && !(typeof shareSnapshotMode !== "undefined" && shareSnapshotMode)
    && (supportsBrowserDirectVoiceInput() || canUseServerRelayVoiceInput());
}

function syncVoiceInputButton() {
  if (!voiceInputBtn) return;
  const browserAvailable = supportsBrowserDirectVoiceInput();
  const relayAvailable = canUseServerRelayVoiceInput();
  const captureMode = resolveVoiceCaptureMode();
  const disabled = voiceState.busy
    || (!voiceState.recording && !canUseVoiceInput());
  voiceInputBtn.disabled = !!disabled;
  voiceInputBtn.classList.toggle("is-recording", voiceState.recording);
  voiceInputBtn.classList.toggle("is-busy", voiceState.busy && !voiceState.recording);
  voiceInputBtn.setAttribute("aria-pressed", voiceState.recording ? "true" : "false");
  if (voiceState.recording) {
    voiceInputBtn.title = "结束录音";
    voiceInputBtn.setAttribute("aria-label", "结束录音");
    return;
  }
  if (voiceState.busy) {
    voiceInputBtn.title = "正在转写语音";
    voiceInputBtn.setAttribute("aria-label", "正在转写语音");
    return;
  }
  if (voiceState.config?.enabled === false) {
    voiceInputBtn.title = "设置里已关闭语音输入";
    voiceInputBtn.setAttribute("aria-label", voiceInputBtn.title);
    return;
  }
  if (browserAvailable || relayAvailable) {
    voiceInputBtn.title = captureMode === VOICE_CAPTURE_MODE_BROWSER_DIRECT
      ? "在浏览器内录音"
      : "开始录音";
    voiceInputBtn.setAttribute("aria-label", voiceInputBtn.title);
    return;
  }
  if (!voiceState.config?.configured) {
    voiceInputBtn.title = isOwnerView()
      ? "请先配置 relay 语音输入，或改用自带语音识别的浏览器"
      : "语音输入当前不可用";
    voiceInputBtn.setAttribute("aria-label", voiceInputBtn.title);
    return;
  }
  voiceInputBtn.title = "开始录音";
  voiceInputBtn.setAttribute("aria-label", "开始录音");
}

function stopVoiceInputClock() {
  cancelInterval?.(voiceState.timerId);
  voiceState.timerId = 0;
}

function startVoiceInputClock() {
  stopVoiceInputClock();
  voiceState.startedAt = Date.now();
  setVoiceInputStatus(`录音中…再次点击即可结束 · ${formatRecordingDuration(0)}`, { persist: true });
  voiceState.timerId = scheduleInterval?.(() => {
    if (!voiceState.recording || !voiceState.startedAt) return;
    setVoiceInputStatus(
      `录音中…再次点击即可结束 · ${formatRecordingDuration(Date.now() - voiceState.startedAt)}`,
      { persist: true },
    );
  }, 400);
}

function stopVoiceTracks() {
  if (!voiceState.stream) return;
  for (const track of voiceState.stream.getTracks()) {
    track.stop();
  }
  voiceState.stream = null;
}

function resetVoiceRecorderState() {
  stopVoiceInputClock();
  stopVoiceTracks();
  voiceState.recording = false;
  voiceState.recorder = null;
  voiceState.chunks = [];
  voiceState.startedAt = 0;
  syncVoiceInputButton();
}

function deriveVoiceFileExtension(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  return "webm";
}

function buildRecordedAudioFile(blob) {
  const mimeType = blob?.type || "audio/webm";
  const extension = deriveVoiceFileExtension(mimeType);
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const filename = `voice-${timestamp}.${extension}`;
  if (typeof File === "function") {
    return new File([blob], filename, { type: mimeType });
  }
  const fallback = new Blob([blob], { type: mimeType });
  fallback.name = filename;
  return fallback;
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
  ];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

async function insertVoiceTranscriptIntoComposer(transcript) {
  const normalized = typeof transcript === "string" ? transcript.trim() : "";
  if (!normalized) return false;
  const currentValue = typeof msgInput.value === "string" ? msgInput.value : "";
  const nextValue = currentValue.trim()
    ? `${currentValue.replace(/\s+$/, "")}\n${normalized}`
    : normalized;
  msgInput.value = nextValue;
  msgInput.dispatchEvent(new Event("input", { bubbles: true }));
  if (typeof focusComposer === "function") {
    focusComposer({ force: true, preventScroll: true });
  } else {
    msgInput.focus();
  }
  return !currentValue.trim();
}

function queueVoiceAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;
  pendingImages.push({
    filename: attachment.filename,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
  });
  if (typeof renderImagePreviews === "function") {
    renderImagePreviews();
  }
  return true;
}

function normalizeBrowserDirectTranscript(parts = []) {
  return parts
    .map((part) => (typeof part === "string" ? part : ""))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function buildBrowserDirectPreviewText(state, { includeInterim = true } = {}) {
  if (!state || typeof state !== "object") return "";
  return normalizeBrowserDirectTranscript([
    state.committedTranscript,
    state.sessionFinalTranscript,
    includeInterim ? state.sessionInterimTranscript : "",
  ]);
}

function mapBrowserDirectRecognitionError(code = "") {
  switch (String(code || "")) {
    case "not-allowed":
      return "浏览器没有拿到麦克风权限。";
    case "service-not-allowed":
      return "当前浏览器不允许直接语音识别服务。";
    case "audio-capture":
      return "当前浏览器拿不到可用的麦克风。";
    case "network":
      return "浏览器直连语音识别网络失败。";
    case "language-not-supported":
      return "当前浏览器不支持这个语音识别语言。";
    default:
      return "";
  }
}

function finalizeBrowserDirectRecognition(state, options = {}) {
  if (!state || state.finalized) return;
  state.finalized = true;
  cancelTimeout?.(state.restartTimerId);
  appendVoiceDiagnostic("浏览器直跑识别已收尾", {
    transcriptLength: buildBrowserDirectPreviewText(state, {
      includeInterim: options.includeInterim !== false,
    }).length,
    streamFailed: options.streamFailed === true,
    error: typeof options.error === "string" ? options.error : "",
  });
  state.resolveFinal?.({
    transcript: buildBrowserDirectPreviewText(state, {
      includeInterim: options.includeInterim !== false,
    }),
    streamFailed: options.streamFailed === true,
    error: typeof options.error === "string" ? options.error : "",
    mode: VOICE_CAPTURE_MODE_BROWSER_DIRECT,
  });
}

async function cleanupBrowserDirectRecognition() {
  const state = voiceState.browserRecognition;
  voiceState.browserRecognition = null;
  if (!state) return;
  appendVoiceDiagnostic("浏览器直跑识别已清理", {
    finalized: state.finalized === true,
    stopRequested: state.stopRequested === true,
  });
  cancelTimeout?.(state.restartTimerId);
  const recognition = state.recognition;
  if (!recognition) return;
  try {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  } catch {}
}

async function startBrowserDirectRecognition() {
  if (!supportsBrowserDirectVoiceInput()) {
    throw new Error("当前浏览器不支持前端直跑语音识别。",
    );
  }
  const recognition = new SpeechRecognitionCtor();
  const state = {
    recognition,
    committedTranscript: "",
    sessionFinalTranscript: "",
    sessionInterimTranscript: "",
    stopRequested: false,
    finalized: false,
    restartTimerId: 0,
    lastError: "",
    finalPromise: null,
    resolveFinal: null,
  };
  state.finalPromise = new Promise((resolve) => {
    state.resolveFinal = resolve;
  });
  voiceState.browserRecognition = state;
  appendVoiceDiagnostic("请求启动浏览器直跑识别", {
    language: voiceState.config?.language || "zh-CN",
    requestedMode: readVoiceInputPrefs().captureMode,
  });

  recognition.lang = voiceState.config?.language || "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    appendVoiceDiagnostic("浏览器直跑识别已启动", {
      language: recognition.lang,
      continuous: recognition.continuous,
      interimResults: recognition.interimResults,
    });
  };

  recognition.onaudiostart = () => {
    appendVoiceDiagnostic("浏览器直跑音频采集开始");
  };

  recognition.onspeechstart = () => {
    appendVoiceDiagnostic("浏览器直跑检测到语音开始");
  };

  recognition.onspeechend = () => {
    appendVoiceDiagnostic("浏览器直跑检测到语音结束");
  };

  recognition.onaudioend = () => {
    appendVoiceDiagnostic("浏览器直跑音频采集结束");
  };

  recognition.onnomatch = () => {
    appendVoiceDiagnostic("浏览器直跑未匹配到语音");
  };

  recognition.onresult = (event) => {
    const sessionFinal = [];
    const sessionInterim = [];
    for (const result of Array.from(event?.results || [])) {
      const text = typeof result?.[0]?.transcript === "string" ? result[0].transcript : "";
      if (!text) continue;
      if (result.isFinal) {
        sessionFinal.push(text);
      } else {
        sessionInterim.push(text);
      }
    }
    state.sessionFinalTranscript = normalizeBrowserDirectTranscript(sessionFinal);
    state.sessionInterimTranscript = normalizeBrowserDirectTranscript(sessionInterim);
    updateVoiceComposerPreview(buildBrowserDirectPreviewText(state));
    appendVoiceDiagnostic("浏览器直跑识别结果", {
      finalLength: state.sessionFinalTranscript.length,
      interimLength: state.sessionInterimTranscript.length,
      preview: buildBrowserDirectPreviewText(state).slice(0, 120),
    });
  };

  recognition.onerror = (event) => {
    const message = mapBrowserDirectRecognitionError(event?.error);
    appendVoiceDiagnostic("浏览器直跑识别报错", {
      code: event?.error || "",
      message,
      transcriptLength: buildBrowserDirectPreviewText(state).length,
    });
    if (message) {
      state.lastError = message;
    }
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(String(event?.error || ""))) {
      state.stopRequested = true;
    }
  };

  recognition.onend = () => {
    state.committedTranscript = normalizeBrowserDirectTranscript([
      state.committedTranscript,
      state.sessionFinalTranscript,
    ]);
    state.sessionFinalTranscript = "";
    appendVoiceDiagnostic("浏览器直跑识别已结束", {
      stopRequested: state.stopRequested === true,
      committedLength: state.committedTranscript.length,
      interimLength: state.sessionInterimTranscript.length,
      lastError: state.lastError,
    });

    if (state.stopRequested || !voiceState.recording) {
      finalizeBrowserDirectRecognition(state, {
        streamFailed: !buildBrowserDirectPreviewText(state) && !!state.lastError,
        error: state.lastError,
        includeInterim: true,
      });
      return;
    }

    state.sessionInterimTranscript = "";
    state.restartTimerId = scheduleTimeout?.(() => {
      try {
        appendVoiceDiagnostic("浏览器直跑识别准备重启");
        recognition.start();
      } catch (error) {
        state.lastError = error?.message || "浏览器语音识别重启失败。";
        appendVoiceDiagnostic("浏览器直跑识别重启失败", {
          error: state.lastError,
        });
        state.stopRequested = true;
        finalizeBrowserDirectRecognition(state, {
          streamFailed: !buildBrowserDirectPreviewText(state),
          error: state.lastError,
          includeInterim: true,
        });
      }
    }, 140);
  };

  try {
    recognition.start();
  } catch (error) {
    appendVoiceDiagnostic("启动浏览器直跑识别时抛错", {
      error: error?.message || String(error || ""),
    });
    throw error;
  }
  return state;
}

function requestBrowserDirectRecognitionStop() {
  const state = voiceState.browserRecognition;
  if (!state) return;
  state.stopRequested = true;
  appendVoiceDiagnostic("请求停止浏览器直跑识别", {
    transcriptLength: buildBrowserDirectPreviewText(state, { includeInterim: true }).length,
  });
  cancelTimeout?.(state.restartTimerId);
  try {
    state.recognition.stop();
  } catch {
    finalizeBrowserDirectRecognition(state, {
      streamFailed: false,
      includeInterim: true,
    });
  }
}

async function waitForBrowserDirectRecognitionResult(timeoutMs = 2200) {
  const state = voiceState.browserRecognition;
  if (!state?.finalPromise) {
    return { transcript: "", streamFailed: true, skipped: "not_started" };
  }
  try {
    return await Promise.race([
      state.finalPromise,
      new Promise((resolve) => {
        scheduleTimeout?.(() => {
          appendVoiceDiagnostic("等待浏览器直跑结果超时", {
            timeoutMs,
            transcriptLength: buildVoiceComposerValue("", buildBrowserDirectPreviewText(state, { includeInterim: true })).length,
          });
          resolve({
            transcript: buildBrowserDirectPreviewText(state, { includeInterim: true }),
            streamFailed: true,
            timedOut: true,
            error: state.lastError || "",
            mode: VOICE_CAPTURE_MODE_BROWSER_DIRECT,
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    await cleanupBrowserDirectRecognition();
  }
}

function disconnectLiveVoiceAudio(live) {
  if (!live || live.audioDisconnected) return;
  live.audioDisconnected = true;
  try { live.processorNode && (live.processorNode.onaudioprocess = null); } catch {}
  try { live.sourceNode?.disconnect(); } catch {}
  try { live.processorNode?.disconnect(); } catch {}
  try { live.gainNode?.disconnect(); } catch {}
}

async function cleanupLiveVoicePreview() {
  const live = voiceState.live;
  voiceState.live = null;
  if (!live) return;
  appendVoiceDiagnostic("服务器 relay 实时预览已清理", {
    finalized: live.finalized === true,
    stopRequested: live.stopRequested === true,
  });
  disconnectLiveVoiceAudio(live);
  try {
    if (live.audioContext && live.audioContext.state !== "closed") {
      await live.audioContext.close();
    }
  } catch {}
  try {
    if (live.socket && live.socket.readyState === WebSocket.OPEN) {
      live.socket.close();
    }
  } catch {}
}

async function startLiveVoicePreview(stream) {
  if (!stream || !currentSessionId || typeof WebSocket === "undefined") {
    return null;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (typeof AudioContextCtor !== "function") {
    return null;
  }

  const live = {
    socket: null,
    audioContext: null,
    sourceNode: null,
    processorNode: null,
    gainNode: null,
    canSendAudio: false,
    pendingChunks: [],
    latestTranscript: "",
    finalized: false,
    stopRequested: false,
    audioDisconnected: false,
    finalPromise: null,
    resolveFinal: null,
  };
  live.finalPromise = new Promise((resolve) => {
    live.resolveFinal = resolve;
  });

  const audioContext = new AudioContextCtor();
  voiceState.live = live;
  live.audioContext = audioContext;
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch {}
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(2048, 1, 1);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;
  live.sourceNode = sourceNode;
  live.processorNode = processorNode;
  live.gainNode = gainNode;
  sourceNode.connect(processorNode);
  processorNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const socket = new WebSocket(resolveVoiceInputWsUrl(currentSessionId));
  live.socket = socket;
  appendVoiceDiagnostic("请求启动服务器 relay 实时预览", {
    sessionId: currentSessionId,
    language: voiceState.config?.language || "",
  });

  const flushPendingChunks = () => {
    if (!live.canSendAudio || !live.socket || live.socket.readyState !== WebSocket.OPEN) return;
    while (live.pendingChunks.length > 0) {
      live.socket.send(live.pendingChunks.shift());
    }
  };

  processorNode.onaudioprocess = (event) => {
    if (!voiceState.recording || live.stopRequested) return;
    const channelData = event?.inputBuffer?.getChannelData?.(0);
    if (!channelData?.length) return;
    const pcmChunk = downsampleVoiceBuffer(channelData, audioContext.sampleRate, 16000);
    if (!pcmChunk.length) return;
    const payload = cloneArrayBuffer(pcmChunk);
    if (!live.canSendAudio || !live.socket || live.socket.readyState !== WebSocket.OPEN) {
      if (live.pendingChunks.length < 24) {
        live.pendingChunks.push(payload);
      }
      return;
    }
    live.socket.send(payload);
  };

  socket.addEventListener("open", () => {
    appendVoiceDiagnostic("服务器 relay WebSocket 已连接");
    socket.send(JSON.stringify({
      type: "start",
      sessionId: currentSessionId,
      language: voiceState.config?.language || "",
    }));
  });

  socket.addEventListener("message", (event) => {
    let payload = null;
    try {
      payload = JSON.parse(String(event?.data || ""));
    } catch {
      return;
    }
    if (payload?.type === "started") {
      live.canSendAudio = true;
      flushPendingChunks();
      appendVoiceDiagnostic("服务器 relay 实时预览已启动");
      return;
    }
    if (payload?.type === "partial") {
      live.latestTranscript = typeof payload.transcript === "string" ? payload.transcript.trim() : live.latestTranscript;
      updateVoiceComposerPreview(live.latestTranscript || "");
      if (!live.loggedFirstPartial && live.latestTranscript) {
        live.loggedFirstPartial = true;
        appendVoiceDiagnostic("服务器 relay 收到首条中间结果", {
          transcriptLength: live.latestTranscript.length,
          preview: live.latestTranscript.slice(0, 120),
        });
      }
      return;
    }
    if (payload?.type === "final") {
      const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : live.latestTranscript;
      live.latestTranscript = transcript || live.latestTranscript;
      live.finalized = true;
      updateVoiceComposerPreview(live.latestTranscript || "");
      appendVoiceDiagnostic("服务器 relay 返回最终转写", {
        transcriptLength: live.latestTranscript.length,
        preview: live.latestTranscript.slice(0, 120),
      });
      live.resolveFinal({ transcript: live.latestTranscript || "", streamFailed: false });
      return;
    }
    if (payload?.type === "error") {
      live.canSendAudio = false;
      live.stopRequested = true;
      disconnectLiveVoiceAudio(live);
      appendVoiceDiagnostic("服务器 relay 返回错误", {
        error: payload.error || "",
      });
      setVoiceInputStatus(payload.error || "实时字幕暂时不可用，结束后会回退到普通转写。", { error: true });
      live.resolveFinal({ transcript: live.latestTranscript || "", streamFailed: true, error: payload.error || "" });
    }
  });

  socket.addEventListener("close", () => {
    if (live.finalized) return;
    appendVoiceDiagnostic("服务器 relay 在最终结果前断开连接", {
      transcriptLength: live.latestTranscript.length,
    });
    live.resolveFinal({ transcript: live.latestTranscript || "", streamFailed: true });
  });

  socket.addEventListener("error", () => {
    if (live.finalized) return;
    appendVoiceDiagnostic("服务器 relay WebSocket 出错");
    live.resolveFinal({ transcript: live.latestTranscript || "", streamFailed: true, error: "实时字幕连接失败。" });
  });

  return live;
}

function requestLiveVoicePreviewStop() {
  const live = voiceState.live;
  if (!live) return;
  live.stopRequested = true;
  appendVoiceDiagnostic("请求停止服务器 relay 实时预览", {
    transcriptLength: live.latestTranscript.length,
  });
  disconnectLiveVoiceAudio(live);
  if (live.socket && live.socket.readyState === WebSocket.OPEN) {
    live.socket.send(JSON.stringify({ type: "stop" }));
  }
}

async function waitForLiveVoicePreviewResult(timeoutMs = 3200) {
  const live = voiceState.live;
  if (!live?.finalPromise) {
    return { transcript: "", streamFailed: true, skipped: "not_started" };
  }
  try {
    return await Promise.race([
      live.finalPromise,
      new Promise((resolve) => {
        scheduleTimeout?.(() => {
          appendVoiceDiagnostic("等待服务器 relay 结果超时", {
            timeoutMs,
            transcriptLength: live.latestTranscript.length,
          });
          resolve({ transcript: live.latestTranscript || "", streamFailed: true, timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    await cleanupLiveVoicePreview();
  }
}

async function submitVoiceAudio(file, options = {}) {
  if (!currentSessionId) {
    appendVoiceDiagnostic("跳过语音提交：当前没有会话", {
      hasFile: !!file,
      providedTranscriptLength: typeof options?.providedTranscript === "string" ? options.providedTranscript.trim().length : 0,
    });
    setVoiceInputStatus("先打开一个会话，再发语音。", { error: true });
    return;
  }
  if (typeof hasPendingComposerSend === "function" && hasPendingComposerSend()) {
    appendVoiceDiagnostic("跳过语音提交：输入框消息仍在发送",);
    setVoiceInputStatus("当前消息还在发送中，等它结束后再录。", { error: true });
    return;
  }
  const prefs = readVoiceInputPrefs();
  const providedTranscript = typeof options?.providedTranscript === "string"
    ? options.providedTranscript.trim()
    : "";
  const shouldUploadAudio = !!file && (prefs.attachOriginalAudio || !providedTranscript);
  if (!shouldUploadAudio && !providedTranscript) {
    appendVoiceDiagnostic("跳过语音提交：没有可发送内容", {
      attachOriginalAudio: prefs.attachOriginalAudio === true,
      hasFile: !!file,
    });
    clearVoiceComposerPreview();
    setVoiceInputStatus("这次没有录到可发送的内容。", { error: true });
    return;
  }
  appendVoiceDiagnostic("开始提交语音转写", {
    shouldUploadAudio,
    fileName: file?.name || "",
    fileType: file?.type || "",
    fileSize: typeof file?.size === "number" ? file.size : 0,
    providedTranscriptLength: providedTranscript.length,
    attachOriginalAudio: prefs.attachOriginalAudio === true,
    rewriteWithContext: prefs.rewriteWithContext === true,
    autoSend: prefs.autoSend === true,
  });
  voiceState.busy = true;
  syncVoiceInputButton();
  setVoiceInputStatus(providedTranscript ? "正在整理语音…" : "正在转写语音…", { persist: true });
  try {
    const requestPath = `/api/sessions/${encodeURIComponent(currentSessionId)}/voice-transcriptions`;
    const data = shouldUploadAudio
      ? await (async () => {
          const formData = new FormData();
          formData.set("audio", file, file?.name || "voice-input");
          if (voiceState.config?.language) formData.set("language", voiceState.config.language);
          formData.set("persistAudio", prefs.attachOriginalAudio ? "true" : "false");
          formData.set("rewriteWithContext", prefs.rewriteWithContext ? "true" : "false");
          if (providedTranscript) {
            formData.set("providedTranscript", providedTranscript);
          }
          return fetchJsonOrRedirect(requestPath, {
            method: "POST",
            body: formData,
          });
        })()
      : await fetchJsonOrRedirect(requestPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: voiceState.config?.language || "",
            persistAudio: false,
            rewriteWithContext: prefs.rewriteWithContext === true,
            providedTranscript,
          }),
        });
    if (prefs.attachOriginalAudio && data?.attachment) {
      queueVoiceAttachment(data.attachment);
    }
    const finalTranscript = typeof data?.transcript === "string" && data.transcript.trim()
      ? data.transcript.trim()
      : providedTranscript;
    const insertedIntoEmptyComposer = finishVoiceComposerPreview(finalTranscript, { keepLiveText: !finalTranscript });
    const committedTranscript = typeof msgInput.value === "string" ? msgInput.value.trim() : "";
    appendVoiceDiagnostic("语音提交完成", {
      finalTranscriptLength: finalTranscript.length,
      rewriteApplied: data?.rewriteApplied === true,
      attachedAudio: !!data?.attachment,
      insertedIntoEmptyComposer,
      committedTranscriptLength: committedTranscript.length,
    });
    if (prefs.autoSend && insertedIntoEmptyComposer && committedTranscript && typeof sendMessage === "function") {
      appendVoiceDiagnostic("语音提交后触发自动发送", {
        committedTranscriptLength: committedTranscript.length,
      });
      setVoiceInputStatus(data?.rewriteApplied ? "已结合基础记忆清洗，正在发送…" : "已转写，正在发送…", { persist: true });
      sendMessage();
      return;
    }
    if (committedTranscript) {
      setVoiceInputStatus(
        data?.rewriteApplied
          ? (prefs.attachOriginalAudio && data?.attachment
            ? "已结合基础记忆清洗并附上原音频，可直接发送或先改字。"
            : "已结合基础记忆清洗后放进输入框，可直接发送或先改字。")
          : (prefs.attachOriginalAudio && data?.attachment
            ? "已转写并附上原音频，可直接发送或先改字。"
            : "已转写到输入框，可直接发送或先改字。"),
      );
      return;
    }
    if (prefs.attachOriginalAudio && data?.attachment) {
      setVoiceInputStatus("原音频已附上，但这次没有识别出文本。可以手动补一句再发。", { persist: true });
      if (typeof focusComposer === "function") {
        focusComposer({ force: true, preventScroll: true });
      }
      return;
    }
    setVoiceInputStatus("这次没有识别出文本。再试一遍或者直接手动输入。", { error: true });
  } catch (error) {
    const fallbackTranscript = providedTranscript || voiceState.composerPreview?.transcript || "";
    appendVoiceDiagnostic("语音提交失败", {
      error: error?.message || "",
      fallbackTranscriptLength: fallbackTranscript.length,
    });
    if (fallbackTranscript || voiceState.composerPreview) {
      finishVoiceComposerPreview(fallbackTranscript, { keepLiveText: !fallbackTranscript });
    }
    setVoiceInputStatus(error?.message || "语音转写失败了，再试一次。", { error: true });
  } finally {
    voiceState.busy = false;
    syncVoiceInputButton();
  }
}

async function startServerRelayVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    appendVoiceDiagnostic("当前浏览器无法使用服务器 relay 录音", {
      hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
      hasMediaRecorder: typeof MediaRecorder !== "undefined",
    });
    voiceFileInput?.click();
    return;
  }
  try {
    appendVoiceDiagnostic("开始服务器 relay 录音", {
      language: voiceState.config?.language || "",
    });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const audioTrackCount = typeof stream?.getAudioTracks === "function"
      ? stream.getAudioTracks().length
      : 0;
    appendVoiceDiagnostic("服务器 relay 已拿到麦克风权限", {
      audioTrackCount,
      mimeType: mimeType || recorder.mimeType || "default",
    });
    voiceState.stream = stream;
    voiceState.recorder = recorder;
    voiceState.chunks = [];
    let loggedFirstChunk = false;
    recorder.addEventListener("dataavailable", (event) => {
      if (event?.data && event.data.size > 0) {
        voiceState.chunks.push(event.data);
        if (!loggedFirstChunk) {
          loggedFirstChunk = true;
          appendVoiceDiagnostic("服务器 relay 收到首个音频分片", {
            chunkSize: event.data.size,
            chunkType: event.data.type || recorder.mimeType || mimeType || "",
          });
        }
      }
    });
    recorder.addEventListener("stop", async () => {
      const chunks = voiceState.chunks.slice();
      const resolvedType = recorder.mimeType || mimeType || "audio/webm";
      const liveResult = await waitForLiveVoicePreviewResult();
      resetVoiceRecorderState();
      const providedTranscript = typeof liveResult?.transcript === "string" ? liveResult.transcript.trim() : "";
      appendVoiceDiagnostic("服务器 relay 录音已停止", {
        chunkCount: chunks.length,
        resolvedType,
        providedTranscriptLength: providedTranscript.length,
        streamFailed: liveResult?.streamFailed === true,
        timedOut: liveResult?.timedOut === true,
      });
      if (chunks.length === 0 && !providedTranscript) {
        appendVoiceDiagnostic("服务器 relay 停止后没有产生有效内容");
        clearVoiceComposerPreview();
        setVoiceInputStatus("没有录到有效音频，再试一次。", { error: true });
        return;
      }
      const recordedFile = chunks.length > 0
        ? buildRecordedAudioFile(new Blob(chunks, { type: resolvedType }))
        : null;
      await submitVoiceAudio(recordedFile, {
        providedTranscript,
      });
    }, { once: true });
    recorder.start();
    appendVoiceDiagnostic("服务器 relay 录音已开始", {
      mimeType: recorder.mimeType || mimeType || "default",
    });
    startVoiceComposerPreview();
    voiceState.recording = true;
    syncVoiceInputButton();
    startVoiceInputClock();
    try {
      await startLiveVoicePreview(stream);
    } catch (error) {
      appendVoiceDiagnostic("服务器 relay 实时预览启动失败", {
        error: error?.message || "",
      });
      setVoiceInputStatus("实时字幕暂时不可用，结束后会回退到普通转写。", { error: true });
    }
  } catch (error) {
    appendVoiceDiagnostic("服务器 relay 请求麦克风失败", {
      error: error?.message || "",
      name: error?.name || "",
    });
    await cleanupLiveVoicePreview();
    clearVoiceComposerPreview();
    resetVoiceRecorderState();
    setVoiceInputStatus("麦克风不可用，改用系统文件选择。", { error: true });
    voiceFileInput?.click();
  }
}

async function startBrowserDirectVoiceRecording() {
  appendVoiceDiagnostic("开始浏览器直跑录音", {
    language: voiceState.config?.language || "zh-CN",
  });
  startVoiceComposerPreview();
  voiceState.recording = true;
  syncVoiceInputButton();
  startVoiceInputClock();
  try {
    await startBrowserDirectRecognition();
    appendVoiceDiagnostic("浏览器直跑录音进行中");
  } catch (error) {
    appendVoiceDiagnostic("浏览器直跑录音启动失败", {
      error: error?.message || "",
    });
    await cleanupBrowserDirectRecognition();
    clearVoiceComposerPreview();
    resetVoiceRecorderState();
    throw error;
  }
}

async function stopVoiceRecording() {
  appendVoiceDiagnostic("请求停止录音", {
    browserDirect: !!voiceState.browserRecognition,
    relayRecorderState: voiceState.recorder?.state || "",
  });
  if (voiceState.browserRecognition) {
    requestBrowserDirectRecognitionStop();
    setVoiceInputStatus("正在结束录音…", { persist: true });
    const liveResult = await waitForBrowserDirectRecognitionResult();
    resetVoiceRecorderState();
    const providedTranscript = typeof liveResult?.transcript === "string" ? liveResult.transcript.trim() : "";
    appendVoiceDiagnostic("浏览器直跑停止流程完成", {
      providedTranscriptLength: providedTranscript.length,
      streamFailed: liveResult?.streamFailed === true,
      timedOut: liveResult?.timedOut === true,
      error: liveResult?.error || "",
    });
    if (!providedTranscript) {
      clearVoiceComposerPreview();
      setVoiceInputStatus(liveResult?.error || "这次没有识别出文本。", { error: true });
      return;
    }
    await submitVoiceAudio(null, { providedTranscript });
    return;
  }

  if (!voiceState.recorder || voiceState.recorder.state === "inactive") return;
  requestLiveVoicePreviewStop();
  setVoiceInputStatus("正在结束录音…", { persist: true });
  appendVoiceDiagnostic("正在停止服务器 relay 录音", {
    pendingChunks: voiceState.chunks.length,
  });
  voiceState.recorder.stop();
}

async function startVoiceRecording() {
  appendVoiceDiagnostic("请求开始录音", {
    requestedMode: readVoiceInputPrefs().captureMode,
    resolvedMode: resolveVoiceCaptureMode(),
    browserDirectSupported: supportsBrowserDirectVoiceInput(),
    relayConfigured: canUseServerRelayVoiceInput(),
    hasSession: !!currentSessionId,
  });
  if (!canUseVoiceInput()) {
    appendVoiceDiagnostic("语音输入不可用", {
      browserDirectSupported: supportsBrowserDirectVoiceInput(),
      relayConfigured: canUseServerRelayVoiceInput(),
      shareSnapshotMode: typeof shareSnapshotMode !== "undefined" && !!shareSnapshotMode,
    });
    if (isOwnerView() && typeof switchTab === "function") {
      switchTab("settings");
      setVoiceInputStatus("先在 Settings 里开语音，或者换成支持浏览器直跑语音识别的浏览器。", { error: true });
      return;
    }
    setVoiceInputStatus("语音输入当前不可用。", { error: true });
    return;
  }
  if (!currentSessionId) {
    appendVoiceDiagnostic("无法开始录音：当前没有会话");
    setVoiceInputStatus("先打开一个会话，再开始录音。", { error: true });
    return;
  }

  const captureMode = resolveVoiceCaptureMode();
  if (captureMode === VOICE_CAPTURE_MODE_BROWSER_DIRECT && supportsBrowserDirectVoiceInput()) {
    try {
      await startBrowserDirectVoiceRecording();
      return;
    } catch (error) {
      appendVoiceDiagnostic("浏览器直跑启动失败", {
        error: error?.message || "",
        willFallbackToRelay: canUseServerRelayVoiceInput(),
      });
      if (canUseServerRelayVoiceInput()) {
        setVoiceInputStatus(error?.message || "浏览器直跑失败，回退到服务器 relay。", { error: true });
        await startServerRelayVoiceRecording();
        return;
      }
      setVoiceInputStatus(error?.message || "浏览器直跑语音识别启动失败。", { error: true });
      return;
    }
  }

  appendVoiceDiagnostic("录音请求已切到服务器 relay");
  await startServerRelayVoiceRecording();
}

async function handleVoiceInputClick() {
  appendVoiceDiagnostic("点击了语音输入按钮", {
    busy: voiceState.busy === true,
    recording: voiceState.recording === true,
    requestedMode: readVoiceInputPrefs().captureMode,
    resolvedMode: resolveVoiceCaptureMode(),
  });
  if (voiceState.busy) {
    appendVoiceDiagnostic("忽略语音按钮点击：当前正忙");
    return;
  }
  if (voiceState.recording) {
    await stopVoiceRecording();
    return;
  }
  await startVoiceRecording();
}

async function loadVoiceInputConfig() {
  ensureVoiceDiagnosticsBootstrapped();
  if (typeof fetchJsonOrRedirect !== "function") {
    appendVoiceDiagnostic("跳过加载语音配置：fetch 不可用");
    return voiceState.config;
  }
  if (voiceState.loadingConfig) return voiceState.config;
  appendVoiceDiagnostic("正在加载语音输入配置");
  voiceState.loadingConfig = true;
  syncVoiceInputButton();
  try {
    const data = await fetchJsonOrRedirect("/api/voice-input/config");
    voiceState.config = data?.config || null;
    appendVoiceDiagnostic("已加载语音输入配置", {
      enabled: voiceState.config?.enabled !== false,
      configured: voiceState.config?.configured === true,
      providerLabel: voiceState.config?.providerLabel || "",
      language: voiceState.config?.language || "",
    });
  } catch (error) {
    appendVoiceDiagnostic("加载语音配置失败", {
      error: error?.message || "",
    });
    voiceState.config = null;
  } finally {
    voiceState.loadingConfig = false;
    syncVoiceInputButton();
    renderVoiceInputSettings();
  }
  return voiceState.config;
}

function createVoiceSettingsCheckbox(labelText, checked) {
  const chip = document.createElement("label");
  chip.className = "settings-app-chip";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  const text = document.createElement("span");
  text.textContent = labelText;
  chip.appendChild(input);
  chip.appendChild(text);
  return { chip, input };
}

function renderVoiceInputSettings() {
  if (!voiceSettingsMount) return;
  voiceState.diagnosticsSummaryEl = null;
  voiceState.diagnosticsTextEl = null;
  voiceSettingsMount.innerHTML = "";
  if (!isOwnerView()) return;

  const prefs = readVoiceInputPrefs();
  const config = voiceState.config || {};
  const captureMode = resolveVoiceCaptureMode(prefs);
  const browserDirectSupported = supportsBrowserDirectVoiceInput();

  const title = document.createElement("div");
  title.className = "settings-section-title";
  title.textContent = "语音输入";

  const note = document.createElement("div");
  note.className = "settings-section-note";
  note.textContent = "服务端中继会让语音识别走 Cue 已配置的 ASR 路径，并支持可选的原始音频附件。浏览器直连则是一个更快的可选模式，适合你明确想使用浏览器原生识别器时启用。";

  const form = document.createElement("div");
  form.className = "settings-inline-form";

  const enableRow = document.createElement("div");
  enableRow.className = "settings-app-picker-grid";
  const enabledControl = createVoiceSettingsCheckbox("启用语音输入", config.enabled !== false);
  const attachControl = createVoiceSettingsCheckbox("默认附带原始音频（仅服务端中继）", prefs.attachOriginalAudio !== false);
  const autoSendControl = createVoiceSettingsCheckbox("转写结果落入空白输入框时自动发送", prefs.autoSend === true);
  const rewriteControl = createVoiceSettingsCheckbox("使用持久协作记忆润色转写结果", prefs.rewriteWithContext !== false);
  if (captureMode === VOICE_CAPTURE_MODE_BROWSER_DIRECT) {
    attachControl.input.disabled = true;
    attachControl.chip.title = "浏览器直连模式当前只发送文本。如果你想保留原始音频附件，请切换到服务端中继。";
  }
  enableRow.appendChild(enabledControl.chip);
  enableRow.appendChild(attachControl.chip);
  enableRow.appendChild(autoSendControl.chip);
  enableRow.appendChild(rewriteControl.chip);

  const modeInput = document.createElement("select");
  modeInput.className = "settings-inline-input";
  const browserModeOption = document.createElement("option");
  browserModeOption.value = VOICE_CAPTURE_MODE_BROWSER_DIRECT;
  browserModeOption.textContent = browserDirectSupported
    ? "浏览器直连（可选，最快）"
    : "浏览器直连（当前浏览器不支持）";
  const relayModeOption = document.createElement("option");
  relayModeOption.value = VOICE_CAPTURE_MODE_SERVER_RELAY;
  relayModeOption.textContent = "服务端中继（推荐）";
  modeInput.appendChild(browserModeOption);
  modeInput.appendChild(relayModeOption);
  modeInput.value = normalizeVoiceCaptureMode(prefs.captureMode);

  const appIdInput = document.createElement("input");
  appIdInput.className = "settings-inline-input";
  appIdInput.type = "text";
  appIdInput.placeholder = "火山引擎 App ID";
  appIdInput.value = config.appId || "";

  const accessKeyInput = document.createElement("input");
  accessKeyInput.className = "settings-inline-input";
  accessKeyInput.type = "password";
  accessKeyInput.placeholder = config.hasAccessKey ? "Access Key 已配置，留空则保持不变" : "火山引擎 Access Key";

  const resourceIdInput = document.createElement("input");
  resourceIdInput.className = "settings-inline-input";
  resourceIdInput.type = "text";
  resourceIdInput.placeholder = "资源 ID";
  resourceIdInput.value = config.resourceId || "";

  const endpointInput = document.createElement("input");
  endpointInput.className = "settings-inline-input";
  endpointInput.type = "text";
  endpointInput.placeholder = "语音 WebSocket 端点";
  endpointInput.value = config.endpoint || "";

  const streamEndpointInput = document.createElement("input");
  streamEndpointInput.className = "settings-inline-input";
  streamEndpointInput.type = "text";
  streamEndpointInput.placeholder = "实时字幕 WebSocket 端点";
  streamEndpointInput.value = config.streamEndpoint || "";

  const languageInput = document.createElement("input");
  languageInput.className = "settings-inline-input";
  languageInput.type = "text";
  languageInput.placeholder = "语言提示，例如 zh-CN";
  languageInput.value = config.language || "";

  const modelLabelInput = document.createElement("input");
  modelLabelInput.className = "settings-inline-input";
  modelLabelInput.type = "text";
  modelLabelInput.placeholder = "界面中显示的模型名称";
  modelLabelInput.value = config.modelLabel || "";

  const actionRow = document.createElement("div");
  actionRow.className = "settings-inline-row";

  const saveBtn = document.createElement("button");
  saveBtn.className = "settings-app-btn settings-inline-primary";
  saveBtn.type = "button";
  saveBtn.textContent = "保存语音设置";

  const status = document.createElement("div");
  status.className = "settings-app-empty inline-status";
  status.textContent = captureMode === VOICE_CAPTURE_MODE_BROWSER_DIRECT
    ? (browserDirectSupported
      ? "当前启用的是浏览器直连模式。你说话时的实时识别会留在当前浏览器中，停止后只会把最终转写结果发回 Cue。"
      : "当前浏览器没有提供可直接使用的语音识别 API，因此在可用时会自动回退到服务端中继。")
    : (config.configured
      ? `${config.providerLabel || "服务提供方"} 中继已启用。识别会通过 Cue 配置好的语音路径处理。当前模型：${config.modelLabel || "voice"}。`
      : "服务端中继尚未配置。如果你希望由 Cue 处理语音识别和音频上传，请在下方保存 provider 详情。");

  const diagnosticsSummary = document.createElement("div");
  diagnosticsSummary.className = "settings-app-empty voice-input-diagnostics-summary";

  const diagnosticsActions = document.createElement("div");
  diagnosticsActions.className = "settings-app-actions voice-input-diagnostics-actions";

  const copyDiagnosticsBtn = document.createElement("button");
  copyDiagnosticsBtn.className = "settings-app-btn";
  copyDiagnosticsBtn.type = "button";
  copyDiagnosticsBtn.textContent = "复制诊断信息";
  copyDiagnosticsBtn.addEventListener("click", async () => {
    try {
      await copyVoiceDiagnosticsToClipboard();
    } catch (error) {
      setVoiceInputStatus(error?.message || "复制语音诊断失败。", { error: true, persist: true });
    }
  });

  const clearDiagnosticsBtn = document.createElement("button");
  clearDiagnosticsBtn.className = "settings-app-btn";
  clearDiagnosticsBtn.type = "button";
  clearDiagnosticsBtn.textContent = "清空诊断信息";
  clearDiagnosticsBtn.addEventListener("click", () => {
    clearVoiceDiagnostics();
    setVoiceInputStatus("语音诊断日志已清空。", { persist: true });
  });

  diagnosticsActions.appendChild(copyDiagnosticsBtn);
  diagnosticsActions.appendChild(clearDiagnosticsBtn);

  const diagnosticsText = document.createElement("pre");
  diagnosticsText.className = "voice-input-diagnostics";
  diagnosticsText.textContent = "";

  saveBtn.addEventListener("click", async () => {
    const nextPrefs = writeVoiceInputPrefs({
      captureMode: modeInput.value,
      attachOriginalAudio: attachControl.input.checked,
      autoSend: autoSendControl.input.checked,
      rewriteWithContext: rewriteControl.input.checked,
    });
    appendVoiceDiagnostic("正在保存语音设置", {
      requestedMode: modeInput.value,
      enabled: enabledControl.input.checked,
      attachOriginalAudio: attachControl.input.checked,
      autoSend: autoSendControl.input.checked,
      rewriteWithContext: rewriteControl.input.checked,
      hasAppId: !!appIdInput.value.trim(),
      hasAccessKeyUpdate: !!accessKeyInput.value.trim(),
      hasEndpoint: !!endpointInput.value.trim(),
      hasStreamEndpoint: !!streamEndpointInput.value.trim(),
    });
    status.textContent = "正在保存…";
    saveBtn.disabled = true;
    try {
      const payload = {
        enabled: enabledControl.input.checked,
        appId: appIdInput.value.trim(),
        endpoint: endpointInput.value.trim(),
        streamEndpoint: streamEndpointInput.value.trim(),
        resourceId: resourceIdInput.value.trim(),
        language: languageInput.value.trim(),
        modelLabel: modelLabelInput.value.trim(),
      };
      if (accessKeyInput.value.trim()) {
        payload.accessKey = accessKeyInput.value.trim();
      }
      const data = await fetchJsonOrRedirect("/api/voice-input/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      voiceState.config = data?.config || voiceState.config;
      accessKeyInput.value = "";
      appendVoiceDiagnostic("语音设置已保存", {
        requestedMode: nextPrefs.captureMode,
        resolvedMode: resolveVoiceCaptureMode(nextPrefs),
        configured: voiceState.config?.configured === true,
      });
      status.textContent = normalizeVoiceCaptureMode(nextPrefs.captureMode) === VOICE_CAPTURE_MODE_BROWSER_DIRECT
        ? (browserDirectSupported
          ? "已保存。新的录音会先在当前浏览器中进行实时识别，然后只把最终转写结果发回进行整理。"
          : "已保存。虽然已选择浏览器直连模式，但在当前浏览器提供原生语音识别之前，仍会回退到服务端中继。")
        : "已保存。新的录音现在会使用服务端中继路径来生成实时字幕，并可选择附带原始音频。";
      syncVoiceInputButton();
      renderVoiceInputSettings();
    } catch (error) {
      appendVoiceDiagnostic("保存语音设置失败", {
        error: error?.message || "",
      });
      status.textContent = error?.message || "保存语音输入设置失败。";
    } finally {
      saveBtn.disabled = false;
    }
  });

  actionRow.appendChild(saveBtn);
  form.appendChild(enableRow);
  form.appendChild(modeInput);
  form.appendChild(appIdInput);
  form.appendChild(accessKeyInput);
  form.appendChild(resourceIdInput);
  form.appendChild(endpointInput);
  form.appendChild(streamEndpointInput);
  form.appendChild(languageInput);
  form.appendChild(modelLabelInput);
  form.appendChild(actionRow);
  form.appendChild(status);
  form.appendChild(diagnosticsSummary);
  form.appendChild(diagnosticsActions);
  form.appendChild(diagnosticsText);

  voiceSettingsMount.appendChild(title);
  voiceSettingsMount.appendChild(note);
  voiceSettingsMount.appendChild(form);

  voiceState.diagnosticsSummaryEl = diagnosticsSummary;
  voiceState.diagnosticsTextEl = diagnosticsText;
  syncVoiceDiagnosticsView();
}

voiceInputBtn?.addEventListener("click", () => {
  void handleVoiceInputClick();
});

voiceFileInput?.addEventListener("change", () => {
  const file = voiceFileInput.files?.[0];
  voiceFileInput.value = "";
  if (!file) {
    appendVoiceDiagnostic("已取消选择语音文件");
    return;
  }
  appendVoiceDiagnostic("手动选择了语音文件", {
    fileName: file.name || "",
    fileType: file.type || "",
    fileSize: typeof file.size === "number" ? file.size : 0,
  });
  void submitVoiceAudio(file);
});

window.addEventListener("beforeunload", () => {
  stopVoiceInputClock();
  stopVoiceTracks();
  void cleanupBrowserDirectRecognition();
  void cleanupLiveVoicePreview();
});

scheduleInterval?.(() => {
  syncVoiceInputButton();
}, 800);

ensureVoiceDiagnosticsBootstrapped();
syncVoiceInputButton();
if (typeof fetchJsonOrRedirect === "function") {
  void loadVoiceInputConfig();
}

window.RemoteLabVoiceInput = Object.freeze({
  refreshConfig: loadVoiceInputConfig,
  sync: syncVoiceInputButton,
  getDiagnosticsText: () => getVoiceDiagnosticsText(),
  clearDiagnostics: clearVoiceDiagnostics,
  copyDiagnostics: copyVoiceDiagnosticsToClipboard,
});
