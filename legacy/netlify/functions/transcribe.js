var cors = require("./_cors");

var MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// ─── Retry helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isRetryableStatus(code) {
  return code === 429 || code === 503 || code === 500;
}

var RETRY_DELAYS_MS = [800, 1600, 3200];
var MAX_RETRIES = 3;

// ─── Transcription prompt ─────────────────────────────────────────────────────

var TRANSCRIPTION_PROMPT = [
  "Indian kirana billing speech with Hindi-English mixing.",
  "Keep grocery and spice names exact when possible.",
  "Common words: ajwain, ajvayan, saunf, sonf, soff, kali mirch, kalimirch, kanki, kanaki, chawal, chai patti, sonth.",
  "Keep quantities, rates, wala, wali, ka, ki, rupees, packet, piece, kg and gram exact.",
  "Return Hindi words only in Devanagari or plain Latin script.",
  "Do not use Urdu or Perso-Arabic script.",
  "Examples in Hindi: \u0905\u091c\u0935\u093e\u0907\u0928 10 \u0915\u0940, \u0938\u094c\u0902\u092b 10 \u0915\u093e, \u0915\u093e\u0932\u0940 \u092e\u093f\u0930\u094d\u091a, \u091a\u093e\u092f \u092a\u0924\u094d\u0924\u0940, \u0915\u0928\u0915\u0940, \u091a\u093e\u0935\u0932, \u0909\u095c\u0926 \u092e\u094b\u0917\u0930, \u092e\u0942\u0902\u0917 \u092e\u094b\u0917\u0930, \u092c\u0930\u092c\u091f\u0940 \u0926\u093e\u0932, \u0917\u0947\u0939\u0942\u0902, \u091a\u093e\u0935\u0932 \u0915\u093e \u0915\u091f\u094d\u091f\u093e."
].join(" ");

// ─── Arabic script helpers ────────────────────────────────────────────────────

function hasArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function extractDigitTokens(value) {
  return String(value || "").match(/\d+(?:\.\d+)?/g) || [];
}

function looksLikeSafeScriptRewrite(originalText, rewrittenText) {
  if (!rewrittenText || hasArabicScript(rewrittenText)) return false;
  var originalDigits = extractDigitTokens(originalText).join("|");
  var rewrittenDigits = extractDigitTokens(rewrittenText).join("|");
  return originalDigits === rewrittenDigits;
}

// Calls Gemini to convert Arabic/Urdu script to Devanagari. Has its own retry loop.
async function rewriteArabicScriptHindi(text) {
  if (!text || !process.env.GEMINI_API_KEY) return text;

  var GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
  var prompt =
    "Transliterate this Hindi kirana transcript into Devanagari or plain Latin Hindi only. " +
    "Do not translate, summarize, normalize, or change item names, numbers, quantities, prices, " +
    "wala/wali/ka/ki words, punctuation, or order. Convert script only. Return only one line of transcript text.\n\nTranscript: " +
    text;

  for (var m = 0; m < GEMINI_MODELS.length; m++) {
    var model = GEMINI_MODELS[m];
    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        var response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0 }
            })
          }
        );
        var data = await response.json();
        if (response.ok && !data.error) {
          var rewritten = (((data || {}).candidates || [])[0] || {}).content;
          var nextText = rewritten && rewritten.parts && rewritten.parts[0] && rewritten.parts[0].text;
          if (typeof nextText === "string" && nextText.trim()) {
            nextText = nextText.trim();
            return looksLikeSafeScriptRewrite(text, nextText) ? nextText : text;
          }
          return text;
        }
        if (!isRetryableStatus(response.status)) break;
      } catch (err) {
        // network error — retry
      }
    }
  }

  return text; // silently return original if all attempts fail
}

// ─── Audio format helper ──────────────────────────────────────────────────────

function getFileExtension(mimeType) {
  var t = String(mimeType || "").toLowerCase();
  if (t.indexOf("webm") !== -1) return "webm";
  if (t.indexOf("mp4") !== -1 || t.indexOf("m4a") !== -1) return "mp4";
  if (t.indexOf("mpeg") !== -1 || t.indexOf("mp3") !== -1) return "mp3";
  if (t.indexOf("wav") !== -1) return "wav";
  return "webm";
}

// ─── Groq Whisper with retry ──────────────────────────────────────────────────

async function transcribeWithGroq(audioBuffer, mimeType) {
  var lastError = null;

  for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    var form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: mimeType }), "speech." + getFileExtension(mimeType));
    form.append("model", "whisper-large-v3");
    form.append("response_format", "json");
    form.append("language", "hi");
    form.append("prompt", TRANSCRIPTION_PROMPT);

    try {
      var response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.GROQ_API_KEY },
        body: form
      });

      var data = await response.json();

      if (response.ok && !data.error) {
        var text = typeof data.text === "string" ? data.text.trim() : "";
        if (!text) throw new Error("Transcription returned empty text");
        return text;
      }

      lastError = new Error((data && data.error && data.error.message) || "Transcription request failed");
      if (!isRetryableStatus(response.status)) break;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Transcription failed after all retries");
}

// ─── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  var corsHeaders = cors.buildCorsHeaders(event, false);

  if (!cors.isAllowedOrigin(event)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "Origin not allowed" }) };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  if (!process.env.GROQ_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Missing GROQ_API_KEY in environment variables" }) };
  }

  try {
    var body = JSON.parse(event.body || "{}");
    var audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
    var mimeType = typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : "audio/webm";

    if (!audioBase64) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Audio data is required" }) };
    }

    var audioBuffer = Buffer.from(audioBase64, "base64");

    if (!audioBuffer.length) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Audio payload is empty" }) };
    }

    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: "Audio file is too large" }) };
    }

    // Step 1: Transcribe with Groq Whisper (3 retries with backoff)
    var text = await transcribeWithGroq(audioBuffer, mimeType);

    // Step 2: If output has Arabic/Urdu script, rewrite to Devanagari (3 retries + fallback model)
    if (hasArabicScript(text)) {
      text = await rewriteArabicScriptHindi(text);
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ text: text }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error && error.message ? error.message : "Failed to transcribe audio" })
    };
  }
};
