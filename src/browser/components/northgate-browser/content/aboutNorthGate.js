/* eslint-env browser */

const CATEGORIES = [
  "tracking",
  "fingerprinting",
  "cryptomining",
  "social",
  "cookies",
];

let latestData = null;

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
    document.l10n.setAttributes(li, id);
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
  render(latestData);
});
