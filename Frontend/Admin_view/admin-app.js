
(() => {
  "use strict";
  const API_BASE = "";
  const token = localStorage.getItem("itaskToken");
  let currentUser = null;
  const state = { courses: [], users: [], overview: null, logoDataUrl: undefined, logoChanged: false };
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const number = (value) => Number(value || 0).toLocaleString();
  function message(text, type = "info") {
    const host = $("#pageMessage");
    if (host) host.innerHTML = `<div class="it-alert ${type}" role="status">${escapeHtml(text)}</div>`;
  }
  async function api(path, options = {}) {
    if (!token) {
      window.location.href = "../login.html";
      throw new Error("Please sign in again.");
    }
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("itaskToken");
      localStorage.removeItem("itaskUser");
      window.location.href = "../login.html";
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
    return data;
  }
  function guard() {
    let user;
    try { user = JSON.parse(localStorage.getItem("itaskUser") || "null"); } catch { user = null; }
    if (!user || user.accountType !== "organization" || user.role !== "admin") {
      message("This area is available to organization administrators only.", "error");
      setTimeout(() => { window.location.href = "../login.html"; }, 900);
      return false;
    }
    currentUser = user;
    const name = user.full_name || user.fullName || "Organization admin";
    if ($("#adminName")) $("#adminName").textContent = name;
    if ($("#adminAvatar")) $("#adminAvatar").textContent = name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    return true;
  }
  function empty(text) {
    return `<div class="it-empty"><i class="fa-regular fa-folder-open d-block"></i><div class="fw-semibold">${escapeHtml(text)}</div></div>`;
  }
  function renderStats() {
    const o = state.overview || {};
    const cards = [
      ["Students", o.students_count, "fa-user-graduate", "Enrolled learners"],
      ["Doctors", o.doctors_count, "fa-chalkboard-user", "Teaching staff"],
      ["Courses", o.courses_count, "fa-book-open", "Organization courses"],
      ["Assignments", o.assignments_count, "fa-file-lines", "Created assignments"],
      ["Submissions", o.submissions_count, "fa-paper-plane", "Student submissions"],
      ["Awaiting grading", o.ungraded_count, "fa-clipboard-check", "Ungraded submissions"]
    ];
    $("#statsGrid").innerHTML = cards.map(([label, value, icon, foot]) => `
      <div class="col-sm-6 col-xl-4"><article class="it-card">
        <div class="d-flex justify-content-between align-items-start"><div class="it-stat-label">${label}</div><div class="it-stat-icon"><i class="fa-solid ${icon}"></i></div></div>
        <div class="it-stat-value">${number(value)}</div><div class="it-stat-foot">${foot}</div>
      </article></div>`).join("");
  }
  function renderCoursePreview() {
    const host = $("#coursePreview");
    if (!state.courses.length) { host.innerHTML = empty("No courses found for this organization."); return; }
    host.innerHTML = `<div class="table-responsive it-table-wrap"><table class="table it-table"><thead><tr><th>Course</th><th>Doctor</th><th>Students</th></tr></thead><tbody>${
      state.courses.slice(0, 5).map(c => `<tr><td><div class="it-name">${escapeHtml(c.name)}</div><div class="it-muted">${escapeHtml(c.description || "No description")}</div></td><td>${escapeHtml(c.doctor_name || "Unassigned")}</td><td><span class="it-badge">${number(c.enrolled_students)}</span></td></tr>`).join("")
    }</tbody></table></div>`;
  }
  function renderPeoplePreview() {
    const host = $("#peoplePreview");
    if (!state.users.length) { host.innerHTML = empty("No users found."); return; }
    host.innerHTML = `<div class="d-grid gap-3">${state.users.slice(0, 6).map(u => `
      <div class="d-flex align-items-center gap-3"><div class="it-avatar">${escapeHtml((u.full_name || "?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</div>
      <div class="flex-grow-1 min-w-0"><div class="it-name">${escapeHtml(u.full_name)}</div><div class="it-muted">${escapeHtml(u.email)}</div></div>
      <span class="it-badge">${escapeHtml(u.role)}</span></div>`).join("")}</div>`;
  }
  function renderCourses() {
    const query = ($("#courseSearch")?.value || "").trim().toLowerCase();
    const rows = state.courses.filter(c => [c.name, c.description, c.doctor_name].some(v => String(v || "").toLowerCase().includes(query)));
    $("#courseCount").textContent = `${rows.length} course${rows.length === 1 ? "" : "s"} shown`;
    $("#coursesTable").innerHTML = rows.length ? `<div class="table-responsive it-table-wrap"><table class="table it-table"><thead><tr><th>Course</th><th>Assigned doctor</th><th>Students</th><th>Assignments</th><th>Created</th></tr></thead><tbody>${rows.map(c => `
      <tr><td><div class="it-name">${escapeHtml(c.name)}</div><div class="it-muted">${escapeHtml(c.description || "No description provided")}</div></td>
      <td>${escapeHtml(c.doctor_name || "Unassigned")}</td><td><span class="it-badge">${number(c.enrolled_students)}</span></td>
      <td><span class="it-badge">${number(c.assignments_count)}</span></td><td>${c.created_at ? escapeHtml(new Date(c.created_at).toLocaleDateString()) : "—"}</td></tr>`).join("")}</tbody></table></div>` : empty(query ? "No courses match your search." : "No courses found.");
  }
  function renderUsers() {
    const query = ($("#userSearch")?.value || "").trim().toLowerCase();
    const role = $("#roleFilter")?.value || "all";
    const rows = state.users.filter(u => (role === "all" || u.role === role) && [u.full_name, u.email, u.role].some(v => String(v || "").toLowerCase().includes(query)));
    const studentCount = $("#studentCount");
    if (studentCount) studentCount.textContent = number(state.users.filter(u => u.role === "student").length);
    $("#userCount").textContent = `${rows.length} user${rows.length === 1 ? "" : "s"} shown`;
    $("#usersTable").innerHTML = rows.length ? `<div class="table-responsive it-table-wrap"><table class="table it-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>${rows.map(u => `
      <tr><td><div class="d-flex align-items-center gap-3"><div class="it-avatar">${escapeHtml((u.full_name || "?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</div><div class="it-name">${escapeHtml(u.full_name)}</div></div></td>
      <td>${escapeHtml(u.email)}</td><td><span class="it-badge">${escapeHtml(u.role)}</span></td><td>${u.created_at ? escapeHtml(new Date(u.created_at).toLocaleDateString()) : "—"}</td></tr>`).join("")}</tbody></table></div>` : empty(query || role !== "all" ? "No users match these filters." : "No users found.");
  }
  async function loadDashboard() {
    try {
      const [overview, courses, users] = await Promise.all([
        api("/api/admin/overview"), api("/api/admin/courses"), api("/api/admin/users")
      ]);
      state.overview = overview.overview || {};
      state.courses = Array.isArray(courses.courses) ? courses.courses : [];
      state.users = Array.isArray(users.users) ? users.users : [];
      renderStats(); renderCoursePreview(); renderPeoplePreview();
      message("Dashboard updated from live organization data.", "success");
    } catch (error) {
      $("#statsGrid").innerHTML = `<div class="col-12">${empty("Unable to load dashboard metrics.")}</div>`;
      $("#coursePreview").innerHTML = empty("Course data could not be loaded.");
      $("#peoplePreview").innerHTML = empty("User data could not be loaded.");
      message(error.message || "Unable to load dashboard.", "error");
    }
  }
  async function loadCourses() {
    try { const data = await api("/api/admin/courses"); state.courses = Array.isArray(data.courses) ? data.courses : []; renderCourses(); message("Courses loaded from the API.", "success"); }
    catch (error) { $("#coursesTable").innerHTML = empty("Course data could not be loaded."); message(error.message || "Unable to load courses.", "error"); }
  }
  async function loadUsers() {
    try { const data = await api("/api/admin/users"); state.users = Array.isArray(data.users) ? data.users : []; renderUsers(); message("Users loaded from the API.", "success"); }
    catch (error) { $("#usersTable").innerHTML = empty("User data could not be loaded."); message(error.message || "Unable to load users.", "error"); }
  }
  function applyBrandPreview(settings) {
    const name = settings.name || "Organization";
    const color = settings.primary_color || "#1E3ABA";
    const nameInput = $("#workspaceName");
    const colorInput = $("#primaryColor");
    if (nameInput) nameInput.value = name;
    if (colorInput) colorInput.value = color;
    const hex = $("#primaryColorHex");
    if (hex) hex.value = color;
    const previewName = $("#previewOrganizationName");
    if (previewName) previewName.textContent = name;
    const sidebarName = $("#workspaceSidebarName");
    if (sidebarName) sidebarName.textContent = name;
    const sidebarBadge = $("#workspaceSidebarBadge");
    if (sidebarBadge) {
      if (state.logoDataUrl) {
        let image = sidebarBadge.querySelector("img");
        if (!image) { image = document.createElement("img"); sidebarBadge.replaceChildren(image); }
        image.src = state.logoDataUrl; image.alt = name + " logo";
        image.style.cssText = "width:100%;height:100%;object-fit:contain;background:#fff;border-radius:inherit;padding:2px";
      } else {
        sidebarBadge.textContent = name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
      }
      sidebarBadge.style.backgroundColor = color;
    }
    const badge = $("#previewOrganizationBadge");
    if (badge) {
      if (state.logoDataUrl) {
        let image = badge.querySelector("img");
        if (!image) { image = document.createElement("img"); badge.replaceChildren(image); }
        image.src = state.logoDataUrl; image.alt = name + " logo";
        image.style.cssText = "width:100%;height:100%;object-fit:contain;background:#fff;border-radius:inherit;padding:2px";
      } else badge.textContent = name.trim().split(/\\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
      badge.style.backgroundColor = color;
    }
    const portalButton = $("#previewPortalButton");
    if (portalButton) portalButton.style.backgroundColor = color;
    document.documentElement.style.setProperty("--itask-primary", color);
    document.documentElement.style.setProperty("--bs-primary", color);
    const logoPreview = $("#organizationLogoPreview");
    const logoFallback = $("#organizationLogoFallback");
    if (logoPreview && logoFallback) {
      if (state.logoDataUrl) { logoPreview.src = state.logoDataUrl; logoPreview.hidden = false; logoFallback.hidden = true; }
      else { logoPreview.hidden = true; logoFallback.hidden = false; }
    }
  }
  async function loadSettings() {
    try {
      const data = await api("/api/admin/settings");
      state.logoDataUrl = data.settings?.logo_data_url || null;
      state.logoChanged = false;
      applyBrandPreview(data.settings || {});
      message("", "");
    } catch (error) {
      message(error.message || "Could not load organization settings.", "error");
    }
  }
  async function saveSettings(event) {
    event?.preventDefault();
    const name = $("#workspaceName")?.value.trim() || "";
    const primary_color = $("#primaryColor")?.value || "";
    const logo_data_url = state.logoDataUrl === undefined ? undefined : state.logoDataUrl;
    const saveButton = $("#saveSettingsButton");
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = "Saving..."; }
    try {
      const body = { name, primary_color };
      // Only send logo_data_url when the user explicitly selected or removed a logo.
      // Omitting it preserves the existing database value.
      if (state.logoChanged) body.logo_data_url = logo_data_url || "";
      const data = await api("/api/admin/settings", { method: "PATCH", body });
      state.logoDataUrl = data.settings?.logo_data_url || null;
      applyBrandPreview(data.settings || { name, primary_color });
      message("Settings saved to the database.", "success");
    } catch (error) {
      message(error.message || "Could not save organization settings.", "error");
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = "Save changes"; }
    }
  }
  function init(page) {
    if (!guard()) return;
    $("#logoutBtn")?.addEventListener("click", () => {
      localStorage.removeItem("itaskToken"); localStorage.removeItem("itaskUser");
      window.location.href = "../login.html";
    });
    if (page === "dashboard") loadDashboard();
    if (page === "courses") { $("#courseSearch").addEventListener("input", renderCourses); loadCourses(); }
    if (page === "users") { $("#userSearch").addEventListener("input", renderUsers); $("#roleFilter").addEventListener("change", renderUsers); loadUsers(); }
    if (page === "settings") {
      $("#settingsForm")?.addEventListener("submit", saveSettings);
      $("#primaryColor")?.addEventListener("input", () => {
        const color = $("#primaryColor").value;
        if (/^#[0-9a-fA-F]{6}$/.test(color)) {
          const hex = $("#primaryColorHex"); if (hex) hex.value = color.toUpperCase();
          const previewName = $("#previewOrganizationName");
          const badge = $("#previewOrganizationBadge");
          const portalButton = $("#previewPortalButton");
          if (badge) badge.style.backgroundColor = color;
          if (portalButton) portalButton.style.backgroundColor = color;
          document.documentElement.style.setProperty("--itask-primary", color);
        }
      });
      $("#organizationLogoFile")?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        const host = $("#logoMessage");
        if (!file) return;
        if (!/^(image\/(png|jpeg|webp))$/.test(file.type) || file.size > 650 * 1024) {
          if (host) host.textContent = "Choose a PNG, JPG, or WebP image no larger than 650 KB.";
          event.target.value = ""; return;
        }
        try {
          state.logoDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read the selected image.")); reader.readAsDataURL(file);
          });
          state.logoChanged = true;
          const preview = $("#organizationLogoPreview"), fallback = $("#organizationLogoFallback");
          if (preview) { preview.src = state.logoDataUrl; preview.hidden = false; }
          if (fallback) fallback.hidden = true;
          if (host) host.textContent = "Logo preview ready. Click Save changes to apply it.";
        } catch (error) { if (host) host.textContent = error.message; }
      });
      $("#removeOrganizationLogo")?.addEventListener("click", () => {
        state.logoDataUrl = "";
        state.logoChanged = true;
        const preview = $("#organizationLogoPreview"), fallback = $("#organizationLogoFallback");
        if (preview) preview.hidden = true; if (fallback) fallback.hidden = false;
        const host = $("#logoMessage"); if (host) host.textContent = "Logo removal selected. Click Save changes to apply it.";
      });
      $("#workspaceName")?.addEventListener("input", () => {
        const previewName = $("#previewOrganizationName");
        if (previewName) previewName.textContent = $("#workspaceName").value.trim() || "Organization";
        const badge = $("#previewOrganizationBadge");
        if (badge) badge.textContent = ($("#workspaceName").value.trim().split(/\s+/).map(part => part[0]).join("") || "O").slice(0,2).toUpperCase();
      });
      loadSettings();
    }
  }
  window.ITaskAdmin = { init };
})();
