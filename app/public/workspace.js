"use strict";
const base = document.querySelector('meta[name="app-base"]').content;
const shell = document.querySelector("#shell"),
  notice = document.querySelector("#notice");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (n) => new Date(n).toLocaleString();
const url = (p) => base + p;
const field = (label, name, type = "text", extra = "") =>
  `<label class="field">${label}<input name="${name}" type="${type}" ${extra}></label>`;
const status = (s) =>
  `<span class="status ${["failed", "cancelled"].includes(s) ? "warn" : ""}">${esc(s)}</span>`;
const head = (title, description, eyebrow = "Company workspace") =>
  `<div class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>`;
let session = null,
  poll = null,
  noticeTimer = null,
  generation = 0;
function inform(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.dataset.error = error;
  notice.hidden = false;
  noticeTimer = setTimeout(() => (notice.hidden = true), error ? 10000 : 5000);
}
async function api(path, body, method) {
  const requestGeneration = generation;
  const res = await fetch(url("/api" + path), {
    method: method || (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(session
        ? { "x-associated-sales-company": session.user.companyId }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (requestGeneration !== generation)
    throw Error(
      "Workspace changed while this request was running. Reload the current view to check its outcome.",
    );
  if (!res.ok) {
    if (res.status === 409 && data.error?.startsWith("Company changed")) {
      void render();
    }
    if (res.status === 401 && session) {
      session = null;
      void render();
    }
    throw Error(data.error || "Request failed");
  }
  return data;
}
function bindForm(id, callback) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await callback(Object.fromEntries(new FormData(form)), form);
    } catch (e) {
      inform(e.message, true);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
function action(selector, fn) {
  document.querySelectorAll(selector).forEach((el) =>
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      el.disabled = true;
      try {
        await fn(el);
      } catch (e) {
        inform(e.message, true);
      } finally {
        el.disabled = false;
      }
    }),
  );
}
function go(path) {
  history.pushState({}, "", url(path));
  void render();
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    go(a.dataset.nav);
  }
});
window.addEventListener("popstate", () => void render());
function navigation(path) {
  const owner = session.user.role === "owner";
  shell.innerHTML = `<header class="topbar"><a class="brand" href="${url("/research")}" data-nav="/research">Associated Sales<small>By Velug</small></a><div class="top-actions"><label><span class="sr-only" hidden>Company</span><select id="company" aria-label="Current company">${session.companies.map((c) => `<option value="${esc(c.id)}" ${c.id === session.user.companyId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><button class="secondary" id="signout">Sign out</button></div></header><div class="layout"><nav class="sidebar" aria-label="Workspace"><a href="${url("/research")}" data-nav="/research" ${path.startsWith("/research") ? 'aria-current="page"' : ""}>Research</a><a href="${url("/inventory")}" data-nav="/inventory" ${path === "/inventory" ? 'aria-current="page"' : ""}>Inventory</a>${owner ? `<a href="${url("/team")}" data-nav="/team" ${path === "/team" ? 'aria-current="page"' : ""}>Team</a>` : ""}<a href="${url("/settings")}" data-nav="/settings" ${path === "/settings" ? 'aria-current="page"' : ""}>Settings</a><div class="sidebar-foot">${esc(session.user.email)}<br>${esc(session.user.role)} access<br><br><a href="https://github.com/pranavred/velug-associated-sales" target="_blank" rel="noopener noreferrer">Open-source code ↗</a></div></nav><main id="main"><p class="loading">Loading…</p></main></div>`;
  document.querySelector("#company").addEventListener("change", async (e) => {
    const requestedCompany = e.target.value;
    e.target.value = session.user.companyId;
    shell.inert = true;
    try {
      await api("/company", { id: requestedCompany });
      history.pushState({}, "", url("/research"));
    } catch (e) {
      inform(e.message, true);
    } finally {
      await render();
      shell.inert = false;
    }
  });
  action("#signout", async () => {
    await api("/logout", {});
    session = null;
    go("/login");
  });
}
function auth(activate = false) {
  shell.innerHTML = `<header class="topbar"><a class="brand" href="https://velug.ai">Associated Sales<small>By Velug</small></a><a href="https://github.com/pranavred/velug-associated-sales" target="_blank" rel="noopener noreferrer">Open source ↗</a></header><main id="main" class="auth-layout"><section class="auth-copy"><div class="eyebrow">Better questions. More relevant sales.</div><h1>Your inventory.<br>Their next need.</h1><p>Research a manufacturer or buyer, find relevant products in your catalog, and prepare the questions that turn a possibility into a qualified opportunity.</p><ol><li>Connect the inventory you already use</li><li>Research the company you want to sell to</li><li>Review the fit. Ask the next question.</li></ol></section><section class="panel auth-card"><div class="eyebrow">Private company access</div><h2>${activate ? "Join your company" : "Open your workspace"}</h2><p class="muted">${activate ? "Create your password, or use your existing account password. Invitations expire after 24 hours." : "Sign in with the account your company owner created."}</p><form id="auth-form" class="stack">${activate ? field("Invitation token", "token", "text", 'required autocomplete="off"') : field("Work email", "email", "email", 'required autocomplete="username"')}${field(activate ? "Password · 14 characters minimum" : "Password", "password", "password", `required ${activate ? 'minlength="14"' : ""} maxlength="256" autocomplete="${activate ? "new-password" : "current-password"}"`)}<button>${activate ? "Activate invitation" : "Sign in"}</button></form><p class="footer-note">${activate ? `Already activated? <a href="${url("/login")}" data-nav="/login">Sign in</a>.` : "Need access or a password reset? Contact your company’s instance administrator."}</p><div class="divider"></div><p class="footer-note">Company inventories and research are visible only to authorized members. You can also <a href="https://github.com/pranavred/velug-associated-sales/blob/main/docs/self-hosting.md" target="_blank" rel="noopener noreferrer">run your own instance</a>.</p></section></main>`;
  if (activate) {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) document.querySelector("[name=token]").value = token;
    history.replaceState({}, "", url("/activate"));
  }
  bindForm("auth-form", async (input) => {
    if (activate) {
      await api("/activate", input);
      inform("Invitation activated. Sign in to continue.");
      go("/login");
    } else {
      await api("/login", input);
      go("/research");
    }
  });
}
async function render() {
  clearTimeout(poll);
  const turn = ++generation;
  let path = location.pathname.slice(base.length) || "/research";
  if (path === "/") path = "/research";
  if (path === "/activate") {
    auth(true);
    return;
  }
  try {
    const nextSession = await api("/session");
    if (turn !== generation) return;
    session = nextSession;
  } catch {
    if (turn === generation) auth(false);
    return;
  }
  if (turn !== generation) return;
  navigation(path);
  const main = document.querySelector("#main");
  try {
    if (path === "/inventory") await inventory(main);
    else if (path === "/team") await team(main);
    else if (path === "/settings") await settings(main);
    else if (/^\/research\/[^/]+$/.test(path))
      await researchDetail(main, path.split("/")[2], turn);
    else await researchHome(main);
  } catch (e) {
    if (turn === generation) {
      main.innerHTML = `${head("Could not load this page", "Please retry, or check your company access.")}<div class="callout warn">${esc(e.message)}</div><button id="retry">Try again</button>`;
      action("#retry", () => render());
    }
  }
}
async function inventory(main, offset = 0) {
  const data = await api("/inventory?offset=" + offset);
  const owner = session.user.role === "owner";
  main.innerHTML =
    head(
      "A catalog ready for conversation.",
      "Bring in a CSV, JSON export, or connect your existing inventory through the API.",
      "01 / Inventory",
    ) +
    `<div class="metric-row"><div class="metric"><strong>${data.total}</strong><span>Catalog products</span></div><div class="metric"><strong>${session.limits.staleDays}d</strong><span>Maximum inventory age</span></div><div class="metric"><strong>${new Set(data.products.map((p) => p.source)).size}</strong><span>Sources on this page</span></div><div class="metric"><strong>${data.products.filter((p) => p.quantity === null).length}</strong><span>Unknown stock on this page</span></div></div>${owner ? `<details class="panel" ${data.total ? "" : "open"}><summary>Import or update your inventory</summary><p class="muted">Upload up to 1,000 products. Map your own column names below. <a href="${url("/assets/inventory.csv")}" download>Download an example CSV</a>.</p><form id="import-form"><div class="fields two"><label class="field">CSV or JSON file<input id="inventory-file" type="file" accept=".csv,.json,text/csv,application/json" required></label>${field("Inventory source", "source", "text", 'value="erp" required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" maxlength="60"')}<label class="field">Update method<select name="mode"><option value="upsert">Add or update these products</option><option value="replace">Replace this source’s complete catalog</option></select><small>Other sources are always preserved.</small></label><label class="field">Inventory timestamp<input name="asOf" type="datetime-local"><small>Use the export’s timestamp. Defaults to now.</small></label></div><div id="mapping" class="fields two"></div><div class="form-actions"><button id="import-button" disabled>Import inventory</button><small id="import-summary">Choose a file to map columns.</small></div></form><p class="footer-note">For larger catalogs or scheduled ERP syncs, use upsert batches through the <a href="https://github.com/pranavred/velug-associated-sales/blob/main/docs/inventory-api.md" target="_blank" rel="noopener noreferrer">integration API</a>. Create a source token in Settings.</p></details>` : ""}<section class="panel"><div class="row spread"><h2>Your products</h2><small>Showing ${data.total ? offset + 1 : 0}–${offset + data.products.length} of ${data.total}</small></div><label class="field">Search this page<input id="product-search" type="search" placeholder="Product name, SKU, or source"></label><div class="table-wrap" id="products"></div><div class="form-actions">${offset ? '<button class="secondary" id="prev">Previous 500</button>' : ""}${offset + data.products.length < data.total ? '<button class="secondary" id="next">Next 500</button>' : ""}</div></section>`;
  const table = (filter) => {
    const rows = data.products.filter((p) =>
      (p.name + " " + p.sku + " " + p.source)
        .toLowerCase()
        .includes(filter.toLowerCase()),
    );
    document.querySelector("#products").innerHTML = rows.length
      ? `<table><thead><tr><th>Product / source</th><th>Available</th><th>Region</th><th>Last synced</th></tr></thead><tbody>${rows.map((p) => `<tr><td><strong>${esc(p.name)}</strong><br><span class="sku">${esc(p.sku)} · ${esc(p.source)}</span>${!p.active ? '<br><span class="status warn">Inactive</span>' : ""}</td><td>${p.quantity === null ? '<span class="status warn">Confirm stock</span>' : esc(p.quantity) + " " + esc(p.unit)}${p.quantity === 0 ? '<br><span class="status warn">Out of stock</span>' : ""}</td><td>${esc(p.regions.join(", ") || "Unconfirmed")}</td><td>${esc(date(p.updatedAt))}${p.updatedAt < Date.now() - session.limits.staleDays * 86400000 ? '<br><span class="status warn">Stale</span>' : ""}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty"><h2>No products to show</h2><p>Import your catalog to start matching buyers to products you can supply.</p></div>';
  };
  table("");
  document.querySelector("#product-search").oninput = (e) =>
    table(e.target.value);
  action("#prev", () => inventory(main, Math.max(0, offset - 500)));
  action("#next", () => inventory(main, offset + 500));
  if (owner) {
    let payload = null,
      importKey = null;
    document.querySelector("#inventory-file").onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 1900000)
          throw Error("Use a file smaller than 1.9 MB, or the batched API.");
        const raw = await file.text();
        payload = file.name.toLowerCase().endsWith(".json")
          ? { rows: JSON.parse(raw) }
          : { csv: raw };
        const preview = await api("/inventory/preview", payload);
        importKey = crypto.randomUUID();
        const fields = [
          "sku",
          "name",
          "description",
          "applications",
          "quantity",
          "unit",
          "regions",
          "grade",
          "specifications",
          "sdsUrl",
          "tdsUrl",
          "active",
        ];
        document.querySelector("#mapping").innerHTML =
          '<div class="divider"></div><div class="divider"></div>' +
          fields
            .map(
              (key) =>
                `<label class="field">${esc(key)}${["sku", "name"].includes(key) ? " *" : ""}<select name="map_${key}" ${["sku", "name"].includes(key) ? "required" : ""}><option value="">${["sku", "name"].includes(key) ? "Choose a column" : "Not supplied"}</option>${preview.headers.map((h) => `<option value="${esc(h)}" ${h.toLowerCase() === key.toLowerCase() ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`,
            )
            .join("");
        document.querySelector("#import-summary").textContent =
          preview.count + " rows ready to map";
        document.querySelector("#import-button").disabled = false;
      } catch (e) {
        payload = null;
        document.querySelector("#import-button").disabled = true;
        inform(e.message, true);
      }
    };
    bindForm("import-form", async (input) => {
      if (!payload) throw Error("Choose an inventory file first.");
      if (
        input.mode === "replace" &&
        !confirm(
          "Replace all products from source “" +
            input.source +
            "” with this file? Missing SKUs from this source will be removed.",
        )
      )
        return;
      const mapping = Object.fromEntries(
        Object.entries(input)
          .filter(([k]) => k.startsWith("map_"))
          .map(([k, v]) => [k.slice(4), v]),
      );
      const receipt = await api("/inventory/import", {
        ...payload,
        source: input.source,
        mode: input.mode,
        key: importKey,
        mapping,
        ...(input.asOf ? { asOf: new Date(input.asOf).toISOString() } : {}),
      });
      inform(receipt.imported + " products imported.");
      await inventory(main);
    });
  }
}
async function researchHome(main) {
  const jobs = await api("/research");
  main.innerHTML =
    head(
      "Know the buyer. Find the next fit.",
      "Start with public evidence about a company, then compare its needs with your own catalog.",
      "02 / Company research",
    ) +
    `<div class="columns"><section class="panel"><h2>Research a company</h2><form id="research-form"><div class="fields">${field("Company or manufacturer", "name", "text", 'required minlength="2" maxlength="200" placeholder="e.g. a manufacturer you sell to"')}${field("Official website", "website", "url", 'placeholder="https://company.com"')}<div class="fields two">${field("Location / site", "location", "text", 'maxlength="200" placeholder="City, state, or facility"')}${field("Selling country", "region", "text", 'maxlength="2" minlength="2" pattern="[A-Za-z]{2}" placeholder="US"')}<label class="field">Research depth<select name="depth"><option value="standard">Company overview</option><option value="deep">Deep research · operations and requirements</option></select></label></div><label class="field">What do you want to explore?<textarea name="objective" maxlength="1200" placeholder="The existing product, process, or customer need you want to build on."></textarea></label></div><div class="callout">Research uses public web sources. Relevant product descriptions and specifications are sent to the AI provider for matching. Stock quantities stay in this workspace.</div><div class="form-actions"><button ${session.researchConfigured ? "" : "disabled"}>Research & find opportunities</button></div>${session.researchConfigured ? "" : '<p class="callout warn">Your administrator needs to configure the AI provider before research can run.</p>'}<p class="footer-note">Typically two model calls per run. Up to ${session.limits.maxCandidates} eligible products are compared. Results require your review.</p></form></section><section class="panel"><div class="row spread"><h2>Recent research</h2><span class="status">${jobs.length} runs</span></div>${jobs.length ? jobs.map((j) => `<article class="list-item"><div class="row spread"><h3><a href="${url("/research/" + j.id)}" data-nav="/research/${esc(j.id)}">${esc(j.input.name)}</a></h3>${status(j.status)}</div><small>${esc(j.input.location || j.input.website || "Company research")}<br>${esc(date(j.createdAt))}</small></article>`).join("") : '<div class="empty"><h3>Your next conversation starts here</h3><p>Add a company to build a cited brief and a shortlist from your inventory.</p></div>'}</section></div>`;
  let requestKey = crypto.randomUUID();
  bindForm("research-form", async (input) => {
    const job = await api("/research", { ...input, requestKey });
    requestKey = crypto.randomUUID();
    go("/research/" + job.id);
  });
}
function citations(ids, sources) {
  return ids
    .map((id) => {
      const s = sources.find((x) => x.id === id);
      return s
        ? `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.id)} ↗</a>`
        : "";
    })
    .join("");
}
async function researchDetail(main, id, turn) {
  const job = await api("/research/" + id),
    sources = job.research?.sources || [];
  main.innerHTML =
    head(
      esc(job.input.name),
      "Research, catalog opportunities, and the questions to ask next.",
      "02 / Company research",
    ) +
    `<div class="row spread"><div class="row">${status(job.status)}<small>${esc(date(job.createdAt))}</small></div><a href="${url("/research")}" data-nav="/research">All research</a></div>`;
  if (["queued", "running"].includes(job.status)) {
    main.innerHTML += `<section class="panel"><h2>${job.phase.startsWith("match") ? "Comparing your catalog…" : "Researching public sources…"}</h2><p class="muted">This can take a few minutes. You can leave this page and return later.</p><button class="secondary" id="cancel">Cancel research</button><p class="footer-note">Cancelling stops subsequent work. A provider call already in progress may still be billed.</p></section>`;
    action("#cancel", async () => {
      await api("/research/" + id + "/cancel", {});
      void render();
    });
    poll = setTimeout(() => {
      if (turn === generation)
        void researchDetail(main, id, turn).catch((e) =>
          inform(e.message, true),
        );
    }, 3000);
    return;
  }
  if (job.status !== "complete") {
    main.innerHTML += `<div class="callout warn">${esc(job.error || "This research was cancelled.")}</div><button id="rerun">Start a new run</button><p class="footer-note">A new run makes new provider calls. Review any recorded usage below.</p>`;
  }
  if (job.result) {
    const result = job.result;
    main.innerHTML += `<div class="columns report"><div><section class="panel"><div class="row spread"><h2>Company brief</h2>${status(result.identity.status)}</div><p>${esc(result.companySummary)}</p><p class="muted">${esc(result.identity.reason)}</p>${result.findings.map((f) => `<div class="list-item"><p>${esc(f.statement)}</p><small>Reported evidence date: ${esc(f.evidenceDate)}</small><br>${citations(f.sourceIds, sources)}</div>`).join("")}</section><div class="row spread"><h2>Catalog opportunities</h2><span class="status">${result.opportunities.length} to review</span></div><div class="callout">These are sales hypotheses, not confirmed requirements or compatibility decisions. Validate grade, specifications, stock, and the buyer’s actual process before quoting.</div>${
      result.opportunities.length
        ? result.opportunities
            .map((o, i) => {
              const review = job.reviews.find(
                (r) => r.productId === o.productId,
              );
              return `<article class="panel opportunity"><span class="eyebrow">${String(i + 1).padStart(2, "0")} / ${esc(o.type)}</span><h2>${esc(o.product.name)}</h2><p class="sku">${esc(o.product.sku)} · ${esc(o.product.source)}</p><div class="row">${!o.currentEligibility.eligible ? `<span class="status bad">${esc(o.currentEligibility.reasons.join(" · "))}</span>` : ""}${o.currentEligibility.availability === "unknown" ? '<span class="status warn">Confirm stock</span>' : ""}${!o.currentEligibility.regionVerified ? '<span class="status warn">Confirm selling region</span>' : ""}${o.catalogChanged ? '<span class="status warn">Inventory changed since research</span>' : ""}${o.evidenceCaution ? '<span class="status warn">Historical or undated evidence</span>' : ""}</div><p>${esc(o.rationale)}</p>${citations(o.sourceIds, sources)}<details><summary>Requirements and reasons this may not fit</summary><strong>Still needed</strong><ul class="plain-list">${o.missingRequirements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><strong>Disqualifying conditions</strong><ul class="plain-list">${o.disqualifiers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details><form id="review-${i}" data-product="${esc(o.productId)}"><h3>Ask the buyer</h3><div class="questions">${o.questions.map((q, n) => `<div class="question"><label for="answer-${i}-${n}">${esc(q)}</label><textarea id="answer-${i}-${n}" name="answer_${n}" maxlength="2000" placeholder="Capture their answer…">${esc(review?.answers[n] || "")}</textarea></div>`).join("")}</div><div class="fields two"><label class="field">Your decision<select name="decision">${["pending", "qualified", "rejected"].map((d) => `<option value="${d}" ${review?.decision === d ? "selected" : ""} ${d === "qualified" && !o.currentEligibility.eligible ? "disabled" : ""}>${d === "qualified" ? "Qualified by rep" : d === "rejected" ? "Not a fit" : "Needs more answers"}</option>`).join("")}</select></label><label class="field">Review note<textarea name="note" maxlength="2000" placeholder="What supports your decision?">${esc(review?.note || "")}</textarea></label></div><div class="form-actions"><button>Save answers & review</button><small>${review ? "Last saved " + esc(date(review.updatedAt)) : "Qualification requires an answer and a note."}</small></div></form></article>`;
            })
            .join("")
        : '<div class="empty"><h3>No supported matches yet</h3><p>Review the company identity and sources, or add more relevant product details to your inventory.</p></div>'
    }</div><aside><section class="panel"><h3>Research coverage</h3><p>${result.coverage.sentToModel} products compared<br>${result.coverage.eligible} eligible in examined catalog<br>${result.coverage.catalogTotal} total products</p>${result.coverage.truncated ? '<div class="callout warn">This is a shortlist, not a full catalog assessment. Narrow the objective or refine product descriptions for a different comparison.</div>' : ""}<p class="footer-note">Inactive, unavailable, stale, and region-excluded products are filtered out before matching.</p></section><section class="panel"><h3>Still unknown</h3><ul class="plain-list">${result.unknowns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section><section class="panel"><h3>Sources to check</h3><p class="footer-note">Citations show where the AI found evidence. Verify the source and its relevance to the intended site.</p><ol class="source-list">${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a><br><small>${esc(s.id)}</small></li>`).join("")}</ol></section></aside></div>`;
  }
  if (job.research)
    main.innerHTML += `<details class="panel"><summary>Full public research notes</summary><div class="pre">${esc(job.research.narrative)}</div></details>`;
  main.insertAdjacentHTML(
    "beforeend",
    `<details class="panel"><summary>Provider usage for this run</summary>${job.usage.length ? job.usage.map((u) => `<p class="footer-note">${esc(u.phase)} · ${esc(u.model)}<br>${u.inputTokens ?? "Unknown"} input / ${u.outputTokens ?? "Unknown"} output tokens · ${u.searchCalls} searches<br><span class="long">${esc(u.responseId)}</span></p>`).join("") : "<p>No completed provider calls recorded. An interrupted call may still have been billed.</p>"}</details>`,
  );
  // Appending markup above recreates descendants; bind review forms after the final append.
  if (job.result)
    job.result.opportunities.forEach((o, i) => {
      const form = document.querySelector("#review-" + i);
      if (form && !form.dataset.bound) {
        form.dataset.bound = "true";
        bindForm("review-" + i, async (input) => {
          await api("/research/" + id + "/reviews/" + o.productId, {
            decision: input.decision,
            note: input.note,
            answers: o.questions.map((_, n) => input["answer_" + n] || ""),
          });
          inform("Answers and review saved.");
        });
      }
    });
  if (job.status !== "complete")
    action("#rerun", async () => {
      const next = await api("/research", {
        ...job.input,
        requestKey: crypto.randomUUID(),
      });
      go("/research/" + next.id);
    });
}
function revealSecret(container, title, value) {
  document.querySelector(container).innerHTML =
    `<div class="secret"><strong>${esc(title)}</strong><p>Copy this now and share it securely with the intended recipient.</p><code>${esc(value)}</code><button class="secondary" id="copy-secret">Copy</button></div>`;
  action("#copy-secret", async () => {
    await navigator.clipboard.writeText(value);
    inform("Copied.");
  });
}
async function team(main) {
  if (session.user.role !== "owner")
    throw Error("Company owner access required.");
  const data = await api("/team");
  main.innerHTML =
    head(
      "The right people. The right access.",
      "Invite individual users into this company. Owners manage inventory, integrations, and access. Members research and qualify opportunities.",
      "03 / Team",
    ) +
    `<div class="columns"><section class="panel"><h2>Invite a colleague</h2><form id="invite-form"><div class="fields">${field("Email", "email", "email", "required")}<label class="field">Role<select name="role"><option value="member">Member · research and reviews</option><option value="owner">Owner · inventory and company administration</option></select></label></div><div class="form-actions"><button>Create invitation</button></div></form><div id="invitation"></div><p class="footer-note">Invitation links are one-use and expire in 24 hours. Share the link yourself; no email is sent automatically.</p></section><section class="panel"><h2>Company members</h2>${data.members.map((m) => `<div class="list-item row spread"><div class="long"><strong>${esc(m.email)}</strong><br><small>${esc(m.role)}</small></div>${m.id === session.user.userId ? "<small>You</small>" : `<button class="danger revoke-member" data-id="${esc(m.id)}">Revoke</button>`}</div>`).join("")}</section></div><section class="panel"><h2>Invitations</h2>${data.invites.map((i) => `<div class="list-item row spread"><div class="long">${esc(i.email)} · ${esc(i.role)}<br><small>${i.usedAt ? "Activated" : i.expiresAt < Date.now() ? "Expired or revoked" : "Expires " + esc(date(i.expiresAt))}</small></div>${!i.usedAt && i.expiresAt > Date.now() ? `<button class="secondary revoke-invite" data-id="${esc(i.id)}">Revoke</button>` : ""}</div>`).join("") || '<p class="muted">No invitations yet.</p>'}</section>`;
  bindForm("invite-form", async (input) => {
    const invite = await api("/team", input);
    revealSecret(
      "#invitation",
      "Invitation link",
      location.origin + url("/activate") + "#token=" + invite.token,
    );
  });
  action(".revoke-member", async (el) => {
    if (confirm("Revoke this person’s access to this company?")) {
      await api("/team/" + el.dataset.id, {}, "DELETE");
      await team(main);
    }
  });
  action(".revoke-invite", async (el) => {
    await api("/invites/" + el.dataset.id, {}, "DELETE");
    await team(main);
  });
}
async function settings(main) {
  const owner = session.user.role === "owner",
    tokens = owner ? await api("/tokens") : [];
  main.innerHTML =
    head(
      "Connect your systems. Control access.",
      "Each integration token writes to one inventory source in this company. Tokens cannot read research or company data.",
      "04 / Settings",
    ) +
    `<div class="metric-row"><div class="metric"><strong>${session.limits.usedCalls}/${session.limits.dailyCalls}</strong><span>Model calls reserved today · UTC</span></div><div class="metric"><strong>${session.researchConfigured ? "Ready" : "Offline"}</strong><span>AI provider</span></div></div>${owner ? `<div class="columns"><section class="panel"><h2>Create an inventory token</h2><form id="token-form"><div class="fields">${field("Source", "source", "text", 'value="erp" required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" maxlength="60"')}${field("Label", "label", "text", 'placeholder="Nightly warehouse sync" required maxlength="100"')}</div><div class="form-actions"><button>Create token</button></div></form><div id="new-token"></div><p class="footer-note">Use the <a href="https://github.com/pranavred/velug-associated-sales/blob/main/scripts/sync-inventory.mjs" target="_blank" rel="noopener noreferrer">sync script</a> or <a href="https://github.com/pranavred/velug-associated-sales/blob/main/docs/inventory-api.md" target="_blank" rel="noopener noreferrer">HTTP API</a> from your ERP, warehouse system, or scheduled export.</p></section><section class="panel"><h2>Integration tokens</h2>${tokens.map((t) => `<div class="list-item row spread"><div><strong>${esc(t.label)}</strong><br><small>${esc(t.source)} · ${t.revokedAt ? "Revoked" : esc(date(t.createdAt))}</small></div>${!t.revokedAt ? `<button class="danger revoke-token" data-id="${esc(t.id)}">Revoke</button>` : ""}</div>`).join("") || '<p class="muted">No integration tokens created.</p>'}</section></div>` : ""}<section class="panel"><h2>Deployment & data</h2><p>Company data stays separated by membership. AI research sends the target company details and shortlisted catalog descriptions to OpenAI. Stock quantities and account credentials are excluded from model requests.</p><p>Public web content and product text are untrusted inputs. Treat suggestions as leads for a conversation and check the evidence before qualification.</p><a href="https://github.com/pranavred/velug-associated-sales/blob/main/docs/self-hosting.md" target="_blank" rel="noopener noreferrer">Self-hosting, backups, and configuration ↗</a></section>${session.user.platformAdmin ? `<details class="panel"><summary>Instance administrator · create another company</summary><p class="muted">Creates a separate company and an invitation for its first owner.</p><form id="company-form"><div class="fields two">${field("Company name", "name", "text", 'required maxlength="150"')}${field("First owner email", "email", "email", "required")}</div><div class="form-actions"><button>Create company</button></div></form><div id="new-company"></div></details>` : ""}`;
  main.insertAdjacentHTML(
    "beforeend",
    `<details class="panel"><summary>Change your password</summary><form id="password-form"><div class="fields two">${field("Current password", "current", "password", 'required autocomplete="current-password"')}${field("New password · 14 characters minimum", "next", "password", 'required minlength="14" maxlength="256" autocomplete="new-password"')}</div><div class="form-actions"><button>Change password & sign out</button></div></form></details>`,
  );
  bindForm("password-form", async (input) => {
    await api("/account/password", input);
    session = null;
    inform("Password changed. Sign in with your new password.");
    go("/login");
  });
  bindForm("token-form", async (input) => {
    const result = await api("/tokens", input);
    revealSecret(
      "#new-token",
      "Inventory token · " + result.source,
      result.token,
    );
  });
  action(".revoke-token", async (el) => {
    if (confirm("Stop this integration from importing inventory?")) {
      await api("/tokens/" + el.dataset.id, {}, "DELETE");
      await settings(main);
    }
  });
  bindForm("company-form", async (input) => {
    const result = await api("/companies", input);
    revealSecret(
      "#new-company",
      "First owner invitation",
      location.origin + url("/activate") + "#token=" + result.token,
    );
  });
}
void render();
