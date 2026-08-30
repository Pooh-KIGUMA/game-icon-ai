(() => {
  const KEY = "iconia_visitor_id_v1";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 128);
    localStorage.setItem(KEY, id);
  }

  function track(event, metadata = {}) {
    try {
      const payload = JSON.stringify({
        event,
        path: location.pathname,
        referrer: document.referrer || "",
        metadata,
      });
      fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Iconia-Visitor": id },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  }

  track("page_view", { title: document.title });

  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("/pricing")) track("pricing_click");
    else if (href.startsWith("/guide")) track("guide_click");
    else if (href.startsWith("/about")) track("about_click");
    else if (href.startsWith("/faq")) track("faq_click");
  }, { passive: true });

  window.IconiaAnalytics = { track };
})();
