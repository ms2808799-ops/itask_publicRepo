(() => {
  "use strict";
  const token = localStorage.getItem("itaskToken");
  let user = null;
  try { user = JSON.parse(localStorage.getItem("itaskUser") || "null"); } catch (_) {}
  if (!token || !user || !(user.organizationId || user.organization_id)) return;

  const initials = name => String(name || "Organization").trim().split(/\s+/)
    .filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "OR";
  const escapeSvg = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  function fallbackLogo(name) {
    const letters = escapeSvg(initials(name));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="26" fill="#eef2ff"/><rect x="8" y="8" width="112" height="112" rx="22" fill="#ffffff" stroke="#c7d2fe" stroke-width="3"/><text x="64" y="76" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="700" fill="#3730a3">${letters}</text></svg>`;
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }
  function applyBranding(branding) {
    const name = String(branding.name || "Organization").trim() || "Organization";
    const logo = typeof branding.logo_data_url === "string" && branding.logo_data_url
      ? branding.logo_data_url : fallbackLogo(name);
    document.querySelectorAll("#workspaceSidebarName,[data-organization-name],#previewOrganizationName,.workspace-box .small.fw-semibold,.it-brand span,.navbar-brand span")
      .forEach(el => { el.textContent = name; el.title = name; });
    document.querySelectorAll("#workspaceSidebarBadge,.workspace-badge,[data-organization-badge],#previewOrganizationBadge")
      .forEach(el => {
        let img = el.querySelector("img");
        if (!img) { img = document.createElement("img"); el.replaceChildren(img); }
        img.src = logo; img.alt = `${name} logo`;
        img.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;border-radius:inherit;padding:2px;background:#fff";
      });
    document.querySelectorAll(".it-brand img,.brand .logo-img,a.navbar-brand img.logo-img,.workspace-box img,[data-organization-logo]")
      .forEach(img => { img.src = logo; img.alt = `${name} logo`; img.removeAttribute("srcset"); });
    document.querySelectorAll("[data-organization-name]").forEach(el => el.textContent = name);
  }
  fetch("/api/organization/branding", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (data && data.branding) applyBranding(data.branding); })
    .catch(error => console.warn("Organization branding could not be loaded.", error));
})();