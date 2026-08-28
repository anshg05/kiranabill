var mediaRecorder = null;
var recordingStream = null;
var recordingMimeType = "";
var recordedChunks = [];
var isTranscribingAudio = false;
var discardRecordingOnStop = false;
var RECORDING_AUDIO_CONSTRAINTS = {
  channelCount: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};
var SIMPLE_ITEM_HINT_PATTERN = /\b(?:wala|wali|ka|ki|rupay|rupees|rs|kg|kilo|gram|grams|gm|g|liter|litre|ml|packet|pack|piece|pcs|dozen|box|bottle|pouch|bag|can|tin)\b/i;
var SIMPLE_ITEM_NUMBER_PATTERN = /\d/;
var VOICE_NORMALIZATION_RULES = [
  { pattern: /\bsoff\b/gi, replacement: "saunf" },
  { pattern: /\bsof\b/gi, replacement: "saunf" },
  { pattern: /\bsonf\b/gi, replacement: "saunf" },
  { pattern: /\bsauf\b/gi, replacement: "saunf" },
  { pattern: /\bsouf\b/gi, replacement: "saunf" },
  { pattern: /\bsouff\b/gi, replacement: "saunf" },
  { pattern: /\bajvayan\b/gi, replacement: "ajwain" },
  { pattern: /\bajvayn\b/gi, replacement: "ajwain" },
  { pattern: /\bkalimirch\b/gi, replacement: "kali mirch" },
  { pattern: /\bkali much\b/gi, replacement: "kali mirch" },
  { pattern: /\bkali mirchi\b/gi, replacement: "kali mirch" },
  { pattern: /\bkanaki\b/gi, replacement: "kanki" },
  { pattern: /\bmoong moongar\b/gi, replacement: "moong mogar" },
  { pattern: /\bmoongar\b/gi, replacement: "mogar" },
  { pattern: /\burad moongar\b/gi, replacement: "urad mogar" },
  { pattern: /\bmung mogar\b/gi, replacement: "moong mogar" }
];

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function hasRecordedTranscriptionSupport() {
  return typeof window.MediaRecorder !== "undefined"
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function";
}

function hasLegacySpeechSupport() {
  return !!getSpeechRecognitionCtor();
}

function selectRecordingMimeType() {
  if (typeof window.MediaRecorder === "undefined" || typeof window.MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  var preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg"
  ];

  for (var i = 0; i < preferredTypes.length; i++) {
    if (window.MediaRecorder.isTypeSupported(preferredTypes[i])) {
      return preferredTypes[i];
    }
  }

  return "";
}

function createMediaRecorder(stream) {
  var mimeType = selectRecordingMimeType();

  if (mimeType) {
    return new MediaRecorder(stream, { mimeType: mimeType });
  }

  return new MediaRecorder(stream);
}

function cleanupRecordingResources() {
  if (recordingStream) {
    recordingStream.getTracks().forEach(function(track) {
      track.stop();
    });
  }

  mediaRecorder = null;
  recordingStream = null;
  recordingMimeType = "";
  recordedChunks = [];
}

function initLegacySpeech() {
  var SpeechRecognitionCtor = getSpeechRecognitionCtor();

  if (!SpeechRecognitionCtor) {
    return null;
  }

  var recognizer = new SpeechRecognitionCtor();
  recognizer.lang = "hi-IN";
  recognizer.continuous = !isMobileSpeechMode();
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = function(event) {
    var interim = "";
    var final = "";

    for (var i = event.resultIndex; i < event.results.length; i++) {
      var transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }

    var heardText = (final || interim).trim();
    if (heardText) {
      lastHeardTranscript = heardText;
    }

    setTranscript(interim, final);
    if (final.trim()) {
      speechHadFinalResult = true;
      handleFinalTranscript(final.trim());
      lastHeardTranscript = "";
    }
  };

  recognizer.onerror = function(event) {
    clearTimeout(micRetryTimer);
    micRetryTimer = null;

    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }

    if (isMobileSpeechMode() && micRetryCount < 1 && (event.error === "network" || event.error === "audio-capture")) {
      recognition = null;
      isListening = false;
      setListening(false);
      micRetryCount += 1;
      micRetryTimer = setTimeout(function() {
        startLegacyListening();
      }, 220);
      return;
    }

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showToast("Mic permission allow karein", "err");
    } else if (event.error === "audio-capture") {
      showToast("Mic available nahin hai", "err");
    } else {
      showToast("Mic error", "err");
    }

    recognition = null;
    isListening = false;
    setListening(false);
  };

  recognizer.onend = function() {
    if (isListening && !isMobileSpeechMode()) {
      try {
        recognizer.start();
      } catch (error) {}
      return;
    }

    if (isListening && isMobileSpeechMode()) {
      if (!speechHadFinalResult && lastHeardTranscript.trim()) {
        handleFinalTranscript(lastHeardTranscript.trim());
      } else if (queuedVoiceText.trim()) {
        flushQueuedVoiceText();
      }

      isListening = false;
      setListening(false);
      lastHeardTranscript = "";
      speechHadFinalResult = false;
    }
  };

  return recognizer;
}

function toggleListen() {
  if (isTranscribingAudio || isVoiceProcessing) {
    showToast("Thoda rukiyega, current voice process ho raha hai", "info");
    return;
  }

  if (isListening) {
    stopListening();
    return;
  }

  startListening();
}

async function ensureMicAccess() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return true;
  }

  var stream = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_AUDIO_CONSTRAINTS });
  stream.getTracks().forEach(function(track) {
    track.stop();
  });
  return true;
}

async function startListening() {
  clearTimeout(micRetryTimer);
  micRetryTimer = null;

  if (hasRecordedTranscriptionSupport()) {
    await startRecordedListening();
    return;
  }

  await startLegacyListening();
}

async function startRecordedListening() {
  var stream = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_AUDIO_CONSTRAINTS });
  } catch (error) {
    if (hasLegacySpeechSupport()) {
      showToast("Recording mode unavailable, browser speech use ho raha hai", "info");
      await startLegacyListening();
      return;
    }

    showToast("Mic permission allow karein", "err");
    return;
  }

  try {
    mediaRecorder = createMediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach(function(track) {
      track.stop();
    });

    if (hasLegacySpeechSupport()) {
      showToast("Recording mode unavailable, browser speech use ho raha hai", "info");
      await startLegacyListening();
      return;
    }

    showToast("Voice recording supported nahin hai", "err");
    return;
  }

  recordingStream = stream;
  recordingMimeType = mediaRecorder.mimeType || selectRecordingMimeType() || "audio/webm";
  recordedChunks = [];
  discardRecordingOnStop = false;
  queuedVoiceText = "";
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = null;
  lastHeardTranscript = "";
  speechHadFinalResult = false;

  mediaRecorder.ondataavailable = function(event) {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = function() {
    handleRecordedStop();
  };

  mediaRecorder.onerror = function() {
    isListening = false;
    setListening(false);
    cleanupRecordingResources();
    showToast("Voice recording failed", "err");
  };

  try {
    mediaRecorder.start();
  } catch (error) {
    cleanupRecordingResources();

    if (hasLegacySpeechSupport()) {
      showToast("Recording mode unavailable, browser speech use ho raha hai", "info");
      await startLegacyListening();
      return;
    }

    showToast("Mic start nahin ho raha", "err");
    return;
  }

  isListening = true;
  setListening(true, "Recording... tap again to stop");
  setTranscript("Recording audio...", "");
  updateVoiceDebugPanel({ heard: "-", normalized: "-", source: "recording", items: "Waiting for speech..." });
}

async function startLegacyListening() {
  try {
    await ensureMicAccess();
  } catch (error) {
    showToast("Mic permission allow karein", "err");
    return;
  }

  if (!recognition || isMobileSpeechMode()) {
    recognition = initLegacySpeech();
  }
  if (!recognition) {
    alert("Chrome browser use karein.");
    return;
  }

  lastHeardTranscript = "";
  speechHadFinalResult = false;
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = null;
  queuedVoiceText = "";

  try {
    recognition.start();
  } catch (error) {
    if (isMobileSpeechMode() && micRetryCount < 1) {
      recognition = null;
      micRetryCount += 1;
      micRetryTimer = setTimeout(function() {
        startLegacyListening();
      }, 220);
      return;
    }

    recognition = null;
    micRetryCount = 0;
    showToast("Mic restart karke try karein", "err");
    return;
  }

  micRetryCount = 0;
  isListening = true;
  setListening(true, "Listening... speak now");
  updateVoiceDebugPanel({ heard: "-", normalized: "-", source: "browser-speech", items: "Waiting for speech..." });
}

function stopListening(options) {
  var stopOptions = options || {};

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    stopRecordedListening(stopOptions);
    return;
  }

  stopLegacyListening();
}

function stopRecordedListening(options) {
  discardRecordingOnStop = Boolean(options && options.discard);
  isListening = false;
  micRetryCount = 0;
  clearTimeout(micRetryTimer);
  micRetryTimer = null;
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = null;
  queuedVoiceText = "";
  lastHeardTranscript = "";
  speechHadFinalResult = false;
  setListening(false, discardRecordingOnStop ? "Tap to speak" : "Transcribing audio...");

  try {
    mediaRecorder.stop();
  } catch (error) {
    cleanupRecordingResources();
    setTranscript("", "");
    if (!discardRecordingOnStop) {
      showToast("Mic stop nahin ho paya", "err");
    }
  }
}

function stopLegacyListening() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (error) {}
  }

  isListening = false;
  micRetryCount = 0;
  clearTimeout(micRetryTimer);
  micRetryTimer = null;
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = null;
  queuedVoiceText = "";
  lastHeardTranscript = "";
  speechHadFinalResult = false;
  setListening(false);
  setTranscript("", "");
}

async function handleRecordedStop() {
  var chunks = recordedChunks.slice();
  var mimeType = recordingMimeType || "audio/webm";
  var shouldDiscard = discardRecordingOnStop;

  discardRecordingOnStop = false;
  cleanupRecordingResources();

  if (shouldDiscard) {
    setTranscript("", "");
    return;
  }

  if (!chunks.length) {
    setTranscript("", "");
    showToast("Audio record nahin hua", "err");
    return;
  }

  var audioBlob = new Blob(chunks, { type: mimeType });

  if (!audioBlob.size) {
    setTranscript("", "");
    showToast("Audio record nahin hua", "err");
    return;
  }

  try {
    isTranscribingAudio = true;
    showProcessing(true, "Transcribing audio...");
    setTranscript("Transcribing audio...", "");

    var transcript = await transcribeAudioBlob(audioBlob);

    if (!transcript) {
      setTranscript("", "");
      updateVoiceDebugPanel({ heard: "-", normalized: "-", source: "empty transcript", items: "-", commitHistory: true });
      showToast("Kuch sunai nahin diya", "err");
      return;
    }

    var normalizedTranscript = normalizeVoiceTranscriptText(transcript);
    setTranscript("", normalizedTranscript);
    updateVoiceDebugPanel({
      heard: transcript,
      normalized: normalizedTranscript,
      source: "groq-transcribe",
      items: "Waiting for parsing..."
    });
    await processVoice(normalizedTranscript);
  } catch (error) {
    console.error(error);
    setTranscript("", "");
    updateVoiceDebugPanel({ source: "transcribe error", items: error && error.message ? error.message : "Transcription failed", commitHistory: true });
    showToast("Voice transcript failed. Dobara try karein ya manual item add karein", "err");
  } finally {
    isTranscribingAudio = false;
    showProcessing(false);
  }
}

function setListening(isActive, statusText) {
  var button = document.getElementById("micBtn");
  var status = document.getElementById("micStatus");
  var micZone = document.getElementById("micZone");
  var transcriptField = document.getElementById("transcriptField");

  button.classList.toggle("active", isActive);
  micZone.classList.toggle("listening", isActive);
  transcriptField.classList.toggle("active", isActive);
  status.classList.toggle("active", isActive);
  status.textContent = statusText || (isActive
    ? "Listening... speak now" : "Tap to speak");
}

function setTranscript(interim, final) {
  var transcriptEl = document.getElementById("transcriptEl");

  if (interim) {
    transcriptEl.innerHTML = '<span class="tr-interim">' + interim + "</span>";
    return;
  }

  if (final) {
    transcriptEl.innerHTML = '<span class="tr-final">' + final + "</span>";
    setTimeout(function() {
      transcriptEl.innerHTML = '<span class="tr-ph">' + TRANSCRIPT_PLACEHOLDER + "</span>";
    }, 2500);
    return;
  }

  transcriptEl.innerHTML = '<span class="tr-ph">' + TRANSCRIPT_PLACEHOLDER + "</span>";
}

function formatVoiceDebugItems(items) {
  if (!items || !items.length) {
    return "-";
  }

  return items.map(function(item) {
    var parts = [item.displayName || item.spokenName || "Unknown"];

    if (item.qty !== null && item.qty !== undefined) {
      parts.push("qty:" + item.qty + (item.unit ? " " + item.unit : ""));
    }
    if (item.rate !== null && item.rate !== undefined) {
      parts.push("rate:" + item.rate);
    }
    if (item.total !== null && item.total !== undefined) {
      parts.push("total:" + item.total);
    }
    if (item.needsReview && item.reviewReasons && item.reviewReasons.length) {
      parts.push("review:" + item.reviewReasons.join("/"));
    }

    return parts.join(" | ");
  }).join("\n");
}

function appendVoiceDebugHistory(entry) {
  if (!window.KB_DEBUG_MODE) {
    return;
  }

  var normalizedEntry = entry || {};
  var history = window.__kbVoiceDebugHistory || [];
  var timestamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  var summary = [
    "[" + timestamp + "]",
    "heard=" + (normalizedEntry.heard || "-"),
    "normalized=" + (normalizedEntry.normalized || "-"),
    "source=" + (normalizedEntry.source || "-"),
    "items=" + (normalizedEntry.items || "-")
  ].join("\n");

  history.unshift(summary);
  window.__kbVoiceDebugHistory = history.slice(0, 8);

  var historyEl = document.getElementById("debugHistory");
  if (historyEl) {
    historyEl.textContent = window.__kbVoiceDebugHistory.join("\n\n");
  }
}

function updateVoiceDebugPanel(patch) {
  if (!window.KB_DEBUG_MODE) {
    return;
  }

  window.__kbVoiceDebug = Object.assign({
    heard: "-",
    normalized: "-",
    source: "-",
    items: "-"
  }, window.__kbVoiceDebug || {}, patch || {});

  var state = window.__kbVoiceDebug;
  var heardEl = document.getElementById("debugHeard");
  var normalizedEl = document.getElementById("debugNormalized");
  var sourceEl = document.getElementById("debugSource");
  var itemsEl = document.getElementById("debugItems");

  if (heardEl) {
    heardEl.textContent = state.heard || "-";
  }
  if (normalizedEl) {
    normalizedEl.textContent = state.normalized || "-";
  }
  if (sourceEl) {
    sourceEl.textContent = state.source || "-";
  }
  if (itemsEl) {
    itemsEl.textContent = state.items || "-";
  }

  if (patch && patch.commitHistory) {
    appendVoiceDebugHistory(state);
  }
}

async function copyVoiceDebugReport() {
  if (!window.KB_DEBUG_MODE) {
    return;
  }

  var currentState = window.__kbVoiceDebug || {};
  var history = window.__kbVoiceDebugHistory || [];
  var report = [
    "Current",
    "heard: " + (currentState.heard || "-"),
    "normalized: " + (currentState.normalized || "-"),
    "source: " + (currentState.source || "-"),
    "items: " + (currentState.items || "-"),
    "",
    "Recent",
    history.join("\n\n") || "-"
  ].join("\n");

  try {
    await navigator.clipboard.writeText(report);
    showToast("Debug copied", "ok");
  } catch (error) {
    console.error(error);
    showToast("Debug copy failed", "err");
  }
}

function showProcessing(show, label) {
  var indicator = document.getElementById("parsingIndicator");
  var labelEl = document.getElementById("parsingLabel");

  if (labelEl && label) {
    labelEl.textContent = label;
  }

  indicator.classList.toggle("is-visible", show);

  if (!show && labelEl) {
    labelEl.textContent = "Understanding...";
  }
}

function isMobileSpeechMode() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
}

function isVoiceCommandText(text) {
  var normalizedText = text.toLowerCase().trim();

  return [
    "ho gaya", "hogaya", "bill bana", "bill banao", "total", "bas", "done", "complete", "khatam", "finish",
    "hatao", "hata do", "last hatao", "pichla hatao", "remove", "undo", "wapas", "delete",
    "sab hatao", "clear karo", "sab delete"
  ].some(function(command) {
    return normalizedText.includes(command);
  });
}

function queueVoiceText(text) {
  queuedVoiceText = queuedVoiceText ? queuedVoiceText + " " + text : text;
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = setTimeout(function() {
    flushQueuedVoiceText();
  }, isMobileSpeechMode() ? 900 : 250);
}

async function flushQueuedVoiceText() {
  clearTimeout(queuedVoiceTimer);
  queuedVoiceTimer = null;

  if (isVoiceProcessing || !queuedVoiceText.trim()) {
    return;
  }

  var textToProcess = queuedVoiceText.trim();
  queuedVoiceText = "";
  isVoiceProcessing = true;

  try {
    await processVoice(textToProcess);
  } finally {
    isVoiceProcessing = false;
    if (queuedVoiceText.trim()) {
      flushQueuedVoiceText();
    }
  }
}

function handleFinalTranscript(text) {
  if (isVoiceCommandText(text)) {
    updateVoiceDebugPanel({ source: "voice-command", items: "Command: " + text, commitHistory: true });
    if (queuedVoiceText.trim()) {
      flushQueuedVoiceText().then(function() {
        processVoice(text);
      });
    } else {
      processVoice(text);
    }
    return;
  }

  queueVoiceText(text);
}

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();

    reader.onloadend = function() {
      var result = String(reader.result || "");
      var commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };

    reader.onerror = function() {
      reject(reader.error || new Error("Failed to read audio blob"));
    };

    reader.readAsDataURL(blob);
  });
}

function normalizeVoiceTranscriptText(text) {
  var normalized = String(text || "").trim();

  VOICE_NORMALIZATION_RULES.forEach(function(rule) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  });

  return normalized.replace(/\s+/g, " ").trim();
}

function isSimpleCatalogItemText(text) {
  var normalized = normalizeVoiceTranscriptText(text).toLowerCase();
  var tokenCount = normalized ? normalized.split(/\s+/).length : 0;

  return Boolean(normalized)
    && tokenCount > 0
    && tokenCount <= 3
    && !SIMPLE_ITEM_NUMBER_PATTERN.test(normalized)
    && !SIMPLE_ITEM_HINT_PATTERN.test(normalized);
}

function isLooseCatalogUnit(unit) {
  var normalizedUnit = String(unit || "").toLowerCase();
  return normalizedUnit === "kg" || normalizedUnit === "gm" || normalizedUnit === "liter" || normalizedUnit === "ml";
}

function tryBuildDirectCatalogItem(text) {
  if (!isSimpleCatalogItemText(text) || typeof getBestCatalogMatch !== "function") {
    return null;
  }

  var normalized = normalizeVoiceTranscriptText(text);
  var match = getBestCatalogMatch(normalized);

  if (!match || match.source !== "alias" || !match.product) {
    return null;
  }

  var product = match.product;
  if (isLooseCatalogUnit(product.unit)) {
    return {
      status: "incomplete",
      item: {
        displayName: product.displayName,
        spokenName: normalized,
        qty: null,
        unit: "",
        rate: null,
        total: 0,
        isCustom: false,
        priceType: "unknown"
      }
    };
  }

  var quickItem = {
    displayName: product.displayName,
    spokenName: normalized,
    qty: 1,
    unit: product.unit,
    rate: product.price,
    total: product.price,
    isCustom: false,
    priceType: "default"
  };

  if (typeof validateParsedItems === "function") {
    return {
      status: "item",
      item: validateParsedItems([quickItem])[0] || null
    };
  }

  return {
    status: "item",
    item: quickItem
  };
}

function isUsefulCatalogText(value) {
  var text = String(value || "").trim();

  if (!text) {
    return false;
  }

  return !(/[\u00e0\u00e2\u00f0]/.test(text) && !(/[\u0900-\u097f]/.test(text)));
}

function buildPromptProductLine(product) {
  if (!product) {
    return "";
  }

  var aliases = [product.displayName].concat(product.names || []).map(function(name) {
    return String(name || "").trim();
  }).filter(isUsefulCatalogText);

  if (!aliases.length) {
    return "";
  }

  var uniqueAliases = [];
  var seenAliases = {};

  aliases.forEach(function(alias) {
    var lowered = alias.toLowerCase();
    if (!seenAliases[lowered]) {
      seenAliases[lowered] = true;
      uniqueAliases.push(alias);
    }
  });

  return product.displayName + "|aliases:" + uniqueAliases.slice(0, 8).join(",") + "|defaultPrice:" + product.price + "/" + product.unit;
}

function scorePromptProductRelevance(product, normalizedText, normalizedTokens) {
  if (!product || !normalizedText) {
    return 0;
  }

  var aliases = [product.displayName].concat(product.names || []).map(function(name) {
    return typeof normalizeMatchKey === "function" ? normalizeMatchKey(name) : String(name || "").toLowerCase().trim();
  }).filter(Boolean);
  var bestScore = 0;

  aliases.forEach(function(aliasKey) {
    if (!aliasKey) {
      return;
    }

    if (normalizedText === aliasKey) {
      bestScore = Math.max(bestScore, 100);
      return;
    }

    if (normalizedText.indexOf(aliasKey) !== -1 || aliasKey.indexOf(normalizedText) !== -1) {
      bestScore = Math.max(bestScore, 80);
    }

    var aliasTokens = aliasKey.split(" ");
    var overlap = aliasTokens.filter(function(token) {
      return normalizedTokens.indexOf(token) !== -1;
    }).length;

    if (overlap) {
      bestScore = Math.max(bestScore, overlap / Math.max(aliasTokens.length, normalizedTokens.length, 1));
    }
  });

  return bestScore;
}

function buildPromptProductList(text) {
  var normalizedText = typeof normalizeMatchKey === "function"
    ? normalizeMatchKey(normalizeVoiceTranscriptText(text))
    : normalizeVoiceTranscriptText(text).toLowerCase();
  var normalizedTokens = normalizedText.split(" ").filter(function(token) {
    return token && token.length > 1;
  });
  var scoredProducts = PRODUCTS.map(function(product) {
    return {
      product: product,
      score: scorePromptProductRelevance(product, normalizedText, normalizedTokens)
    };
  }).filter(function(entry) {
    return entry.score > 0;
  }).sort(function(a, b) {
    return b.score - a.score;
  });

  var promptProducts = scoredProducts.slice(0, 80).map(function(entry) {
    return entry.product;
  });

  if (!promptProducts.length) {
    promptProducts = PRODUCTS.slice(0, 120);
  }

  return promptProducts.map(buildPromptProductLine).filter(Boolean).join("\n");
}

async function transcribeAudioBlob(blob) {
  var response = await fetch("/.netlify/functions/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audioBase64: await blobToBase64(blob),
      mimeType: blob.type || "audio/webm"
    })
  });

  var data = await response.json();

  if (!response.ok || data.error) {
    throw new Error((data && data.error) || "Transcription service failed");
  }

  return typeof data.text === "string" ? data.text.trim() : "";
}

async function parseWithGemini(text) {
  var productList = buildPromptProductList(text);

  var prompt = "You are a kirana shop billing assistant in India. Parse Hindi/English speech into bill items.\n\n"
    + "Products (for fuzzy name matching only, limited relevant subset):\n" + productList + "\n\n"
    + "Keep item names conservative. Do NOT rename or substitute a spoken item phrase to a nearby catalog product. Preserve the spoken product phrase in both displayName and spokenName, cleaned only for obvious spacing. Local validator code will do catalog matching later.\n\n"
    + "Hindi numbers: ek=1,do=2,teen=3,char=4,paanch=5,chhe=6,saat=7,aath=8,nau=9,das=10,barah=12,pandrah=15,bees=20,tees=30,pachaas=50,sau=100\n"
    + "Hindi fractions: aadha=0.5,paav=0.25,sawa=1.25,dedh=1.5,dhai=2.5,chataak=0.05\n"
    + "Units: kilo/kg, gram/gm/g, liter/litre/l, ml, piece/pcs, packet/pack/pkt, dozen, box, bottle, pouch, bag, can, tin\n\n"
    + "Speech: \"" + text + "\"\n\n"
    + "=== CRITICAL PRICING RULES ===\n\n"
    + "RULE 1 - WALA/WALI MEANS PER-UNIT RATE:\n"
    + "If a user says 'X wala', 'X wali', 'X rupay wala', 'X rupay wali', 'Rs X wala', or 'Rs X wali', X is the PER-UNIT RATE, not total.\n"
    + "This applies to kg/gm/liter/ml items as well as piece items.\n"
    + "This is a GENERAL rule for any numeric value, not only the examples below. 1 wala, 1 wali, 7 wala, 30 wali, 83 wala, 180 wali, 999 wala all mean per-unit rate.\n"
    + "- \"gehun 5 kg 30 rupay wala\" means qty:5, unit:kg, rate:30, total:150\n"
    + "- \"chawal 50 wala 5kg\" means qty:5, unit:kg, rate:50, total:250\n"
    + "- \"chawal 5kg 50 wala\" means qty:5, unit:kg, rate:50, total:250\n"
    + "- \"chawal 6 kg 60 wali\" means qty:6, unit:kg, rate:60, total:360\n"
    + "- \"toor daal 2 kilo 100 wala\" means qty:2, unit:kg, rate:100, total:200\n"
    + "- \"5kg toor daal 120 wali\" means qty:5, unit:kg, rate:120, total:600\n"
    + "- \"teen Parle-G 10 wala\" means qty:3, unit:piece, rate:10, total:30\n\n"
    + "RULE 2 - KA/KI MEANS TOTAL PRICE:\n"
    + "If a user says 'X ka', 'X ki', 'X rupay ka', or 'X rupay ki', X is the TOTAL price for that line item, not rate.\n"
    + "For loose kg/gm/liter/ml items, if only total price is spoken and no quantity/unit is spoken, do NOT invent qty or unit. Set qty:null and unit:\"\".\n"
    + "This is a GENERAL rule for any numeric value, not only the examples below. 5 ka, 5 ki, 30 ka, 30 ki, 111 ka, 250 ki all mean total price.\n"
    + "- \"chawal 5kg 30 ka\" means qty:5, unit:kg, rate:null, total:30\n"
    + "- \"chawal 5kg 30 ki\" means qty:5, unit:kg, rate:null, total:30\n"
    + "- \"ajwain 10 ka\" means qty:null, unit:\"\", rate:null, total:10\n"
    + "- \"chai patti 20 ki\" means qty:null, unit:\"\", rate:null, total:20\n"
    + "- \"namak 20 rupay ka\" means qty:1, unit:kg, rate:null, total:20\n\n"
    + "RULE 3 - PRICE WITHOUT WALA OR KA:\n"
    + "When a user says a price with quantity but does NOT say 'wala', treat that spoken price as TOTAL, not rate.\n"
    + "- \"5 kg aata 170 rupay\" means qty:5, unit:kg, rate:null, total:170\n"
    + "- \"50 gram jeera 20 rupay\" means qty:50, unit:gm, rate:null, total:20\n"
    + "- \"ajwain 10 rupay\" means qty:1, unit:gm, rate:null, total:10\n"
    + "- \"2 kilo chini 90 rupay\" means qty:2, unit:kg, rate:null, total:90\n"
    + "- \"namak 20 rupay\" means qty:1, unit:kg, rate:null, total:20\n\n"
    + "RULE 4 - DISTINCT VARIANTS BY PRICE:\n"
    + "If the same base product is spoken again with a different explicit rate or a different explicit total, it is a DIFFERENT line item and must NOT be merged.\n"
    + "This rule applies to ALL products, not only chawal. Examples: chawal, gehun, sabun, toor daal, namak, chini, oil, biscuit, anything.\n"
    + "Keep displayName clean and product-only. Do NOT add price text, brackets, '/kg', '/piece', or 'Rs total' inside displayName.\n"
    + "Do NOT assume the price numbers are fixed. The spoken numeric value can be ANY number and must be preserved in rate/total fields only.\n"
    + "- \"chawal 50 wala 5kg\" => displayName:\"Chawal\", rate:50\n"
    + "- \"chawal 5kg 50 wali\" => displayName:\"Chawal\", rate:50\n"
    + "- \"chawal 60 wala 5kg\" => displayName:\"Chawal\", rate:60\n"
    + "- \"toor daal 5kg 120 wala\" => displayName:\"Toor Daal\", rate:120\n"
    + "- \"chawal 30 ka\" => displayName:\"Chawal\", total:30\n"
    + "- \"chawal 5kg 30 ki\" => displayName:\"Chawal\", total:30\n"
    + "- \"sabun 30 rupay\" => displayName:\"Sabun\", total:30\n"
    + "- \"sabun 180 rupay\" => displayName:\"Sabun\", total:180\n"
    + "- \"toor daal 100 wala\" => displayName:\"Toor Daal\", rate:100\n"
    + "If two rows have different explicit rates or totals, return them as separate array entries.\n\n"
    + "RULE 5 - No price mentioned:\n"
    + "If quantity or pack count is spoken but no price is spoken, set rate to defaultPrice and total = qty * defaultPrice.\n"
    + "If speech is ONLY a bare loose-item name with no quantity and no price, such as 'ajwain', 'saunf', 'kali mirch', 'chawal', do NOT assume default price. Return qty:null, unit:\"\", rate:null, total:0, priceType:\"unknown\".\n\n"
    + "Return ONLY a valid JSON array. No markdown, no extra text.\n"
    + "Format: [{\"displayName\":\"chini\",\"spokenName\":\"chini\",\"qty\":2,\"unit\":\"kg\",\"rate\":null,\"total\":90,\"isCustom\":false,\"priceType\":\"total\"}]\n"
    + "- qty can be null when only total price was spoken for loose kg/gm/liter/ml items and no quantity was spoken\n"
    + "- unit can be \"\" when only total price was spoken for loose kg/gm/liter/ml items and no quantity was spoken\n"
    + "- spokenName: exact product phrase from the user speech for that item\n"
    + "- displayName: keep the same spoken product phrase, do not force a catalog rename\n"
    + "- rate: number if per-unit price, null if price was spoken as total\n"
    + "- total: always a number, use 0 only for incomplete bare item speech that needs review\n"
    + "- isCustom: true for unknown products\n"
    + "- priceType: 'rate' if spoken with wala, 'total' if spoken with ka or explicit total price, 'default' if quantity was spoken and default catalog price was used, 'unknown' if bare loose-item speech was incomplete\n"
    + "- Ignore fillers: aur, bhi, ruk, haan, ok, bhai, please";

  try {
    showProcessing(true, "Understanding...");

    var response = await fetch("/.netlify/functions/parse-gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: prompt
      })
    });

    var data = await response.json();
    showProcessing(false);

    if (!response.ok || data.error) {
      throw new Error((data && data.error) || "Parser service failed");
    }
    return normalizeParsedItems(data);
  } catch (error) {
    showProcessing(false);
    console.error(error);
    updateVoiceDebugPanel({ source: "gemini-error", items: error && error.message ? error.message : "Gemini error", commitHistory: true });
    showToast("Parsing failed: " + (error && error.message ? error.message : "Gemini error"), "err");
    return [];
  }
}

function cleanDisplayName(displayName) {
  return String(displayName || "")
    .replace(/\s*\((?:Rs)?[^)]*\)\s*$/i, "")
    .trim();
}

function normalizeParsedItems(items) {
  var normalizedItems = (items || []).map(function(item) {
    var normalizedItem = Object.assign({}, item);
    normalizedItem.displayName = cleanDisplayName(normalizedItem.displayName);
    return normalizedItem;
  });

  if (typeof validateParsedItems === "function") {
    return validateParsedItems(normalizedItems);
  }

  return normalizedItems;
}

async function processVoice(text) {
  var normalizedText = text.toLowerCase().trim();

  if (["ho gaya", "hogaya", "bill bana", "bill banao", "total", "bas", "done", "complete", "khatam", "finish"].some(function(command) {
    return normalizedText.includes(command);
  })) {
    finalizeBill();
    return;
  }

  if (["hatao", "hata do", "last hatao", "pichla hatao", "remove", "undo", "wapas", "delete"].some(function(command) {
    return normalizedText.includes(command);
  })) {
    if (billItems.length > 0) {
      var removed = billItems.pop();
      renderBill();
      showToast("Removed: " + removed.displayName, "info");
    }
    return;
  }

  if (["sab hatao", "clear karo", "sab delete"].some(function(command) {
    return normalizedText.includes(command);
  })) {
    clearBill();
    return;
  }

  var directDecision = tryBuildDirectCatalogItem(text);
  if (directDecision && directDecision.status === "item" && directDecision.item) {
    updateVoiceDebugPanel({ source: "direct-catalog-match", items: formatVoiceDebugItems([directDecision.item]), commitHistory: true });
    addItem(directDecision.item);
    renderBill();
    showToast("1 item added", "ok");
    return;
  }

  if (directDecision && directDecision.status === "incomplete" && directDecision.item) {
    var reviewedItem = typeof validateParsedItems === "function"
      ? (validateParsedItems([directDecision.item])[0] || directDecision.item)
      : directDecision.item;
    updateVoiceDebugPanel({ source: "direct-match-incomplete", items: formatVoiceDebugItems([reviewedItem]), commitHistory: true });
    addItem(reviewedItem);
    renderBill();
    showToast(reviewedItem.displayName + " suna. Qty ya price boliye", "info");
    return;
  }

  var items = await parseWithGemini(text);
  if (items && items.length > 0) {
    updateVoiceDebugPanel({ source: "gemini-parse", items: formatVoiceDebugItems(items), commitHistory: true });
    var reviewCount = items.filter(function(item) {
      return item.needsReview;
    }).length;

    items.forEach(addItem);
    renderBill();

    if (reviewCount > 0) {
      showToast(items.length + " item" + (items.length > 1 ? "s" : "") + " added. " + reviewCount + " need review", "info");
    } else {
      showToast(items.length + " item" + (items.length > 1 ? "s" : "") + " added ✓", "ok");
    }
    return;
  }

  updateVoiceDebugPanel({ source: "gemini-parse", items: "No item parsed", commitHistory: true });
}




