const tokenKey = "careconnect-api-token";
const history = [];
let busy = false;
let recorder = null;
let audioStream = null;
let recordedChunks = [];
let toastTimer;
let recordingTimer = null;
let recordingStartedAt = 0;
const MAX_RECORDING_SECONDS = 25;

const $ = (id) => document.getElementById(id);
const messagesElement = $("messages");
const tokenDialog = $("tokenDialog");
const tokenField = $("apiToken");
const languageSelect = $("languageSelect");

function currentToken() {
  return sessionStorage.getItem(tokenKey) ?? "";
}

function showFeedback(element, message, kind = "error") {
  element.textContent = message;
  element.classList.remove("hidden", "success", "error");
  element.classList.add(kind);
}

function hideFeedback(element) {
  element.classList.add("hidden");
  element.textContent = "";
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Authorization", `Bearer ${currentToken()}`);
  if (options.body) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the local backend. Make sure npm start is running.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("That token was rejected. Copy API_AUTH_TOKEN from your .env file and try again.");
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

function setConnection(connected) {
  const label = $("connectionLabel");
  const symbol = $("connectionSymbol");
  if (label) {
    label.textContent = connected ? "Connected to your local backend" : "Not connected";
    label.classList.toggle("connected", connected);
  }
  if (symbol) symbol.textContent = connected ? "✓" : "↗";
  const buttonLabel = $("connectButtonLabel");
  if (buttonLabel) buttonLabel.textContent = connected ? "Manage API token" : "Add API token";
}

async function checkConnection(token = currentToken()) {
  if (!token) {
    setConnection(false);
    return false;
  }
  try {
    await api("/api/v1/session");
    setConnection(true);
    return true;
  } catch {
    setConnection(false);
    return false;
  }
}

function addMessage(role, text, audioBase64 = null) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "You" : "✳";
  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.append(document.createTextNode(role === "user" ? "You" : "CareConnect"));
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  meta.append(time);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  content.append(meta, bubble);
  if (audioBase64) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.className = "reply-audio";
    audio.src = `data:audio/wav;base64,${audioBase64}`;
    content.append(audio);
  }
  article.append(avatar, content);
  messagesElement.append(article);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function setBusy(value) {
  busy = value;
  $("sendButton").disabled = value;
  $("voiceButton").disabled = value;
  $("typing").classList.toggle("hidden", !value);
  if (value) messagesElement.scrollTop = messagesElement.scrollHeight;
}

async function sendChat(text) {
  if (!text.trim() || busy) return;
  if (!(await checkConnection())) {
    tokenDialog.showModal();
    return;
  }
  const userText = text.trim();
  addMessage("user", userText);
  history.push({ role: "user", content: userText });
  $("messageInput").value = "";
  setBusy(true);
  try {
    const data = await api("/api/v1/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: history.slice(-20),
        language_code: languageSelect.value,
        voice_reply: true,
      }),
    });
    addMessage("assistant", data.reply, data.audio_base64);
    history.push({ role: "assistant", content: data.reply });
    while (history.length > 20) history.shift();
    if (data.audio_error) setVoiceStatus(data.audio_error);
  } catch (error) {
    addMessage("assistant", error.message);
    showToast("Message could not be sent");
  } finally {
    setBusy(false);
    $("messageInput").focus();
  }
}

$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat($("messageInput").value);
});

$("messageInput").addEventListener("input", (event) => {
  event.target.style.height = "auto";
  event.target.style.height = `${Math.min(event.target.scrollHeight, 100)}px`;
});

$("clearChat").addEventListener("click", () => {
  history.length = 0;
  messagesElement.replaceChildren();
  const divider = document.createElement("div");
  divider.className = "date-divider";
  const label = document.createElement("span");
  label.textContent = "NEW CONVERSATION";
  divider.append(label);
  messagesElement.append(divider);
  addMessage("assistant", "Hello! I can help with appointments, reminders, and insurance status. What would you like to take care of today?");
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendChat(button.dataset.prompt));
});

function openTokenDialog() {
  tokenField.value = currentToken();
  hideFeedback($("tokenFeedback"));
  tokenDialog.showModal();
  tokenField.focus();
}

$("connectButton").addEventListener("click", openTokenDialog);
$("closeDialog").addEventListener("click", () => tokenDialog.close());
tokenDialog.addEventListener("click", (event) => {
  if (event.target === tokenDialog) tokenDialog.close();
});

$("tokenForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = tokenField.value.trim();
  if (!token) return;
  $("tokenSubmit").disabled = true;
  try {
    sessionStorage.setItem(tokenKey, token);
    await api("/api/v1/session");
    setConnection(true);
    tokenDialog.close();
    showToast("Care assistant connected");
  } catch (error) {
    sessionStorage.removeItem(tokenKey);
    setConnection(false);
    showFeedback($("tokenFeedback"), error.message);
  } finally {
    $("tokenSubmit").disabled = false;
  }
});

function setVoiceStatus(message) {
  $("voiceStatus").textContent = message;
}

async function transcribeAndReply(blob) {
  if (!blob.size) throw new Error("No audio was captured. Check your microphone and try again.");
  if (blob.size > 5 * 1024 * 1024) throw new Error("Recording is larger than 5 MB. Please record a shorter message.");
  setBusy(true);
  setVoiceStatus("Sending audio securely for transcription…");
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read the recording. Please try again."));
      reader.readAsDataURL(blob);
    });
    const data = await api("/api/v1/voice/webhook", {
      method: "POST",
      body: JSON.stringify({
        audio_base64: base64,
        audio_mime_type: blob.type.split(";")[0] || "audio/webm",
        language_code: languageSelect.value,
        messages: history.slice(-19),
        voice_reply: true,
      }),
    });
    addMessage("user", data.transcript);
    history.push({ role: "user", content: data.transcript });
    addMessage("assistant", data.reply, data.audio_base64);
    history.push({ role: "assistant", content: data.reply });
    while (history.length > 20) history.shift();
    setVoiceStatus(data.audio_base64
      ? "Voice reply ready · use the audio controls to play"
      : "Transcript and reply received. Audio playback was unavailable.");
  } finally {
    setBusy(false);
  }
}

function stopRecording() {
  if (recorder?.state !== "recording") return;
  clearInterval(recordingTimer);
  recordingTimer = null;
  recorder.stop();
  $("voiceButton").classList.remove("recording");
  $("voiceButton").textContent = "◖";
  $("voiceButton").setAttribute("aria-label", "Record a voice message");
  $("voiceButton").title = "Record a voice message";
  $("sendButton").disabled = false;
  setVoiceStatus("Sending your recording…");
}

$("voiceButton").addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    stopRecording();
    return;
  }
  if (!(await checkConnection())) {
    openTokenDialog();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setVoiceStatus("Voice recording is not supported in this browser.");
    return;
  }
  if (!window.isSecureContext) {
    setVoiceStatus("Microphone access requires localhost or a secure HTTPS connection.");
    return;
  }
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
    recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
    recordedChunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      audioStream?.getTracks().forEach((track) => track.stop());
      audioStream = null;
      const finishedRecorder = recorder;
      const audioBlob = new Blob(recordedChunks, { type: finishedRecorder?.mimeType || "audio/webm" });
      recordedChunks = [];
      recorder = null;
      try {
        await transcribeAndReply(audioBlob);
      } catch (error) {
        setVoiceStatus(error.message);
        setBusy(false);
      } finally {
        $("sendButton").disabled = false;
      }
    }, { once: true });
    recorder.start();
    recordingStartedAt = Date.now();
    $("sendButton").disabled = true;
    $("voiceButton").classList.add("recording");
    $("voiceButton").textContent = "■";
    $("voiceButton").setAttribute("aria-label", "Stop recording");
    $("voiceButton").title = "Stop recording";
    const updateTimer = () => {
      const elapsed = Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - recordingStartedAt) / 1000));
      const remaining = MAX_RECORDING_SECONDS - elapsed;
      setVoiceStatus(`Recording · ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")} · ${remaining}s left`);
      if (remaining <= 0) stopRecording();
    };
    updateTimer();
    recordingTimer = setInterval(updateTimer, 1000);
  } catch (error) {
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = null;
    setVoiceStatus("Microphone could not start. Check browser permission and that a microphone is connected.");
  }
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const campaigns = button.dataset.view === "campaigns";
    $("assistantView").classList.toggle("hidden", campaigns);
    $("campaignsView").classList.toggle("hidden", !campaigns);
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    $("crumbTitle").textContent = campaigns ? "Care campaigns" : "Patient assistant";
  });
});

$("campaignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = $("campaignFeedback");
  hideFeedback(feedback);
  if (!(await checkConnection())) {
    openTokenDialog();
    return;
  }
  const patientIds = $("patientIds").value.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean);
  const payload = {
    campaign_type: $("campaignType").value,
    patient_ids: patientIds,
    message_template_id: $("templateId").value.trim(),
  };
  const scheduled = $("scheduledTime").value;
  if (scheduled) payload.scheduled_time = new Date(scheduled).toISOString();
  $("campaignSubmit").disabled = true;
  try {
    const data = await api("/api/v1/campaigns/trigger", { method: "POST", body: JSON.stringify(payload) });
    showFeedback(feedback, data.message ?? "Campaign accepted by the clinic workflow service.", "success");
  } catch (error) {
    showFeedback(feedback, error.message);
  } finally {
    $("campaignSubmit").disabled = false;
  }
});

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") button.click();
  });
}

// Keep the care status and capability cards visible as a movable companion panel.
const carePanel = $("carePanel");
const carePanelHandle = $("carePanelHandle");
if (carePanel && carePanelHandle) {
  let dragStart = null;
  carePanelHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: Number(carePanel.dataset.offsetX || 0),
      offsetY: Number(carePanel.dataset.offsetY || 0),
      rect: carePanel.getBoundingClientRect(),
      bounds: {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8,
      },
    };
    carePanelHandle.setPointerCapture(event.pointerId);
    carePanel.classList.add("is-dragging");
    event.preventDefault();
  });
  carePanelHandle.addEventListener("pointermove", (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const boundedX = Math.min(dragStart.bounds.right - dragStart.rect.right,
      Math.max(dragStart.bounds.left - dragStart.rect.left, dx));
    const boundedY = Math.min(dragStart.bounds.bottom - dragStart.rect.bottom,
      Math.max(dragStart.bounds.top - dragStart.rect.top, dy));
    const offsetX = dragStart.offsetX + boundedX;
    const offsetY = dragStart.offsetY + boundedY;
    carePanel.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    carePanel.dataset.offsetX = String(offsetX);
    carePanel.dataset.offsetY = String(offsetY);
  });
  const finishPanelDrag = (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    dragStart = null;
    carePanel.classList.remove("is-dragging");
  };
  carePanelHandle.addEventListener("pointerup", finishPanelDrag);
  carePanelHandle.addEventListener("pointercancel", finishPanelDrag);
  window.addEventListener("resize", () => {
    carePanel.style.transform = "";
    delete carePanel.dataset.offsetX;
    delete carePanel.dataset.offsetY;
  });
}

checkConnection();


