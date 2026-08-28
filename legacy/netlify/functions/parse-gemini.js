var cors = require("./_cors");

var MAX_PROMPT_CHARS = 120000;

// ─── Retry helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isRetryableStatus(code) {
  return code === 429 || code === 503 || code === 500;
}

var GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
var RETRY_DELAYS_MS = [800, 1600, 3200];
var MAX_RETRIES = 3;

// ─── Response helpers ─────────────────────────────────────────────────────────

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  var parsed = Number(value);
  return isNaN(parsed) ? null : parsed;
}

function sanitizeParsedItems(items) {
  if (!Array.isArray(items)) throw new Error("Gemini response was not an array");
  return items.map(function (item) {
    if (!item || typeof item !== "object") throw new Error("Gemini returned an invalid item");
    return {
      displayName: typeof item.displayName === "string" ? item.displayName.trim() : "",
      spokenName: typeof item.spokenName === "string" ? item.spokenName.trim() : "",
      qty: normalizeOptionalNumber(item.qty),
      unit: typeof item.unit === "string" ? item.unit.trim() : "",
      rate: normalizeOptionalNumber(item.rate),
      total: normalizeOptionalNumber(item.total),
      isCustom: Boolean(item.isCustom),
      priceType: typeof item.priceType === "string" ? item.priceType.trim() : ""
    };
  });
}

function extractJsonText(text) {
  return String(text || "").trim().replace(/```json|```/gi, "").trim();
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

  if (!process.env.GEMINI_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Missing GEMINI_API_KEY in Netlify environment variables" }) };
  }

  try {
    var body = JSON.parse(event.body || "{}");
    var prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Prompt is required" }) };
    }

    if (prompt.length > MAX_PROMPT_CHARS) {
      return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: "Prompt is too large" }) };
    }

    // Try flash-lite first (3 attempts), then fall back to flash
    var parsedItems = null;
    var lastError = null;

    outer: for (var m = 0; m < GEMINI_MODELS.length; m++) {
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
                generationConfig: { temperature: 0.1 }
              })
            }
          );

          var data = await response.json();

          if (response.ok && !data.error) {
            var raw = (((data || {}).candidates || [])[0] || {}).content;
            var text = raw && raw.parts && raw.parts[0] && raw.parts[0].text;
            if (!text) {
              lastError = new Error("Gemini returned an empty response");
              break outer;
            }
            parsedItems = sanitizeParsedItems(JSON.parse(extractJsonText(text)));
            break outer;
          }

          lastError = new Error((data && data.error && data.error.message) || "Gemini request failed");
          if (!isRetryableStatus(response.status)) break outer;
        } catch (err) {
          lastError = err;
        }
      }
    }

    if (!parsedItems) {
      throw lastError || new Error("Gemini request failed after all retries");
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedItems) };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error && error.message ? error.message : "Failed to parse with Gemini" })
    };
  }
};
