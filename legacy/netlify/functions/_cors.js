/**
 * _cors.js — shared CORS helpers for all Netlify functions.
 * Require this instead of copy-pasting the same logic in every function.
 * Usage: var cors = require("./_cors");
 */

var BASE_CORS_HEADERS_READWRITE = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
};

var BASE_CORS_HEADERS_READWRITE_GET = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
};

function getEventHeader(event, name) {
  var headers = (event && event.headers) || {};
  var target = String(name || "").toLowerCase();
  for (var key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === target) {
      return headers[key];
    }
  }
  return "";
}

function getAllowedOrigin(event) {
  var configuredOrigin = String(
    process.env.ALLOWED_ORIGIN || process.env.URL || process.env.DEPLOY_PRIME_URL || ""
  ).trim().replace(/\/$/, "");

  if (configuredOrigin) {
    return configuredOrigin;
  }

  var host = String(
    getEventHeader(event, "x-forwarded-host") || getEventHeader(event, "host") || ""
  ).trim();

  if (!host) return "";

  var proto = String(getEventHeader(event, "x-forwarded-proto") || "").trim();
  if (!proto) {
    proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? "http" : "https";
  }

  return proto + "://" + host;
}

function buildCorsHeaders(event, includeGet) {
  var base = includeGet ? BASE_CORS_HEADERS_READWRITE_GET : BASE_CORS_HEADERS_READWRITE;
  var headers = Object.assign({}, base);
  var allowedOrigin = getAllowedOrigin(event);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

function isAllowedOrigin(event) {
  var origin = String(getEventHeader(event, "origin") || "").trim().replace(/\/$/, "");
  var allowedOrigin = getAllowedOrigin(event);
  if (!origin || !allowedOrigin) return true;
  return origin === allowedOrigin;
}

module.exports = { getEventHeader, getAllowedOrigin, buildCorsHeaders, isAllowedOrigin };
