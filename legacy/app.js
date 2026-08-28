let billItems = [];
let isListening = false;
let recognition = null;
let currentHistBill = null;
let currentSMSContext = null;
let pendingDeleteHistoryId = null;
let queuedVoiceText = "";
let queuedVoiceTimer = null;
let isVoiceProcessing = false;
let lastHeardTranscript = "";
let speechHadFinalResult = false;
let micRetryTimer = null;
let micRetryCount = 0;
let sheetStack = [];
let ignoreNextSheetPop = false;
let shopName = localStorage.getItem("kb_shopName") || "My Kirana Store";
let shopPhone = localStorage.getItem("kb_shopPhone") || "";
let billLang = localStorage.getItem("kb_billLang") || "en";
window.KB_DEBUG_MODE = /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search) || localStorage.getItem("kb_debug_mode") === "1";

function toggleDebugMode(enabled) {
  localStorage.setItem("kb_debug_mode", enabled ? "1" : "0");
  window.KB_DEBUG_MODE = enabled;
  var panel = document.getElementById("voiceDebugPanel");
  if (panel) panel.hidden = !enabled;
}

var BILL_W = 520;
var BILL_UNITS = ["piece", "kg", "gm", "liter", "ml", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin"];
var TRANSCRIPT_PLACEHOLDER = '"2 kilo chini, teen Parle-G 10 wala"';

function initTheme() {
  applyTheme(localStorage.getItem("kb_theme") || "dark");
}

function applyTheme(themeName) {
  document.documentElement.setAttribute("data-theme", themeName);
  var thumb = document.getElementById("themeThumb");
  if (thumb) {
    thumb.textContent = themeName === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  }
  localStorage.setItem("kb_theme", themeName);
}

function toggleTheme() {
  var nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function getCustomerName() {
  return (document.getElementById("customerName").value || "").trim();
}

function setCustomerClearVisibility(hasValue) {
  document.getElementById("customerClear").classList.toggle("visible", hasValue);
}

function onCustomerInput() {
  setCustomerClearVisibility(Boolean(document.getElementById("customerName").value));
}

function clearCustomer() {
  document.getElementById("customerName").value = "";
  setCustomerClearVisibility(false);
}

function getTopOpenSheetId() {
  while (sheetStack.length) {
    var lastId = sheetStack[sheetStack.length - 1];
    var lastEl = document.getElementById(lastId);

    if (lastEl && lastEl.classList.contains("open")) {
      return lastId;
    }

    sheetStack.pop();
  }

  return null;
}

function openSheet(id, options) {
  var el = document.getElementById(id);
  if (!el) {
    return;
  }

  el.classList.add("open");

  sheetStack = sheetStack.filter(function(sheetId) {
    return sheetId !== id;
  });
  sheetStack.push(id);

  if (options && options.skipHistory) {
    return;
  }

  history.pushState({ kbSheet: id }, "");
}

function closeSheet(id, options) {
  var el = document.getElementById(id);
  if (!el) {
    return;
  }

  el.classList.remove("open");
  sheetStack = sheetStack.filter(function(sheetId) {
    return sheetId !== id;
  });

  if (options && options.skipHistory) {
    return;
  }

  ignoreNextSheetPop = true;
  history.back();
}

function newBill() {
  closeSheet("billSheet");
  clearBill();
  clearCustomer();
}

function showToast(msg, type) {
  var toastType = type || "info";
  var toast = document.getElementById("toast");

  toast.textContent = msg;
  toast.className = "toast show " + toastType;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() {
    toast.classList.remove("show");
  }, 2600);
}

document.addEventListener("DOMContentLoaded", function() {
  history.replaceState({ kbRoot: true }, "");
  initTheme();
  document.getElementById("shopLabel").textContent = shopName;
  setCustomerClearVisibility(Boolean(getCustomerName()));
  var voiceDebugPanel = document.getElementById("voiceDebugPanel");
  if (voiceDebugPanel) {
    voiceDebugPanel.hidden = !window.KB_DEBUG_MODE;
  }
  renderBill();
  if (typeof initializeLearningCloudSync === "function") {
    initializeLearningCloudSync();
  }

  document.querySelectorAll(".sheet-overlay").forEach(function(el) {
    el.addEventListener("click", function(event) {
      if (event.target === el) {
        if (el.id === "smsSheet") {
          closeSMSSheet();
        } else if (el.id === "deleteConfirmSheet") {
          closeDeleteConfirm();
        } else {
          closeSheet(el.id);
        }
      }
    });
  });
});

window.addEventListener("popstate", function() {
  if (ignoreNextSheetPop) {
    ignoreNextSheetPop = false;
    return;
  }

  var topSheetId = getTopOpenSheetId();
  if (!topSheetId) {
    return;
  }

  if (topSheetId === "smsSheet") {
    closeSMSSheet({ skipHistory: true, fromPop: true });
    return;
  }

  if (topSheetId === "deleteConfirmSheet") {
    closeDeleteConfirm({ skipHistory: true });
    return;
  }

  closeSheet(topSheetId, { skipHistory: true });
});
