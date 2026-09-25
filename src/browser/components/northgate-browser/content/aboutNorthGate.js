/* eslint-env browser */

const CATEGORIES = [
  "tracking",
  "fingerprinting",
  "cryptomining",
  "social",
  "cookies",
];

let latestData = null;
// UI state of the explanation section (see setLLMSection).
let llmState = "not-downloaded";
// What the parent last reported about the model: "not-downloaded", "cached"
// (file on disk, checksum not yet verified this session), or "ready".
let modelState = "not-downloaded";
let currentClassification = null;
let currentHost = null;
// Identifies the displayed site and verdict; a change clears stale LLM output.
let currentSiteKey = null;

const LLM_IDLE_STATES = new Set(["not-downloaded", "cached", "ready"]);

function $(id) {
  return document.getElementById(id);
}

function scoreBand(value) {
  if (value >= 80) {
    return "high";
  }
  return value >= 50 ? "mid" : "low";
}

function renderSite(data) {
  const hostEl = $("ngate-site-host");
  const schemeEl = $("ngate-site-scheme");
  if (!data.hasSite) {
    document.l10n.setAttributes(hostEl, "ngate-no-site");
    schemeEl.hidden = true;
    return;
  }
  hostEl.textContent = data.site.host;
  schemeEl.hidden = false;
  const scheme = data.site.isHttps ? "https" : "http";
  schemeEl.dataset.scheme = scheme;
  document.l10n.setAttributes(schemeEl, `ngate-scheme-${scheme}`);
}

function renderScore(score) {
  $("ngate-score-value").textContent = score.value;
  $("ngate-score-grade").textContent = score.grade;
  document.l10n.setAttributes(
    $("ngate-score-label"),
    `ngate-score-desc-${score.grade.toLowerCase()}`
  );
  const meter = $("ngate-score-meter");
  meter.setAttribute("aria-valuenow", score.value);
  $("ngate-score-bar").style.inlineSize = `${score.value}%`;
  $("ngate-score-meter").closest(".ngate-score-card").dataset.band = scoreBand(
    score.value
  );
}

function renderTrackers(trackers) {
  $("ngate-trackers-total").textContent = trackers.total;
  const list = $("ngate-trackers-breakdown");
  list.replaceChildren();
  for (const category of CATEGORIES) {
    const count = trackers.byCategory[category];
    if (!count) {
      continue;
    }
    const li = document.createElement("li");
    const label = document.createElement("span");
    document.l10n.setAttributes(label, `ngate-category-${category}`);
    const value = document.createElement("span");
    value.className = "ngate-count";
    value.textContent = count;
    li.append(label, value);
    list.append(li);
  }
}

function renderClassifier(classification) {
  currentClassification = classification;
  const card = document.querySelector(".ngate-classifier-card");
  const verdictEl = $("ngate-verdict");
  const { verdict, probability, reasons } = classification;
  card.dataset.verdict = verdict;
  verdictEl.dataset.verdict = verdict;
  document.l10n.setAttributes(verdictEl, `ngate-verdict-${verdict}`);
  document.l10n.setAttributes(
    $("ngate-verdict-explain"),
    `ngate-explain-${verdict}`
  );

  const pct = Math.round(probability * 100);
  $("ngate-risk-bar").style.inlineSize = `${pct}%`;
  $("ngate-risk-meter").setAttribute("aria-valuenow", pct);
  document.l10n.setAttributes($("ngate-risk-pct"), "ngate-risk-percent", {
    percent: pct,
  });

  const list = $("ngate-reasons");
  list.replaceChildren();
  const ids = reasons.length ? reasons : ["ngate-reason-none"];
  for (const id of ids) {
    const li = document.createElement("li");
    li.className = "ngate-reason-item";

    const label = document.createElement("span");
    label.className = "ngate-reason-label";
    document.l10n.setAttributes(label, id);

    const detail = document.createElement("p");
    detail.className = "ngate-reason-detail";
    document.l10n.setAttributes(detail, `${id}.detail`);

    li.append(label, detail);
    list.append(li);
  }
}

function renderAlerts(alerts) {
  const list = $("ngate-alerts-list");
  const empty = $("ngate-alerts-empty");
  list.replaceChildren();
  empty.hidden = alerts.length > 0;

  for (const alert of alerts) {
    const li = document.createElement("li");

    const dot = document.createElement("span");
    dot.className = "ngate-alert-dot";
    dot.dataset.severity = alert.severity;

    const body = document.createElement("div");
    body.className = "ngate-alert-body";
    const message = document.createElement("p");
    message.className = "ngate-alert-message";
    if (alert.type === "phishing") {
      document.l10n.setAttributes(message, "ngate-alert-phishing", {
        host: alert.host,
      });
    } else {
      document.l10n.setAttributes(message, "ngate-alert-trackers", {
        host: alert.host,
        count: alert.count,
      });
    }
    body.append(message);

    const time = document.createElement("span");
    time.className = "ngate-alert-time";
    time.textContent = new Date(alert.time).toLocaleTimeString();

    li.append(dot, body, time);
    list.append(li);
  }
}

function setLLMSection(state) {
  llmState = state;
  const button = $("ngate-llm-button");
  const consent = $("ngate-llm-consent");
  const progress = $("ngate-llm-progress");
  const loading = $("ngate-llm-loading");
  const error = $("ngate-llm-error");
  const result = $("ngate-llm-result");

  consent.hidden = state !== "awaiting-consent";
  progress.hidden = state !== "downloading";
  loading.hidden = state !== "generating";
  error.hidden = state !== "error";
  if (state !== "done") {
    result.hidden = true;
  }
  button.disabled = state === "downloading" || state === "generating";
}

function showLLMError() {
  setLLMSection("error");
  document.l10n.setAttributes($("ngate-llm-error"), "ngate-llm-error-generic");
}

/**
 * Clears any explanation, error, or pending consent left over from a
 * previously displayed site. An in-progress download is left alone.
 */
function resetLLMSectionForNewSite() {
  if (llmState !== "downloading") {
    setLLMSection(modelState);
  }
}

function requestExplanation() {
  if (!currentClassification || !currentHost) {
    return;
  }
  if (modelState === "ready") {
    dispatchExplain();
  } else if (modelState === "cached") {
    // Verify the cached model without any network access; the parent replies
    // "not-downloaded" if it fails, and consent is asked for then.
    setLLMSection("generating");
    window.dispatchEvent(
      new CustomEvent("NorthGate:LLMDownload", {
        detail: { allowNetwork: false },
      })
    );
  } else {
    setLLMSection("awaiting-consent");
  }
}

function confirmDownloadAndExplain() {
  setLLMSection("downloading");
  $("ngate-llm-progress-bar").style.inlineSize = "0%";
  window.dispatchEvent(
    new CustomEvent("NorthGate:LLMDownload", {
      detail: { allowNetwork: true },
    })
  );
}

function dispatchExplain() {
  setLLMSection("generating");
  // Only the displayed host is sent, so the parent can detect a site switch;
  // it re-derives the verdict and reasons itself.
  window.dispatchEvent(
    new CustomEvent("NorthGate:LLMExplain", {
      detail: { host: currentHost },
    })
  );
}

function render(data) {
  if (!data) {
    return;
  }
  renderSite(data);
  renderAlerts(data.alerts || []);

  const hasSite = data.hasSite;
  currentHost = hasSite ? data.site.host : null;
  const siteKey = hasSite
    ? JSON.stringify([
        currentHost,
        data.classification.verdict,
        data.classification.reasons,
      ])
    : null;
  if (siteKey !== currentSiteKey) {
    currentSiteKey = siteKey;
    resetLLMSectionForNewSite();
  }
  $("ngate-grid").hidden = !hasSite;
  $("ngate-empty").hidden = hasSite;
  if (hasSite) {
    renderScore(data.privacyScore);
    renderTrackers(data.trackers);
    renderClassifier(data.classification);
  }
}

window.addEventListener("NorthGate:Data", event => {
  latestData = event.detail;
  if (document.readyState !== "loading") {
    render(latestData);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  $("ngate-refresh").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("NorthGate:Refresh"));
  });
  $("ngate-clear").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("NorthGate:ClearAlerts"));
  });

  $("ngate-llm-button").addEventListener("click", requestExplanation);
  $("ngate-llm-consent-confirm").addEventListener(
    "click",
    confirmDownloadAndExplain
  );
  $("ngate-llm-consent-cancel").addEventListener("click", () =>
    setLLMSection(modelState)
  );

  window.addEventListener("NorthGate:LLMStateResult", event => {
    const { enabled, state } = event.detail ?? {};
    $("ngate-llm-explain").hidden = !enabled;
    if (!enabled) {
      return;
    }
    if (state === "ready") {
      modelState = "ready";
    } else if (state === "cached-unverified") {
      modelState = "cached";
    } else {
      modelState = "not-downloaded";
    }
    if (LLM_IDLE_STATES.has(llmState)) {
      setLLMSection(modelState);
    }
  });

  window.addEventListener("NorthGate:LLMProgress", event => {
    if (typeof event.detail?.fraction !== "number") {
      return;
    }
    $("ngate-llm-progress-bar").style.inlineSize = `${Math.round(
      event.detail.fraction * 100
    )}%`;
  });

  window.addEventListener("NorthGate:LLMDownloadResult", event => {
    const state = event.detail?.state;
    if (state === "ready") {
      modelState = "ready";
    } else if (state === "not-downloaded") {
      modelState = "not-downloaded";
    }
    // Ignore replies to a request whose UI was since reset by a site switch.
    if (llmState !== "downloading" && llmState !== "generating") {
      if (LLM_IDLE_STATES.has(llmState)) {
        setLLMSection(modelState);
      }
      return;
    }
    if (state === "ready") {
      dispatchExplain();
    } else if (state === "not-downloaded") {
      // The cached model failed verification; a download needs consent.
      setLLMSection("awaiting-consent");
    } else {
      showLLMError();
    }
  });

  window.addEventListener("NorthGate:LLMExplainResult", event => {
    const detail = event.detail;
    if (!detail || llmState !== "generating") {
      return;
    }
    if (detail.siteChanged) {
      setLLMSection(modelState);
      window.dispatchEvent(new CustomEvent("NorthGate:Refresh"));
      return;
    }
    if (detail.host !== undefined && detail.host !== currentHost) {
      return;
    }
    if (detail.ok) {
      $("ngate-llm-result").textContent = detail.explanation;
      $("ngate-llm-result").hidden = false;
      setLLMSection("done");
    } else {
      showLLMError();
    }
  });

  window.dispatchEvent(new CustomEvent("NorthGate:LLMState"));

  render(latestData);
});
