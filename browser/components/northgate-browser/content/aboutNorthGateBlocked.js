/* eslint-env browser */

function params() {
  const search = new URLSearchParams(document.location.search);
  return {
    url: search.get("url") || "",
    score: parseFloat(search.get("score") || "0"),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_e) {
    return url;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const { url, score } = params();

  document.getElementById("ngate-blocked-host").textContent = hostOf(url);
  document.l10n.setAttributes(
    document.getElementById("ngate-blocked-risk"),
    "ngate-blocked-risk-value",
    { percent: Math.round(score * 100) }
  );

  document.getElementById("ngate-blocked-back").addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "about:home";
    }
  });

  document
    .getElementById("ngate-blocked-proceed")
    .addEventListener("click", () => {
      // Hand off to the parent guard: allow-list this URL for the session and
      // continue the load. The guard performs the navigation.
      window.dispatchEvent(
        new CustomEvent("NorthGateBlocked:Proceed", {
          detail: { url },
          bubbles: true,
        })
      );
    });
});
