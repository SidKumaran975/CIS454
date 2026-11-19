const state = {
  jobs: [],
  sources: [],
  profile: null,
  settings: null,
  metrics: {},
  latestRun: null,
  view: "discover",
  query: "",
  location: "all",
  type: "all",
  highMatchOnly: false,
  collecting: false,
  importedProfile: null,
  gmail: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function relativeTime(value) {
  if (!value) return "recently";
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function filteredJobs() {
  return state.jobs.filter((job) => {
    const haystack = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
    const viewMatch = state.view === "discover" ? job.status !== "dismissed"
      : state.view === "urgent" ? job.isUrgent && !["dismissed", "applied"].includes(job.status)
      : job.status === state.view;
    const queryMatch = haystack.includes(state.query.toLowerCase());
    const locationMatch = state.location === "all"
      || (state.location === "remote" && job.workplace.toLowerCase() === "remote")
      || (state.location === "new-york" && job.location.toLowerCase().includes("new york"))
      || (state.location === "boston" && job.location.toLowerCase().includes("boston"));
    const typeMatch = state.type === "all"
      || job.type.toLowerCase().replace(/\s+/g, "-").startsWith(state.type);
    const scoreMatch = !state.highMatchOnly || job.score >= state.profile.minimumScore;
    return viewMatch && queryMatch && locationMatch && typeMatch && scoreMatch;
  }).sort((a, b) => {
    const aTime = new Date(a.sourceUpdatedAt || a.firstSeenAt || 0).getTime();
    const bTime = new Date(b.sourceUpdatedAt || b.firstSeenAt || 0).getTime();
    return bTime - aTime || b.score - a.score;
  });
}

function sourceLabel(job) {
  if (job.provider === "greenhouse") return "Greenhouse";
  if (job.provider === "lever") return "Lever";
  return job.alertPlatform || "Email alert";
}

function provenanceLabel(job) {
  if (!job.alertName) return "";
  const count = job.observationCount > 1 ? ` · seen ${job.observationCount} times` : "";
  return `<span class="job-provenance">Found by “${escapeHTML(job.alertName)}”${count}</span>`;
}

function renderJobs() {
  const result = filteredJobs();
  $("#result-count").textContent = `${result.length} ${result.length === 1 ? "live role" : "live roles"} · newest first`;
  if (!result.length) {
    $("#job-list").innerHTML = `<div class="empty-state"><strong>No stored jobs match these filters.</strong><br>${state.collecting ? "The live collection is still running." : "Try clearing filters or collect again."}</div>`;
    return;
  }
  $("#job-list").innerHTML = result.map((job) => `
    <article class="job-card" data-id="${job.id}">
      <div class="company-logo">${escapeHTML(job.company.slice(0, 1))}</div>
      <div class="job-main">
        <div class="job-title-row">
          <button class="job-title" data-open="${job.id}">${escapeHTML(job.title)}</button>
          ${job.isUrgent ? '<span class="urgent-badge">⚡ APPLY NOW</span>' : ''}
          ${relativeTime(job.firstSeenAt).includes("h ago") || relativeTime(job.firstSeenAt).includes("m ago") ? '<span class="new-badge">NEW</span>' : ''}
        </div>
        <div class="job-company">${escapeHTML(job.company)} · ${escapeHTML(job.location || "Location not listed")}</div>
        <div class="job-meta"><span>${escapeHTML(job.workplace)}</span><span>${escapeHTML(job.type)}</span>${job.salary ? `<span>${escapeHTML(job.salary)}</span>` : ""}</div>
        <div class="job-footer">
          <span class="job-source">${escapeHTML(sourceLabel(job))} · synced ${escapeHTML(relativeTime(job.sourceUpdatedAt || job.firstSeenAt))}</span>
          <div class="job-actions">
            <button class="small-action ${job.status === "saved" ? "saved" : ""}" data-save="${job.id}">${job.status === "saved" ? "♥ Saved" : "♡ Save"}</button>
            <button class="small-action" data-dismiss="${job.id}">Dismiss</button>
          </div>
        </div>
        ${provenanceLabel(job)}
      </div>
      <div class="match-score"><div class="match-ring" style="--score:${job.score}"><strong>${job.score}%</strong></div><span>Match</span></div>
    </article>`).join("");
}

function renderMetrics() {
  const metrics = state.metrics;
  $("#metric-new").textContent = metrics.urgent || 0;
  $("#metric-saved").textContent = metrics.saved || 0;
  $("#metric-applied").textContent = metrics.applied || 0;
  $("#metric-sources").textContent = state.sources.filter((source) => source.enabled).length;
  $("#new-count").textContent = metrics.matches || 0;
  $("#urgent-count").textContent = metrics.urgent || 0;
  $("#saved-count").textContent = metrics.saved || 0;
  $("#applied-count").textContent = metrics.applied || 0;
  const topScore = state.jobs.length ? Math.max(...state.jobs.map((job) => job.score)) : null;
  $("#top-score").textContent = topScore ?? "—";
  $("#hero-title").textContent = `${metrics.matches || 0} live matches in your database`;
  const atsBoards = state.sources.filter((source) => ["greenhouse", "lever"].includes(source.provider)).length;
  $("#hero-description").textContent = `${metrics.active || 0} active listings from ${atsBoards} ATS boards plus your local email-alert inbox. No sample jobs are used.`;
}

function renderSources() {
  const healthy = state.sources.filter((source) => source.last_status === "healthy").length;
  $("#source-health-label").textContent = `${healthy}/${state.sources.length} healthy`;
  $("#source-list").innerHTML = state.sources.map((source) => `
    <div class="source-row">
      <span class="source-logo ${escapeHTML(source.provider)}">${source.provider === "greenhouse" ? "G" : source.provider === "lever" ? "L" : "@"}</span>
      <div><strong>${escapeHTML(source.name)}</strong><small>${source.job_count} live jobs · ${escapeHTML(source.last_status)}</small></div>
      <span class="source-dot ${source.last_status === "healthy" ? "" : "error"}"></span>
    </div>`).join("");
}

function renderProfile() {
  const profile = state.profile;
  $(".profile-role").textContent = profile.targetRole.replace(/^Entry-level\s+/i, "");
  $(".tag-list").innerHTML = [...profile.employmentTypes, ...profile.location.split(/\s+or\s+/i).slice(0, 2)].filter(Boolean).map((item) => `<span>${escapeHTML(item)}</span>`).join("");
  const skills = profile.skills.slice(0, 3).map((skill) => `<span>${escapeHTML(skill)}</span>`);
  if (profile.skills.length > 3) skills.push(`<span>+${profile.skills.length - 3}</span>`);
  $(".skill-row").innerHTML = skills.join("");
  $("#profile-role-input").value = profile.targetRole;
  $("#profile-location-input").value = profile.location;
  $("#profile-skills-input").value = profile.skills.join(", ");
  $("#profile-score-input").value = String(profile.minimumScore);
  $("#match-filter").textContent = `${profile.minimumScore}+ match`;
  $("#identity-name").value = profile.fullName || "";
  $("#identity-headline").value = profile.headline || "";
  $("#identity-email").value = profile.email || "";
  $("#identity-phone").value = profile.phone || "";
  $("#identity-experience").value = profile.experienceYears ?? 0;
  $("#identity-education").value = profile.education || "";
  $("#identity-skills").value = profile.skills.join(", ");
  $("#identity-certifications").value = profile.certifications.join(", ");
  $("#identity-summary").value = profile.professionalSummary || "";
  $("#identity-authorization").value = profile.workAuthorization || "";
  $("#identity-clearance").value = profile.securityClearance || "";
  $("#identity-languages").value = profile.languages.join(", ");
  $("#identity-links").value = profile.links.join(", ");
  $("#intent-name").value = profile.targetRole;
  $("#intent-titles").value = (profile.roleTitles.length ? profile.roleTitles : [profile.targetRole]).join(", ");
  $("#intent-location").value = profile.location;
  $("#intent-seniority").value = profile.seniority;
  $("#intent-employment").value = profile.employmentTypes.join(", ");
  $("#intent-industries").value = profile.industries.join(", ");
  $("#intent-keywords").value = profile.desiredKeywords.join(", ");
  $("#intent-excluded").value = profile.excludedKeywords.join(", ");
  $("#intent-score").value = String(profile.minimumScore);
  $(".profile-mini strong").textContent = profile.fullName || "Local profile";
  $(".profile-mini span").textContent = profile.seniority || "Job search";
  const initials = (profile.fullName || "User").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  $(".profile-mini .avatar").textContent = initials || "U";
  if ($("#profile-page").hidden) {
    $("#page-title").textContent = profile.fullName ? `Good morning, ${profile.fullName.split(/\s+/)[0]}` : "Good morning";
  }
  renderRichProfile(profile);
}

function entryHTML(primary, secondary, detail) {
  return `<div class="profile-entry"><strong>${escapeHTML(primary || "Untitled entry")}</strong>${secondary ? `<span>${escapeHTML(secondary)}</span>` : ""}${detail ? `<small>${escapeHTML(detail)}</small>` : ""}</div>`;
}

function renderEntryList(selector, countSelector, entries, formatter, emptyText) {
  $(countSelector).textContent = entries.length;
  $(selector).innerHTML = entries.length ? entries.map(formatter).join("") : `<div class="profile-entry-empty">${escapeHTML(emptyText)}</div>`;
}

function renderRichProfile(profile) {
  renderEntryList("#experience-list", "#experience-count", profile.workExperience, (item) => entryHTML(
    item.title, [item.company, item.location].filter(Boolean).join(" · "),
    [item.startDate && item.endDate ? `${item.startDate}–${item.endDate}` : item.startDate || item.endDate, ...(item.bullets || []).slice(0, 2)].filter(Boolean).join(" · ")
  ), "Upload a CV or LinkedIn PDF to extract your work history.");
  renderEntryList("#education-list", "#education-count", profile.educationEntries, (item) => entryHTML(
    item.degree || item.field, item.institution, [item.field, item.startDate && item.endDate ? `${item.startDate}–${item.endDate}` : "", item.details].filter(Boolean).join(" · ")
  ), "Education entries will appear here after local analysis.");
  renderEntryList("#projects-list", "#projects-count", profile.projects, (item) => entryHTML(
    item.name, (item.technologies || []).join(", "), item.description
  ), "Projects and their technologies will appear here.");
  renderEntryList("#accomplishments-list", "#accomplishments-count", profile.accomplishments, (item) => entryHTML(item, "", ""), "Awards, measurable results, and leadership evidence will appear here.");
  if (profile.aiModel) {
    $("#ai-profile-status").textContent = `Last analyzed locally with ${profile.aiModel}${profile.aiAnalyzedAt ? ` · ${relativeTime(profile.aiAnalyzedAt)}` : ""}`;
    $("#ai-profile-status").classList.remove("offline");
  }
}

async function loadAIStatus() {
  try {
    const status = await api("/api/ai/status");
    const element = $("#ai-profile-status");
    if (state.profile?.aiModel) return;
    element.textContent = status.available
      ? `${status.model} is ready locally · documents never leave this laptop`
      : `${status.model} is not available · imports will use basic extraction`;
    element.classList.toggle("offline", !status.available);
  } catch (_) {
    $("#ai-profile-status").textContent = "Local AI status unavailable";
    $("#ai-profile-status").classList.add("offline");
  }
}

function renderGmailStatus(status) {
  state.gmail = status;
  $("#gmail-query").value = status.searchQuery;
  $("#gmail-interval").value = String(status.intervalMinutes);
  $("#gmail-enabled").checked = status.enabled;
  $("#gmail-badge").textContent = status.connected ? "Connected" : status.credentialsConfigured ? "Ready to connect" : "Setup needed";
  $("#gmail-badge").classList.toggle("connected", status.connected);
  $("#gmail-account").textContent = status.connected
    ? status.connectedEmail
    : status.credentialsConfigured ? "Google connection file added" : "Not connected";
  $("#gmail-setup").hidden = status.credentialsConfigured;
  $("#gmail-connect").hidden = status.connected;
  $("#gmail-sync").disabled = !status.connected;
  $("#gmail-save").disabled = !status.connected;
  $("#gmail-help").textContent = status.connected
    ? "Read-only access is active. JobTrail searches matching alerts, then stores and scores their job links locally."
    : "Add a Desktop app OAuth JSON file, then approve read-only Gmail access once in Google.";
  $("#gmail-stats").innerHTML = [
    `${status.processedMessages} emails processed`,
    `${status.importedJobs} job links found`,
    status.lastSyncAt ? `Last sync ${relativeTime(status.lastSyncAt)}` : "Not synced yet",
    status.enabled ? `Every ${status.intervalMinutes} min` : "Automatic sync off"
  ].map((item) => `<span>${escapeHTML(item)}</span>`).join("");
  $("#gmail-status").textContent = status.dependencyError || status.lastError || "";
}

async function loadGmailStatus() {
  try {
    renderGmailStatus(await api("/api/gmail/status"));
  } catch (error) {
    $("#gmail-status").textContent = error.message;
  }
}

function renderSchedule() {
  const settings = state.settings;
  $("#schedule-enabled").checked = settings.enabled;
  $("#collection-interval").value = String(settings.intervalMinutes);
  $("#morning-time").value = settings.morningTime;
  $("#evening-time").value = settings.eveningTime;
  $("#schedule-timezone").value = settings.timezone;
  $(".digest-time").innerHTML = escapeHTML(settings.nextDigest.display).replace(" AM", " <span>AM</span>").replace(" PM", " <span>PM</span>");
  $(".next-digest p").textContent = `${settings.nextDigest.period === "morning" ? "Morning" : "Evening"} report · ${settings.timezone}`;
  const lastSync = settings.lastRunAt ? `Sources synced ${relativeTime(settings.lastRunAt)}` : "Waiting for first live sync";
  $(".sync-status").innerHTML = `<span class="pulse"></span> ${escapeHTML(lastSync)}`;
}

function renderAll() {
  renderMetrics();
  renderSources();
  renderProfile();
  renderSchedule();
  renderJobs();
  notifyUrgentBrowserJobs();
  const button = $("#collect-button");
  button.disabled = state.collecting;
  button.textContent = state.collecting ? "Collecting live jobs…" : "↻ Collect new jobs";
}

async function loadDashboard({quiet = false} = {}) {
  try {
    const data = await api("/api/dashboard");
    Object.assign(state, {
      jobs: data.jobs,
      sources: data.sources,
      profile: data.profile,
      settings: data.settings,
      metrics: data.metrics,
      latestRun: data.latestRun,
      collecting: data.collecting
    });
    renderAll();
    return data;
  } catch (error) {
    if (!quiet) showToast(error.message);
    throw error;
  }
}

async function openJob(id) {
  const job = state.jobs.find((item) => item.id === Number(id));
  if (!job) return;
  try {
    const opened = await api(`/api/jobs/${job.id}/opened`, {method: "POST", body: "{}"});
    job.openedAt = job.openedAt || opened.openedAt;
  } catch (_) {}
  $("#detail-content").innerHTML = `
    <div class="detail-head"><div class="company-logo">${escapeHTML(job.company.slice(0, 1))}</div><div><h2>${escapeHTML(job.title)}</h2><p>${escapeHTML(job.company)} · ${escapeHTML(job.location)}</p></div></div>
    <div class="detail-meta"><span>${job.score}% match</span><span>${escapeHTML(job.workplace)}</span><span>${escapeHTML(job.type)}</span><span>${job.isUrgent ? "⚡ Under 2 hours" : escapeHTML(job.provider)}</span></div>
    <div class="speed-timeline"><strong>Application speed</strong><span>Detected ${escapeHTML(relativeTime(job.firstSeenAt))}</span>${job.detectionLatencyMinutes !== null ? `<span>${job.detectionLatencyMinutes} min source-to-detection estimate</span>` : ""}${job.appliedAt ? `<span>Applied in ${job.applicationLatencyMinutes ?? "—"} min</span>` : `<span>Timer started when you opened this job</span>`}</div>
    ${job.alertName ? `<div class="found-through"><strong>Found through ${escapeHTML(job.alertPlatform || "email alert")}</strong><span>${escapeHTML(job.alertName)}</span><small>${job.observationCount || 1} matching alert observation${job.observationCount === 1 ? "" : "s"} stored</small></div>` : ""}
    <div class="why-match"><h3>Why this matches you</h3><ul>${job.reasons.map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul></div>
    <p class="detail-description">${escapeHTML(job.description.slice(0, 1800))}${job.description.length > 1800 ? "…" : ""}</p>
    <div class="detail-actions"><a class="primary-button action-link" href="${escapeHTML(job.url)}" target="_blank" rel="noopener">Open application</a><button class="secondary-button" data-apply="${job.id}">Mark as applied</button></div>`;
  $("#detail-dialog").showModal();
}

async function setJobStatus(id, status) {
  await api(`/api/jobs/${id}/status`, {method: "POST", body: JSON.stringify({status})});
  await loadDashboard({quiet: true});
}

function setView(view) {
  showDashboard();
  state.view = view;
  $$(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#list-heading").textContent = {discover: "Newest jobs for you", urgent: "Urgent application queue", saved: "Saved jobs", applied: "Your applications"}[view];
  renderJobs();
}

function showProfilePage() {
  $("#dashboard-view").hidden = true;
  $("#profile-page").hidden = false;
  $("#page-title").textContent = "Your matching profile";
  $("#collect-button").hidden = true;
  $("#notification-button").hidden = true;
  $("#profile-button").classList.add("active");
  window.scrollTo({top: 0, behavior: "smooth"});
}

function showDashboard() {
  $("#dashboard-view").hidden = false;
  $("#profile-page").hidden = true;
  $("#page-title").textContent = state.profile?.fullName ? `Good morning, ${state.profile.fullName.split(/\s+/)[0]}` : "Good morning";
  $("#collect-button").hidden = false;
  $("#notification-button").hidden = false;
  $("#profile-button").classList.remove("active");
}

document.addEventListener("click", async (event) => {
  const open = event.target.closest("[data-open]");
  const save = event.target.closest("[data-save]");
  const dismiss = event.target.closest("[data-dismiss]");
  const apply = event.target.closest("[data-apply]");
  const close = event.target.closest("[data-close]");
  const nav = event.target.closest("[data-view]");
  try {
    if (open) await openJob(open.dataset.open);
    if (save) {
      const job = state.jobs.find((item) => item.id === Number(save.dataset.save));
      await setJobStatus(job.id, job.status === "saved" ? "new" : "saved");
      showToast(job.status === "saved" ? "Removed from saved" : "Saved in SQLite");
    }
    if (dismiss) { await setJobStatus(dismiss.dataset.dismiss, "dismissed"); showToast("Dismissed and persisted"); }
    if (apply) { await setJobStatus(apply.dataset.apply, "applied"); $("#detail-dialog").close(); showToast("Application status persisted"); }
    if (close) $("#" + close.dataset.close).close();
    if (nav) { event.preventDefault(); setView(nav.dataset.view); }
  } catch (error) { showToast(error.message); }
});

$("#search-input").addEventListener("input", (event) => { state.query = event.target.value; renderJobs(); });
$("#location-filter").addEventListener("change", (event) => { state.location = event.target.value; renderJobs(); });
$("#type-filter").addEventListener("change", (event) => { state.type = event.target.value; renderJobs(); });
$("#match-filter").addEventListener("click", (event) => { state.highMatchOnly = !state.highMatchOnly; event.currentTarget.classList.toggle("active", state.highMatchOnly); renderJobs(); });
$("#clear-filters").addEventListener("click", () => {
  state.query = ""; state.location = "all"; state.type = "all"; state.highMatchOnly = false;
  $("#search-input").value = ""; $("#location-filter").value = "all"; $("#type-filter").value = "all"; $("#match-filter").classList.remove("active");
  renderJobs();
});

$("#collect-button").addEventListener("click", async () => {
  try {
    await api("/api/collect", {method: "POST", body: "{}"});
    state.collecting = true;
    renderAll();
    showToast("Live collection started");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const data = await loadDashboard({quiet: true});
      if (!data.collecting) { showToast(`Collection complete — ${data.metrics.active} live jobs stored`); break; }
    }
  } catch (error) { showToast(error.message); }
});

$("#settings-button").addEventListener("click", () => $("#settings-dialog").showModal());
$("#profile-button").addEventListener("click", showProfilePage);
$("#edit-profile").addEventListener("click", showProfilePage);
$("#back-to-jobs").addEventListener("click", showDashboard);
$("#import-profile-button").addEventListener("click", openImportDialog);
$("#profile-page-import").addEventListener("click", openImportDialog);
$("#profile-import-shortcut").addEventListener("click", () => { $("#profile-dialog").close(); openImportDialog(); });
$("#preview-digest").addEventListener("click", () => showToast(`Digest preview: ${state.metrics.matches || 0} current matches`));

function notifyUrgentBrowserJobs() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const seen = new Set(JSON.parse(localStorage.getItem("jobtrail-notified-jobs") || "[]"));
  const fresh = state.jobs.filter((job) => job.isUrgent && !seen.has(job.id)).slice(0, 5);
  fresh.forEach((job) => {
    const notice = new Notification(`JobTrail: ${job.score}% urgent match`, {
      body: `${job.title} at ${job.company}`,
      tag: `jobtrail-${job.id}`,
    });
    notice.onclick = () => { window.focus(); openJob(job.id); };
    seen.add(job.id);
  });
  localStorage.setItem("jobtrail-notified-jobs", JSON.stringify([...seen].slice(-500)));
}

$("#notification-button").addEventListener("click", async () => {
  if (!("Notification" in window)) return showToast("Browser notifications are not supported here");
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "Urgent job notifications enabled" : "Notifications were not enabled");
  if (permission === "granted") notifyUrgentBrowserJobs();
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/settings", {method: "POST", body: JSON.stringify({
      enabled: $("#schedule-enabled").checked,
      intervalMinutes: Number($("#collection-interval").value),
      morningTime: $("#morning-time").value,
      eveningTime: $("#evening-time").value,
      timezone: $("#schedule-timezone").value
    })});
    $("#settings-dialog").close();
    await loadDashboard({quiet: true});
    showToast("Schedule saved in SQLite");
  } catch (error) { showToast(error.message); }
});

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/profile", {method: "POST", body: JSON.stringify({
      targetRole: $("#profile-role-input").value,
      location: $("#profile-location-input").value,
      skills: $("#profile-skills-input").value.split(",").map((skill) => skill.trim()).filter(Boolean),
      minimumScore: Number($("#profile-score-input").value)
    })});
    $("#profile-dialog").close();
    await loadDashboard({quiet: true});
    showToast("Profile saved and live jobs rescored");
  } catch (error) { showToast(error.message); }
});

function commaList(selector) {
  return $(selector).value.split(",").map((item) => item.trim()).filter(Boolean);
}

$("#dedicated-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) { button.disabled = true; button.textContent = "Saving and rescoring…"; }
  try {
    const titles = commaList("#intent-titles");
    await api("/api/profile", {method: "POST", body: JSON.stringify({
      fullName: $("#identity-name").value,
      headline: $("#identity-headline").value,
      email: $("#identity-email").value,
      phone: $("#identity-phone").value,
      experienceYears: Number($("#identity-experience").value || 0),
      education: $("#identity-education").value,
      skills: commaList("#identity-skills"),
      certifications: commaList("#identity-certifications"),
      professionalSummary: $("#identity-summary").value,
      workAuthorization: $("#identity-authorization").value,
      securityClearance: $("#identity-clearance").value,
      languages: commaList("#identity-languages"),
      links: commaList("#identity-links"),
      workExperience: state.profile.workExperience,
      educationEntries: state.profile.educationEntries,
      projects: state.profile.projects,
      accomplishments: state.profile.accomplishments,
      aiModel: state.profile.aiModel,
      aiAnalyzedAt: state.profile.aiAnalyzedAt,
      documentSources: state.profile.documentSources,
      targetRole: $("#intent-name").value || titles[0] || "Technology roles",
      roleTitles: titles,
      location: $("#intent-location").value,
      seniority: $("#intent-seniority").value,
      employmentTypes: commaList("#intent-employment"),
      industries: commaList("#intent-industries"),
      desiredKeywords: commaList("#intent-keywords"),
      excludedKeywords: commaList("#intent-excluded"),
      minimumScore: Number($("#intent-score").value)
    })});
    await loadDashboard({quiet: true});
    $("#profile-save-status").textContent = "Saved. Every active job was rescored from this profile.";
    showToast("Profile saved and jobs rescored");
  } catch (error) { showToast(error.message); }
  finally { if (button) { button.disabled = false; button.textContent = "Save profile and rescore jobs"; } }
});

$("#import-email-alerts").addEventListener("click", async () => {
  const files = [...$("#email-alert-files").files];
  if (!files.length) { $("#email-import-status").textContent = "Choose one or more .eml alert files first."; return; }
  const button = $("#import-email-alerts");
  button.disabled = true; button.textContent = "Reading alert emails…";
  try {
    const form = new FormData();
    files.forEach((file) => form.append("alerts", file));
    const response = await fetch("/api/email-alerts/import", {method: "POST", body: form});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Email import failed");
    await loadDashboard({quiet: true});
    $("#email-import-status").textContent = `Found ${result.found} job links and added ${result.added} new jobs.`;
    showToast(`${result.added} alert jobs added and scored`);
  } catch (error) { $("#email-import-status").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Import alert emails"; }
});

$("#gmail-upload-credentials").addEventListener("click", async () => {
  const file = $("#gmail-credential-file").files[0];
  if (!file) { $("#gmail-status").textContent = "Choose the Google OAuth JSON file first."; return; }
  const button = $("#gmail-upload-credentials");
  button.disabled = true; button.textContent = "Adding connection file…";
  try {
    const form = new FormData();
    form.append("credentials", file);
    const response = await fetch("/api/gmail/credentials", {method: "POST", body: form});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not add the Google connection file");
    await loadGmailStatus();
    showToast("Google connection file added");
  } catch (error) { $("#gmail-status").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Add Google connection file"; }
});

$("#gmail-save-manual").addEventListener("click", async () => {
  const button = $("#gmail-save-manual");
  button.disabled = true;
  try {
    await api("/api/gmail/credentials/manual", {method: "POST", body: JSON.stringify({
      clientId: $("#gmail-client-id").value,
      clientSecret: $("#gmail-client-secret").value
    })});
    $("#gmail-client-id").value = "";
    $("#gmail-client-secret").value = "";
    await loadGmailStatus();
    showToast("Google credentials saved locally");
  } catch (error) { $("#gmail-status").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#gmail-connect").addEventListener("click", () => {
  window.location.assign("/api/gmail/connect");
});

$("#gmail-save").addEventListener("click", async () => {
  const button = $("#gmail-save");
  button.disabled = true;
  try {
    await api("/api/gmail/settings", {method: "POST", body: JSON.stringify({
      enabled: $("#gmail-enabled").checked,
      searchQuery: $("#gmail-query").value,
      intervalMinutes: Number($("#gmail-interval").value)
    })});
    await loadGmailStatus();
    showToast("Gmail schedule saved locally");
  } catch (error) { $("#gmail-status").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#gmail-sync").addEventListener("click", async () => {
  const button = $("#gmail-sync");
  button.disabled = true; button.textContent = "Checking Gmail…";
  try {
    const result = await api("/api/gmail/sync", {method: "POST", body: "{}"});
    await Promise.all([loadGmailStatus(), loadDashboard({quiet: true})]);
    showToast(`Gmail sync complete — ${result.jobsAdded || 0} new jobs added`);
  } catch (error) { $("#gmail-status").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Sync now"; }
});

function openImportDialog() {
  $("#import-error").textContent = "";
  $("#import-upload-view").hidden = false;
  $("#import-review-view").hidden = true;
  $("#import-warning").textContent = "";
  $("#import-dialog").showModal();
}

[["#linkedin-file", "#linkedin-file-name"], ["#resume-file", "#resume-file-name"]].forEach(([input, label]) => {
  $(input).addEventListener("change", (event) => { $(label).textContent = event.target.files[0]?.name || "Choose file"; });
});

$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [$("#linkedin-file").files[0], $("#resume-file").files[0]].filter(Boolean);
  if (!files.length) { $("#import-error").textContent = "Choose a LinkedIn export, a CV, or both."; return; }
  const button = $("#analyze-button");
  button.disabled = true; button.textContent = "Reading documents…";
  try {
    const form = new FormData();
    files.forEach((file, index) => form.append(index ? "resume" : "linkedin", file));
    const response = await fetch("/api/profile/import", {method: "POST", body: form});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    state.importedProfile = result.profile;
    $("#import-summary").textContent = result.profile.summary;
    $("#import-ai-status").textContent = result.profile.analyzer === "ollama"
      ? `Analyzed locally with ${result.profile.aiModel}`
      : "Basic local extraction";
    $("#import-warning").textContent = result.warning || "";
    $("#import-name").value = result.profile.fullName || "";
    $("#import-headline").value = result.profile.headline || "";
    $("#import-role").value = result.profile.targetRole;
    $("#import-location").value = result.profile.location;
    $("#import-skills").value = result.profile.skills.join(", ");
    $("#document-summary").innerHTML = result.documents.map((doc) => `<span class="document-chip">${escapeHTML(doc.name)} · ${doc.characters.toLocaleString()} characters</span>`).join("");
    const experience = result.profile.workExperience || [];
    const education = result.profile.educationEntries || [];
    const projects = result.profile.projects || [];
    const certifications = result.profile.certifications || [];
    $("#import-rich-preview").innerHTML = [
      ["Work experience", experience.length, experience.slice(0, 3).map((item) => `${item.title || "Role"} at ${item.company || "company"}`).join(" · ")],
      ["Education", education.length, education.slice(0, 3).map((item) => `${item.degree || item.field || "Study"} — ${item.institution || "institution"}`).join(" · ")],
      ["Projects", projects.length, projects.slice(0, 3).map((item) => item.name).filter(Boolean).join(" · ")],
      ["Certifications", certifications.length, certifications.slice(0, 4).join(" · ")]
    ].map(([label, count, text]) => `<div class="import-preview-card"><strong>${escapeHTML(label)} · ${count}</strong><span>${escapeHTML(text || "Nothing explicit found")}</span></div>`).join("");
    $("#import-evidence").innerHTML = `<strong>Why JobTrail suggested this</strong>${result.profile.evidence.map((item) => `<span>✓ ${escapeHTML(item)}</span>`).join("")}`;
    $("#import-upload-view").hidden = true; $("#import-review-view").hidden = false;
  } catch (error) { $("#import-error").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Analyze files locally"; }
});

$("#back-to-upload").addEventListener("click", () => { $("#import-upload-view").hidden = false; $("#import-review-view").hidden = true; });
$("#import-review-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const imported = state.importedProfile;
  if (!imported) return;
  await api("/api/profile", {method: "POST", body: JSON.stringify({
    fullName: $("#import-name").value,
    headline: $("#import-headline").value,
    email: imported.email,
    phone: imported.phone,
    professionalSummary: imported.professionalSummary,
    experienceYears: imported.experienceYears,
    certifications: imported.certifications,
    workExperience: imported.workExperience,
    educationEntries: imported.educationEntries,
    education: imported.educationEntries.map((item) => [item.degree, item.field, item.institution].filter(Boolean).join(" ")).join("; "),
    projects: imported.projects,
    languages: imported.languages,
    links: imported.links,
    accomplishments: imported.accomplishments,
    workAuthorization: imported.workAuthorization,
    securityClearance: imported.securityClearance,
    targetRole: $("#import-role").value,
    roleTitles: imported.roleTitles,
    seniority: imported.seniority,
    location: $("#import-location").value,
    skills: $("#import-skills").value.split(",").map((skill) => skill.trim()).filter(Boolean),
    aiModel: imported.aiModel,
    aiAnalyzedAt: imported.aiAnalyzedAt,
    documentSources: imported.documentSources,
    minimumScore: state.profile.minimumScore
  })});
  $("#import-dialog").close();
  await loadDashboard({quiet: true});
  showToast("Imported profile saved and jobs rescored");
});

loadDashboard().then(async (data) => {
  loadAIStatus();
  loadGmailStatus();
  const gmailResult = new URLSearchParams(window.location.search).get("gmail");
  if (gmailResult) {
    showProfilePage();
    showToast(gmailResult === "connected" ? "Gmail connected — first sync started" : "Gmail connection was not completed");
    history.replaceState({}, "", `${window.location.pathname}#profile`);
  }
  if (data.collecting) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const refreshed = await loadDashboard({quiet: true});
      if (!refreshed.collecting) break;
    }
  }
}).catch(() => {});
