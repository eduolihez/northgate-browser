/* eslint-env browser */

const CATEGORIES = [
  "tracking",
  "fingerprinting",
  "cryptomining",
  "social",
  "cookies",
];

let latestData = null;
let llmState = "not-downloaded";
let currentClassification = null;

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

function requestExplanation() {
  if (!currentClassification) {
    return;
  }
  if (llmState === "ready" || llmState === "done") {
    dispatchExplain();
  } else {
    setLLMSection("awaiting-consent");
  }
}

function confirmDownloadAndExplain() {
  setLLMSection("downloading");
  $("ngate-llm-progress-bar").style.inlineSize = "0%";
  window.dispatchEvent(new CustomEvent("NorthGate:LLMDownload"));
}

function dispatchExplain() {
  setLLMSection("generating");
  window.dispatchEvent(
    new CustomEvent("NorthGate:LLMExplain", {
      detail: {
        verdict: currentClassification.verdict,
        probability: currentClassification.probability,
        reasons: currentClassification.reasons,
      },
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
    setLLMSection(llmState === "ready" ? "ready" : "not-downloaded")
  );

  // NorthGate:LLMState/LLMDownload/LLMExplain are each used both for this
  // page's outbound trigger dispatch and for the child actor's inbound
  // response dispatch (same event name, same `window` target), so
  // dispatching one of these events from this file also re-invokes these
  // very listeners synchronously with no meaningful detail (or, for
  // LLMExplain, with the outbound request payload instead of a result).
  // Each listener below checks for the actual response shape before
  // acting, so a spurious self-triggered firing is a no-op.
  window.addEventListener("NorthGate:LLMState", event => {
    if (typeof event.detail?.state !== "string") {
      return;
    }
    setLLMSection(event.detail.state === "ready" ? "ready" : "not-downloaded");
  });

  window.addEventListener("NorthGate:LLMProgress", event => {
    if (typeof event.detail?.fraction !== "number") {
      return;
    }
    $("ngate-llm-progress-bar").style.inlineSize = `${Math.round(
      event.detail.fraction * 100
    )}%`;
  });

  window.addEventListener("NorthGate:LLMDownload", event => {
    if (typeof event.detail?.state !== "string") {
      return;
    }
    if (event.detail.state === "ready") {
      dispatchExplain();
    } else {
      setLLMSection("error");
      document.l10n.setAttributes($("ngate-llm-error"), "ngate-llm-error-generic");
    }
  });

  window.addEventListener("NorthGate:LLMExplain", event => {
    if (typeof event.detail?.ok !== "boolean") {
      return;
    }
    if (event.detail.ok) {
      $("ngate-llm-result").textContent = event.detail.explanation;
      $("ngate-llm-result").hidden = false;
      setLLMSection("done");
    } else {
      setLLMSection("error");
      document.l10n.setAttributes($("ngate-llm-error"), "ngate-llm-error-generic");
    }
  });

  window.dispatchEvent(new CustomEvent("NorthGate:LLMState"));

  render(latestData);
});
