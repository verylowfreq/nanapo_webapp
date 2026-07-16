const POLYFILL_URL = "https://cdn.jsdelivr.net/npm/web-serial-polyfill@1.0.15/dist/serial.js";

// Nanapo (AD7SGPR) serial protocol: fixed 115200bps, CRLF line ending,
// up to 8 ASCII characters displayed as-is on the 7-segment display.
const BAUD_RATE = 115200;
const LINE_ENDING = "\r\n";
const MAX_CHARS = 8;

function isAndroid() {
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    return navigator.userAgentData.platform === "Android";
  }
  return /Android/i.test(navigator.userAgent);
}

// Desktop Chrome/Edge expose navigator.serial natively, so they never need to
// fetch the polyfill. Android Chrome does implement navigator.serial, but
// only for Bluetooth serial devices, not USB - so on Android we always force
// the WebUSB-based polyfill, loaded on demand via dynamic import.
async function resolveSerialApi() {
  if (!isAndroid() && "serial" in navigator) {
    return navigator.serial;
  }
  if ("usb" in navigator) {
    const polyfillModule = await import(POLYFILL_URL);
    return polyfillModule.serial;
  }
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
const outputText = document.getElementById("output-text");
const clearLogButton = document.getElementById("clear-log-button");

let serialApi = null;
let port = null;
let reader = null;
let readableStreamClosed = null;
let keepReading = false;

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
        appendLog(value);
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

async function sendText(text) {
  if (!port || !port.writable) {
    return;
  }
  if (text.length > MAX_CHARS) {
    setError(`Nanapoは最大${MAX_CHARS}文字までしか表示できません`);
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

function handleSend() {
  const text = inputText.value;
  if (!text) {
    return;
  }
  sendText(text);
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
    document.getElementById("log-panel").hidden = true;
    return;
  }

  connectButton.addEventListener("click", connect);
  disconnectButton.addEventListener("click", disconnect);

  sendButton.addEventListener("click", handleSend);
  inputText.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSend();
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
