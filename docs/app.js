const POLYFILL_URL = "https://cdn.jsdelivr.net/npm/web-serial-polyfill@1.0.15/dist/serial.js";

// Nanapo (AD7SGPR) serial protocol: fixed 115200bps, CRLF line ending,
// up to 8 ASCII characters displayed as-is on the 7-segment display.
const BAUD_RATE = 115200;
const LINE_ENDING = "\r\n";
const DISPLAY_WIDTH = 8;
const MAX_INPUT_LENGTH = 40;
const SCROLL_FRAME_INTERVAL_MS = 250;
const SCROLL_HOLD_MS = 1500;

function isAndroid() {
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    return navigator.userAgentData.platform === "Android";
  }
  return /Android/i.test(navigator.userAgent);
}

function logDiagnostic(message) {
  appendLog("[判定] " + message);
}

// Desktop Chrome/Edge expose navigator.serial natively, so they never need to
// fetch the polyfill. Android Chrome does implement navigator.serial, but
// only for Bluetooth serial devices, not USB - so on Android we always force
// the WebUSB-based polyfill, loaded on demand via dynamic import.
async function resolveSerialApi() {
  const androidDetected = isAndroid();
  const hasNativeSerial = "serial" in navigator;
  const hasUsb = "usb" in navigator;

  logDiagnostic("navigator.userAgent: " + navigator.userAgent);
  logDiagnostic(
    `Android判定: ${androidDetected ? "はい" : "いいえ"} / navigator.serial: ${hasNativeSerial ? "あり" : "なし"} / navigator.usb: ${hasUsb ? "あり" : "なし"}`
  );

  if (!androidDetected && hasNativeSerial) {
    logDiagnostic("使用API: Web Serial API（ネイティブ、navigator.serial）");
    return navigator.serial;
  }

  if (hasUsb) {
    logDiagnostic(
      androidDetected
        ? "使用API: WebUSB + web-serial-polyfill（Android検出のため強制）"
        : "使用API: WebUSB + web-serial-polyfill（navigator.serial非対応のため）"
    );
    try {
      const polyfillModule = await import(POLYFILL_URL);
      logDiagnostic("web-serial-polyfillの読み込みに成功しました");
      return polyfillModule.serial;
    } catch (error) {
      logDiagnostic("web-serial-polyfillの読み込みに失敗しました: " + error.message);
      throw error;
    }
  }

  logDiagnostic("使用API: なし（Web Serial APIにもWebUSB APIにも非対応）");
  return null;
}

class LineBreakTransformer {
  constructor() {
    this.chunk = "";
  }

  transform(chunk, controller) {
    this.chunk += chunk;
    const lines = this.chunk.split(LINE_ENDING);
    this.chunk = lines.pop();
    lines.forEach((line) => controller.enqueue(line));
  }

  flush(controller) {
    if (this.chunk) {
      controller.enqueue(this.chunk);
    }
  }
}

const unsupportedMessage = document.getElementById("unsupported-message");
const connectionPanel = document.getElementById("connection-panel");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const errorText = document.getElementById("error-text");
const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect-button");
const inputText = document.getElementById("input-text");
const sendButton = document.getElementById("send-button");
const stopButton = document.getElementById("stop-button");
const outputText = document.getElementById("output-text");
const clearLogButton = document.getElementById("clear-log-button");
const cmdButtons = Array.from(document.querySelectorAll(".cmd-button"));
const hexInput = document.getElementById("hex-input");
const hexSendButton = document.getElementById("hex-send-button");
const badgeBrightness = document.querySelector("#badge-brightness .status-badge-value");
const badgeDisplay = document.querySelector("#badge-display .status-badge-value");
const badgeOther = document.querySelector("#badge-other .status-badge-value");

let serialApi = null;
let port = null;
let reader = null;
let readableStreamClosed = null;
let keepReading = false;
let scrollToken = 0;
let scrolling = false;

function setStatus(state, message) {
  statusDot.classList.remove("connected", "error");
  if (state === "connected") {
    statusDot.classList.add("connected");
  } else if (state === "error") {
    statusDot.classList.add("error");
  }
  statusText.textContent = message;
}

function setError(message) {
  errorText.textContent = message || "";
}

function appendLog(line) {
  outputText.value += line + "\n";
  outputText.scrollTop = outputText.scrollHeight;
}

function setConnectedUi(connected) {
  connectButton.disabled = connected;
  disconnectButton.disabled = !connected;
  inputText.disabled = !connected;
  sendButton.disabled = !connected;
  hexInput.disabled = !connected;
  hexSendButton.disabled = !connected;
  cmdButtons.forEach((button) => {
    button.disabled = !connected;
  });
  if (!connected) {
    setBadge(badgeBrightness, "-");
    setBadge(badgeDisplay, "-");
    setBadge(badgeOther, "-");
    cancelScroll();
  }
  updateScrollUi();
}

function updateScrollUi() {
  stopButton.disabled = !scrolling;
}

function setBadge(element, value) {
  element.textContent = value;
  const badge = element.closest(".status-badge");
  badge.classList.remove("flash");
  // Force a reflow so the flash animation restarts on repeated updates.
  void badge.offsetWidth;
  badge.classList.add("flash");
}

function handleIncomingLine(line) {
  appendLog(line);

  const brightnessMatch = line.match(/brightness:\s*(\d+)/i);
  if (brightnessMatch) {
    setBadge(badgeBrightness, brightnessMatch[1]);
    return;
  }
  if (/7sgOn/i.test(line) || /is ON mode/i.test(line)) {
    setBadge(badgeDisplay, "ON");
    return;
  }
  if (/7sgOff/i.test(line) || /is OFF mode/i.test(line)) {
    setBadge(badgeDisplay, "OFF");
    return;
  }
  // Lines that echo a command we sent (rxData:...) or report a known error
  // code are not spontaneous device notifications, so they don't count as a
  // possible C/D button press.
  if (/^rxData:/i.test(line) || /^E\d:/i.test(line) || line === "") {
    return;
  }
  setBadge(badgeOther, line);
}

async function readLoop() {
  const textDecoder = new TextDecoderStream();
  readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable
    .pipeThrough(new TransformStream(new LineBreakTransformer()))
    .getReader();

  try {
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        handleIncomingLine(value);
      }
    }
  } catch (error) {
    if (keepReading) {
      setError("受信中にエラーが発生しました: " + error.message);
    }
  } finally {
    reader.releaseLock();
  }
}

async function connect() {
  setError("");
  try {
    port = await serialApi.requestPort();
    await port.open({ baudRate: BAUD_RATE });
  } catch (error) {
    // User cancelled the device picker; not a real error.
    if (error.name === "NotFoundError") {
      return;
    }
    setStatus("error", "接続に失敗しました");
    setError(error.message);
    port = null;
    return;
  }

  keepReading = true;
  setConnectedUi(true);
  setStatus("connected", "接続済み");
  readLoop();
}

async function disconnect() {
  keepReading = false;
  setError("");

  try {
    if (reader) {
      await reader.cancel();
      await readableStreamClosed.catch(() => {});
    }
    if (port) {
      await port.close();
    }
  } catch (error) {
    setError("切断中にエラーが発生しました: " + error.message);
  } finally {
    reader = null;
    readableStreamClosed = null;
    port = null;
    setConnectedUi(false);
    setStatus("idle", "未接続");
  }
}

async function sendRaw(text) {
  if (!port || !port.writable) {
    return;
  }
  setError("");

  const writer = port.writable.getWriter();
  try {
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(text + LINE_ENDING));
  } catch (error) {
    setError("送信に失敗しました: " + error.message);
  } finally {
    writer.releaseLock();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nanapo can only ever show DISPLAY_WIDTH characters at once, so both a long
// string and a short one are displayed the same way: pad with a blank
// display's worth of spaces on each side, then slide an 8-character window
// across it one step at a time. For text that already fits within one
// window, this naturally produces a scroll-in / scroll-out animation; for
// longer text, the same sliding window becomes a continuous marquee.
function buildScrollFrames(text) {
  const padding = " ".repeat(DISPLAY_WIDTH);
  const padded = padding + text + padding;
  const frames = [];
  for (let i = 0; i <= padded.length - DISPLAY_WIDTH; i++) {
    frames.push(padded.slice(i, i + DISPLAY_WIDTH));
  }
  return frames;
}

async function scrollText(text) {
  const token = ++scrollToken;
  scrolling = true;
  updateScrollUi();

  const frames = buildScrollFrames(text);
  // When the whole text fits in one window, hold on the fully-settled frame
  // (right after the leading padding) so it's actually readable before it
  // scrolls back out, instead of just flashing past.
  const holdFrameIndex = text.length <= DISPLAY_WIDTH ? DISPLAY_WIDTH : -1;

  for (let i = 0; i < frames.length; i++) {
    if (token !== scrollToken || !port) {
      return;
    }
    await sendRaw(frames[i]);
    await sleep(i === holdFrameIndex ? SCROLL_HOLD_MS : SCROLL_FRAME_INTERVAL_MS);
  }

  if (token === scrollToken) {
    scrolling = false;
    updateScrollUi();
  }
}

function cancelScroll() {
  if (!scrolling) {
    return;
  }
  scrollToken++; // invalidate the running scroll loop; it exits at its next step
  scrolling = false;
  updateScrollUi();
}

function stopScroll() {
  if (!scrolling) {
    return;
  }
  cancelScroll();
  sendRaw("@CLR");
}

function handleSend() {
  const text = inputText.value;
  if (!text) {
    return;
  }
  if (text.length > MAX_INPUT_LENGTH) {
    setError(`文字列が長すぎます（最大${MAX_INPUT_LENGTH}文字）`);
    return;
  }
  scrollText(text);
}

function handleCommandButtonClick(event) {
  cancelScroll();
  const command = event.currentTarget.dataset.command;
  sendRaw(command);
}

function handleHexSend() {
  const value = hexInput.value.trim();
  if (!/^[0-9A-Fa-f]{16}$/.test(value)) {
    setError("@HEXコマンドには16桁の16進数を入力してください");
    return;
  }
  cancelScroll();
  sendRaw("@HEX" + value);
}

async function init() {
  // Resolved once up front (not inside the connect click handler) so that
  // Android's dynamic polyfill import never risks consuming the click's
  // user-activation window that requestPort() needs.
  try {
    serialApi = await resolveSerialApi();
  } catch (error) {
    serialApi = null;
  }

  if (!serialApi) {
    unsupportedMessage.hidden = false;
    connectionPanel.hidden = true;
    document.getElementById("send-panel").hidden = true;
    document.getElementById("command-panel").hidden = true;
    document.getElementById("button-status-panel").hidden = true;
    // Keep the log panel visible even when unsupported: it holds the
    // WebSerial/WebUSB diagnostic trail from resolveSerialApi(), which is
    // exactly what's needed to debug why detection failed on a given device.
    return;
  }

  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);

  sendButton.addEventListener("click", handleSend);
  stopButton.addEventListener("click", stopScroll);
  inputText.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSend();
    }
  });

  cmdButtons.forEach((button) => {
    button.addEventListener("click", handleCommandButtonClick);
  });

  hexSendButton.addEventListener("click", handleHexSend);
  hexInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleHexSend();
    }
  });

  clearLogButton.addEventListener("click", () => {
    outputText.value = "";
  });

  if ("addEventListener" in serialApi) {
    serialApi.addEventListener("disconnect", () => {
      if (port) {
        setError("デバイスが切断されました");
        disconnect();
      }
    });
  }
}

init();
