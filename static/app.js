document.addEventListener('DOMContentLoaded', () => { try{ closeModal(); }catch(e){} });
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtDate = (iso) => { try { return new Date(iso+"T00:00:00").toLocaleDateString(); } catch { return iso; } };
const amtClass = (a) => (Number(a) >= 0 ? "pos" : "neg");

function openModal(title, bodyHtml, footerHtml="") {
  const bd = document.getElementById("modalBackdrop");
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalFooter").innerHTML = footerHtml;
  // Show (CSS driven)
  bd.classList.add("show");
  bd.classList.remove("hidden"); // legacy
}
function closeModal() {
  const bd = document.getElementById("modalBackdrop");
  bd.classList.remove("show");
  bd.classList.add("hidden"); // legacy
}


window.addEventListener("keydown", function(e){ if(e.key==="Escape"){ try{ closeModal(); }catch(_){} } });
document.addEventListener("click", function(e) {
  if (e.target && e.target.id === "modalClose") {
    closeModal();
  }
  if (e.target && e.target.id === "modalBackdrop") {
    closeModal();
  }
});
async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path, payload) {
  const r = await fetch(path, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPatch(url, data) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(data || {})
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}



function getActivePaycheckDate() {
  const proj = window.__PROJ || {};
  const periods = proj.periods || [];
  const today = new Date().toISOString().slice(0,10);
  if (!periods.length) return today;

  // Prefer the period that contains today
  for (const p of periods) {
    const s = p.start_date;
    const e = p.end_date;
    if (s && e && s <= today && today <= e) {
      return (p.paycheck && p.paycheck.date) ? p.paycheck.date : s;
    }
  }
  // Otherwise pick the nearest upcoming; if none, last period
  const upcoming = periods.find(p => (p.start_date || "") >= today);
  const chosen = upcoming || periods[periods.length - 1];
  return (chosen.paycheck && chosen.paycheck.date) ? chosen.paycheck.date : (chosen.start_date || today);
}


function setMonthJumpDefault(periods) {
  const picker = document.getElementById("monthJump");
  if (!picker || picker.value) return;
  const activePaycheck = getActivePaycheckDate();
  if (activePaycheck && activePaycheck.length >= 7) {
    picker.value = activePaycheck.slice(0,7);
    return;
  }
  const first = (periods || [])[0];
  if (first && first.start_date) picker.value = String(first.start_date).slice(0,7);
}

function initMonthJump() {
  const picker = document.getElementById("monthJump");
  if (!picker || picker.dataset.bound === "1") return;
  picker.dataset.bound = "1";

  picker.addEventListener("change", () => {
    const month = picker.value;
    if (!month) return;
    const periods = [...document.querySelectorAll(".period[data-month]")];
    if (!periods.length) return;

    let target = periods.find(el => (el.dataset.month || "") === month);
    if (!target) target = periods.find(el => (el.dataset.month || "") > month);
    if (!target) target = periods[periods.length - 1];
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("jump-highlight");
    setTimeout(() => target.classList.remove("jump-highlight"), 1400);
  });
}

async function refresh() {
  $("#statusText").textContent = "Loading…";
  const proj = await apiGet("/api/projection");
  window.__PROJ = proj;
  const periods = proj.periods || [];
  const settings = proj.settings || {};

  $("#timelineMeta").textContent = settings.anchor_date ? `Anchor payday: ${settings.anchor_date} • Horizon: ${settings.horizon_days || ""} days` : "";
  $("#periods").innerHTML = periods.map(renderPeriod).join("") || `<div class="muted">No pay periods yet. Click “Setup / Paychecks”.</div>`;
  setMonthJumpDefault(periods);
  initMonthJump();
  $("#statusText").textContent = "";
}


async function openArchiveExplorer() {
  try {
    const data = await apiGet("/api/archives");
    const items = (data && data.archives) ? data.archives : [];
    const rows = items.map(it => {
      const sd = it.start_date;
      const at = it.archived_at ? fmtDate(it.archived_at.slice(0,10)) : "";
      return `
        <div class="item">
          <div class="desc"><b>${escapeHtml(sd)}</b> <span class="muted">archived ${escapeHtml(at)}</span></div>
          <div class="actions"><button class="btn btn-secondary" data-action="undoArchive" data-start="${sd}">Undo</button></div>
        </div>
      `;
    }).join("");
    const body = `
      <div class="muted" style="margin-bottom:10px">Archived pay periods are hidden from the timeline. Undo restores them.</div>
      <div class="day">
        <div class="items">${rows || `<div class=\"muted\">No archived pay periods.</div>`}</div>
      </div>
    `;
    openModal("Archive Explorer", body, `<button class="btn" id="closeArchives">Close</button>`);
    $("#closeArchives").addEventListener("click", closeModal, { once:true });
  } catch (err) {
    console.error(err);
    alert("Could not load archives: " + (err && err.message ? err.message : err));
  }
}

function renderPeriod(period) {
  const s = period.start_date;
  const e = period.end_date;
  const paycheck = period.paycheck || {};
  const badge = period.three_paycheck_month ? `<span class="badge warn">3-paycheck month</span>` : `<span class="badge">Pay period</span>`;
  const acctBlocks = (period.accounts || []).map(a => `
    <div class="kv">
      <div class="k">${a.account_name}</div>
      <div class="v">${fmtMoney(a.end_balance)}</div>
      <div class="muted">Start ${fmtMoney(a.start_balance)} → End ${fmtMoney(a.end_balance)}</div>
    </div>
  `).join("");

  const personal = (period.accounts || []).find(x => x.account_id === 1) || period.accounts?.[0];
  const business = (period.accounts || []).find(x => x.account_id === 2) || period.accounts?.[1];

  return `
    <div class="period" id="period-${s}" data-start="${s}" data-month="${String(s || "").slice(0,7)}"><div class="payday-bar"><b>Payday</b> • ${paycheck.date || s} • <b>${fmtMoney(paycheck.amount || 0)}</b></div><div class="period-separator"></div>
      <div class="period-header">
        <div>
          <div style="font-weight:800">${fmtDate(s)} → ${fmtDate(e)}</div>
          <div class="muted">Payday: ${paycheck.date || s} • Paycheck: ${fmtMoney(paycheck.amount || 0)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end">
          ${badge}
          <span class="badge good">Rule: 1–15 = 1st-of-month</span>
          <button class="btn btn-secondary" data-action="archivePeriod" data-period="${s}">Archive</button>
        </div>
      </div>
      <div class="grid2">${acctBlocks}</div>
      <div style="height:10px"></div>
      <div class="lanes">
        ${renderLane(personal, "Personal Bills (Checking)")}
        ${renderLaneCC(period)}
        ${renderLane(business, "Business Bills (Checking)")}
        ${renderLaneCCBiz(period)}
      </div>
      <div class="footerline">
        <div>End Personal: <b>${personal ? fmtMoney(personal.end_balance) : "—"}</b></div>
        <div>End Business: <b>${business ? fmtMoney(business.end_balance) : "—"}</b></div>
      </div>
    </div>
  `;
}


function findTxById(txId) {
  const proj = window.__PROJ;
  if (!proj || !proj.periods) return null;
  for (const period of proj.periods) {
    for (const acct of (period.accounts || [])) {
      for (const day of (acct.days || [])) {
        for (const it of (day.items || [])) {
          if (it && it.id === txId) return it;
        }
      }
    }
  }
  return null;
}


function findCCById(snapshotId) {
  const proj = window.__PROJ;
  if (!proj || !proj.periods) return null;
  for (const period of proj.periods) {
    const ccLists = [];
    if (period.cc && period.cc.cards) ccLists.push({side:"personal", cards: period.cc.cards});
    if (period.cc_biz && period.cc_biz.cards) ccLists.push({side:"business", cards: period.cc_biz.cards});
    for (const block of ccLists) {
      for (const c of block.cards) {
        if (c && Number(c.id) === Number(snapshotId)) return {side: block.side, card: c};
      }
    }
  }
  return null;
}

async function openEditCCSnapshot(snapshotId) {
  const found = findCCById(snapshotId);
  if (!found) { alert("CC snapshot not found. Try refresh."); return; }
  const c = found.card;
  const side = found.side;

  const body = `
    <div class="formgrid">
      <label>Side
        <select id="cc_side">
          <option value="personal" ${side==="personal"?"selected":""}>Personal</option>
          <option value="business" ${side==="business"?"selected":""}>Business</option>
        </select>
      </label>
      <label>Snapshot date
        <input id="cc_date_edit" type="date" value="${(c.snapshot_date||"").slice(0,10)}">
      </label>
      <label>Card name
        <input id="cc_name_edit" type="text" value="${escapeAttr(c.name||"")}">
      </label>
      <label>Balance
        <input id="cc_bal_edit" type="number" step="0.01" value="${Number(c.balance||0)}">
      </label>
      <label>Manage URL (optional)
        <input id="cc_url_edit" type="url" placeholder="https://..." value="${escapeAttr(c.url||"")}">
      </label>
    </div>
  `;
  const footer = `
    <button class="btn btn-danger" id="deleteCC">Delete</button>
    <button class="btn" id="updateCC">Update</button>
  `;
  openModal("Edit CC Snapshot", body, footer);

  $("#updateCC").addEventListener("click", async () => {
    const payload = {
      side: $("#cc_side").value,
      snapshot_date: $("#cc_date_edit").value,
      name: $("#cc_name_edit").value.trim(),
      balance: Number($("#cc_bal_edit").value || 0),
      url: ($("#cc_url_edit").value || "").trim()
    };
    if (!payload.name) { alert("Card name required"); return; }
    if (!payload.snapshot_date) { alert("Snapshot date required"); return; }
    await apiPatch(`/api/cc_snapshots/${snapshotId}`, payload);
    closeModal();
    await refresh();
  }, { once:true });

  $("#deleteCC").addEventListener("click", async () => {
    if (!confirm("Delete this CC snapshot? This cannot be undone.")) return;
    await apiDelete(`/api/cc_snapshots/${snapshotId}`);
    closeModal();
    await refresh();
  }, { once:true });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  if (action === "archivePeriod") {
    const start = btn.getAttribute("data-period");
    if (!start) return;
    if (!confirm(`Archive pay period starting ${start}? This hides it from the timeline (you can undo in Archives).`)) return;
    (async () => {
      try {
        await apiPost(`/api/pay_periods/${start}/archive`, {});
        await refresh();
      } catch (err) {
        console.error(err);
        alert("Could not archive pay period: " + (err && err.message ? err.message : err));
      }
    })();
    return;
  }
  if (action === "undoArchive") {
    const sd = btn.getAttribute("data-start");
    if (!sd) return;
    (async () => {
      try {
        await apiDelete(`/api/pay_periods/${sd}/archive`);
        // Keep modal open but refresh list + timeline
        await openArchiveExplorer();
        await refresh();
      } catch (err) {
        console.error(err);
        alert("Could not undo archive: " + (err && err.message ? err.message : err));
      }
    })();
    return;
  }
    if (action === "editCCPeriod") {
    const periodStart = btn.getAttribute("data-period");
    const side = btn.getAttribute("data-side") || "personal";
    openCCPeriodBalances(periodStart, side);
    return;
  }

if (action === "editCC") {
    const sid = Number(btn.getAttribute("data-ccid"));
    if (sid) openEditCCSnapshot(sid);
  }
});

// Payment status chip (transactions + CC snapshots)
// Shows ONLY the current status. Clicking cycles: Pay -> Paid -> Reconciled -> Pay
document.addEventListener("click", async (e) => {
  const chip = e.target.closest(".paychip");
  if (!chip) return;

  const kind = chip.getAttribute("data-kind");
  const cur = normPayStatus(chip.getAttribute("data-status"));
  const next = (cur === "pay") ? "paid" : (cur === "paid") ? "reconciled" : "pay";

  // optimistic UI
  chip.setAttribute("data-status", next);
  chip.textContent = (next === "pay") ? "Pay" : (next === "paid") ? "Paid" : "Reconciled";
  chip.classList.toggle("st-pay", next === "pay");
  chip.classList.toggle("st-paid", next === "paid");
  chip.classList.toggle("st-reconciled", next === "reconciled");

  try {
    if (kind === "tx") {
      const id = Number(chip.getAttribute("data-id"));
      if (!id) return;
      await apiPatch(`/api/transactions/${id}`, { status: next });
      await refresh();
      return;
    }
    if (kind === "cc") {
      const idAttr = chip.getAttribute("data-id");
      const snap = chip.getAttribute("data-snap");
      const side = chip.getAttribute("data-side") || "personal";
      const name = chip.getAttribute("data-name") || "";
      const balance = Number(chip.getAttribute("data-balance") || 0);
      const url = chip.getAttribute("data-url") || null;

      // If snapshot row exists, patch it. If not, create a 0-balance snapshot row for this paycheck.
      if (idAttr) {
        const id = Number(idAttr);
        await apiPatch(`/api/cc_snapshots/${id}`, { name, snapshot_date: snap, side, balance, url, pay_status: next });
      } else {
        await apiPost("/api/cc_snapshots/save", { snapshot_date: snap, side, cards: [{ name, balance, url, pay_status: next }] });
      }
      await refresh();
      return;
    }
  } catch (err) {
    console.error(err);
    alert("Could not update status: " + (err && err.message ? err.message : err));
    await refresh();
  }
});

async function openEditTransaction(txId) {
  const tx = findTxById(txId);
  if (!tx) { alert("Transaction not found. Try refresh."); return; }

  const accounts = await apiGet("/api/accounts");
  const acctOptions = accounts.map(a => `<option value="${a.id}" ${Number(tx.account_id)===Number(a.id)?"selected":""}>${a.name}</option>`).join("");

  const body = `
    <div class="formgrid">
      <label>Account
        <select id="t_acct">${acctOptions}</select>
      </label>
      <label>Date
        <input id="t_date" type="date" value="${(tx.effective_date||"").slice(0,10)}">
      </label>
      <label>Description
        <input id="t_desc" type="text" value="${escapeHtml(tx.description||"")}">
      </label>
      <label>Manage URL (optional)
        <input id="t_url" type="url" placeholder="https://..." value="${escapeAttr(tx.url||"")}">
      </label>
      <label>Amount (expense negative, income positive)
        <input id="t_amt" type="number" step="0.01" value="${Number(tx.amount||0)}">
      </label>
      <label>Due day (optional)
        <input id="t_dueday" type="number" min="1" max="31" value="${tx.due_day ?? ""}">
      </label>
      <label>Due label (optional)
        <input id="t_duelabel" type="text" value="${escapeAttr(tx.due_label||"")}">
      </label>
    </div>
    <div class="muted">Tip: You can delete a transaction if it was entered by mistake. Paychecks can’t be edited here.</div>
  `;
  const footer = `
    <button class="btn btn-danger" id="deleteTx">Delete</button>
    <button class="btn" id="updateTx">Update</button>
  `;
  openModal("Edit Transaction", body, footer);

  $("#updateTx").addEventListener("click", async () => {
    try {
    const account_id = Number($("#t_acct").value);
    const effective_date = $("#t_date").value;
    const description = $("#t_desc").value.trim();
    const url = $("#t_url").value.trim() || null;
    const amount = Number($("#t_amt").value || 0);
    const due_day_raw = $("#t_dueday").value;
    const due_day = due_day_raw ? Number(due_day_raw) : null;
    const due_label = $("#t_duelabel").value.trim() || null;

    if (!description) { alert("Please enter a description"); return; }
    if (!effective_date) { alert("Please choose a date"); return; }

    await apiPatch(`/api/transactions/${txId}`, { account_id, effective_date, description, url, amount, due_day, due_label });
    closeModal();
    await refresh();
    } catch (err) {
      console.error(err);
      alert("Could not update transaction: " + (err && err.message ? err.message : err));
    }
  }, { once: true });

  $("#deleteTx").addEventListener("click", async () => {
    try {
      if (!confirm("Delete this transaction? This cannot be undone.")) return;
      await apiDelete(`/api/transactions/${txId}`);
      closeModal();
      await refresh();
    } catch (err) {
      console.error(err);
      alert("Could not delete transaction: " + (err && err.message ? err.message : err));
    }
  }, { once: true });
}

// Simple escaping helpers for putting text safely into attributes/values
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function escapeAttr(s){ return String(s).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function normPayStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "paid") return "paid";
  if (v === "reconciled") return "reconciled";
  // Back-compat: treat anything else (including "planned") as "pay"
  return "pay";
}

function renderPayStatusChip({ kind, id, url, status, snapDate, side, name, balance }) {
  const sel = normPayStatus(status);
  const label = (sel === "pay") ? "Pay" : (sel === "paid") ? "Paid" : "Reconciled";
  const cls = (sel === "pay") ? "st-pay" : (sel === "paid") ? "st-paid" : "st-reconciled";

  const data = [
    `data-kind="${kind}"`,
    (id != null ? `data-id="${id}"` : ""),
    (snapDate ? `data-snap="${snapDate}"` : ""),
    (side ? `data-side="${side}"` : ""),
    (name ? `data-name="${escapeAttr(name)}"` : ""),
    (balance != null ? `data-balance="${balance}"` : ""),
    (url ? `data-url="${escapeAttr(url)}"` : ""),
    `data-status="${sel}"`
  ].filter(Boolean).join(" ");

  return `<button type="button" class="paychip ${cls}" title="Click to cycle: Pay → Paid → Reconciled" ${data}>${label}</button>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  const txId = Number(btn.getAttribute("data-txid"));
  if (!txId) return;
  if (action === "editTx") openEditTransaction(txId);
});

function renderLane(acct, title) {
  if (!acct) return `<div class="lane"><h3>${title}</h3><div class="day"><div class="muted">No data.</div></div></div>`;
  const daysHtml = (acct.days || []).map(d => {
    const items = (d.items || []).map(it => `
      <div class="item">
        <div class="desc">${it.url ? `<a class="linkicon" href="${it.url}" target="_blank" rel="noopener" title="Open account">🔗</a> ${renderPayStatusChip({kind:"tx", id: it.id, url: it.url, status: it.status})} ` : `${renderPayStatusChip({kind:"tx", id: it.id, url: null, status: it.status})} `}${it.description || ""} ${it.due_label ? `<small>(${it.due_label})</small>` : ""}</div>
        <div class="amt ${amtClass(it.amount)}">${fmtMoney(it.amount)}</div>
        <div class="actions">${typeof it.id === "number" ? `<button class="iconbtn" data-action="editTx" data-txid="${it.id}" title="Edit / delete">✎</button>` : ``}</div>
      </div>
    `).join("");
    return `
      <div class="day">
        <div class="dayline">
          <div>${fmtDate(d.date)}</div>
          <div>Bal: <b>${fmtMoney(d.balance)}</b></div>
        </div>
        <div class="items">${items || `<div class="muted">—</div>`}</div>
      </div>
    `;
  }).join("");
  return `<div class="lane"><h3>${title}</h3>${daysHtml}</div>`;
}

function renderLaneCC(period) {
  const cc = period.cc || {cards:[], total:0};
  const rows = (cc.cards || []).map(c => `
    <div class="item">
      <div class="desc">${c.url ? `<a class="linkicon" href="${c.url}" target="_blank" rel="noopener" title="Open account">🔗</a> ` : ``}<span class="cc-label">${escapeHtml(c.name)}</span>${c.due_day ? ` <span class="due-bubble" title="Due day">${escapeHtml(c.due_day)}</span>` : ``} ${renderPayStatusChip({kind:"cc", id: c.id, url: c.url, status: c.pay_status, snapDate: period.start_date, side:"personal", name: c.name, balance: c.balance})}</div>
      <div class="amt ${amtClass(c.balance)}">${fmtMoney(c.balance)}</div>
      <div class="actions">${c.id ? `<button class="iconbtn" data-action="editCC" data-ccid="${c.id}" title="Edit / delete">✎</button>` : `<button class="iconbtn" data-action="editCCPeriod" data-side="personal" data-period="${period.start_date}" title="Edit balances for this paycheck">✎</button>`}</div>
    </div>
  `).join("");
  const totalRow = `<div class="item"><div class="desc"><b>Total CC</b></div><div class="amt neg"><b>${fmtMoney(cc.total)}</b></div></div>`;
  const btn = `<button class="btn btn-secondary btn-ccpay" data-period="${period.start_date}">Create CC payment (from Personal)</button>`;
  return `
    <div class="lane">
      <h3>Credit Cards (Snapshot)</h3><div class="lane-actions"><button class="btn btn-secondary" data-action="editCCPeriod" data-side="personal" data-period="${period.start_date}">Edit balances (this paycheck)</button></div>
      <div class="day">
        <div class="items">${rows || `<div class="muted">No cards yet. Click “CC Snapshots” to set up your cards.</div>`}</div>
        <div style="height:8px"></div>
        ${totalRow}
        <div style="height:10px"></div>
        ${btn}
        <div class="muted" style="margin-top:8px">Creates a single “cc” transaction in Personal Checking using the total above (default 6 days after payday).</div>
      </div>
    </div>
  `;
}

function renderLaneCCBiz(period) {
  const cc = period.cc_biz || {cards:[], total:0};
  const rows = (cc.cards || []).map(c => `
    <div class="item">
      <div class="desc">${c.url ? `<a class="linkicon" href="${c.url}" target="_blank" rel="noopener" title="Open account">🔗</a> ` : ``}<span class="cc-label">${escapeHtml(c.name)}</span>${c.due_day ? ` <span class="due-bubble" title="Due day">${escapeHtml(c.due_day)}</span>` : ``} ${renderPayStatusChip({kind:"cc", id: c.id, url: c.url, status: c.pay_status, snapDate: period.start_date, side:"business", name: c.name, balance: c.balance})}</div>
      <div class="amt ${amtClass(c.balance)}">${fmtMoney(c.balance)}</div>
      <div class="actions">${c.id ? `<button class="iconbtn" data-action="editCC" data-ccid="${c.id}" title="Edit / delete">✎</button>` : `<button class="iconbtn" data-action="editCCPeriod" data-side="business" data-period="${period.start_date}" title="Edit balances for this paycheck">✎</button>`}</div>
    </div>
  `).join("");
  const totalRow = `<div class="item"><div class="desc"><b>Total Biz CC</b></div><div class="amt neg"><b>${fmtMoney(cc.total)}</b></div></div>`;
  const btn = `<button class="btn btn-secondary btn-ccpay" data-side="business" data-period="${period.start_date}">Create cc-biz payment (from Business)</button>`;
  return `
    <div class="lane">
      <h3>Business CC (Snapshot)</h3><div class="lane-actions"><button class="btn btn-secondary" data-action="editCCPeriod" data-side="business" data-period="${period.start_date}">Edit balances (this paycheck)</button></div>
      <div class="day">
        <div class="items">${rows || `<div class="muted">No business cards yet. Click “CC Snapshots” and switch to Business.</div>`}</div>
        <div style="height:8px"></div>
        ${totalRow}
        <div style="height:10px"></div>
        ${btn}
      </div>
    </div>
  `;
}

$("#btnRefresh").addEventListener("click", refresh);

$("#btnArchives").addEventListener("click", openArchiveExplorer);

$("#btnSetup").addEventListener("click", async () => {
  const settings = await apiGet("/api/settings");
  const accounts = await apiGet("/api/accounts");

  const defaultAnchor = settings.anchor_date || new Date().toISOString().slice(0,10);
  const defaultAmount = settings.paycheck_amount || 0;
  const defaultAcct = settings.paycheck_account_id || 1;
  const defaultHorizon = settings.horizon_days || 365;

  const body = `
    <div class="form">
      <label>Anchor payday date
        <input id="s_anchor" type="date" value="${defaultAnchor}">
      </label>
      <label>Paycheck amount
        <input id="s_amount" type="number" step="0.01" value="${defaultAmount}">
      </label>
      <label>Paycheck deposits to account
        <select id="s_acct">
          ${accounts.map(a => `<option value="${a.id}" ${String(a.id)===String(defaultAcct)?"selected":""}>${a.name}</option>`).join("")}
        </select>
      </label>
      <label>Forecast horizon (days)
        <input id="s_horizon" type="number" value="${defaultHorizon}">
      </label>
      <div class="full" style="margin-top:6px; border-top:1px solid #243247; padding-top:10px">
        <div style="font-weight:800; margin-bottom:8px">Anchor balances on payday (optional)</div>
        ${accounts.map(a => `
          <label>${a.name} anchor balance
            <input id="bal_${a.id}" type="number" step="0.01" value="0">
          </label>
        `).join("")}
      </div>
    </div>
  `;
  const footer = `<button class="btn" id="saveSetup">Save & Generate</button>`;
  openModal("Setup / Generate Paychecks", body, footer);

  $("#saveSetup").addEventListener("click", async () => {
    try {
      const anchor_date = $("#s_anchor").value;
      const paycheck_amount = Number($("#s_amount").value || 0);
      const paycheck_account_id = Number($("#s_acct").value);
      const horizon_days = Number($("#s_horizon").value || 365);

      const anchor_balances = accounts.map(a => ({
        account_id: a.id,
        anchor_balance: Number(document.querySelector(`#bal_${a.id}`).value || 0)
      })).filter(x => x.anchor_balance !== 0);

      await apiPost("/api/setup", { anchor_date, paycheck_amount, paycheck_account_id, horizon_days, anchor_balances });
      closeModal();
      await refresh();
    } catch (err) {
      console.error(err);
      alert("Could not save setup: " + (err && err.message ? err.message : err));
    }
  }, { once: true });
});

$("#btnAddTx").addEventListener("click", async () => {
  const accounts = await apiGet("/api/accounts");
  const today = new Date().toISOString().slice(0,10);

  const body = `
    <div class="form">
      <label>Account
        <select id="t_acct">
          ${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}
        </select>
      </label>
      <label>Effective date (posts to balance)
        <input id="t_date" type="date" value="${today}">
      </label>
      <label>Description
        <input id="t_desc" type="text" placeholder="e.g., Mortgage, PEC, Greensky, Rental income">
      </label>
      <label>Manage URL (optional)
        <input id="t_url" type="url" placeholder="https://...">
      </label>
      <label>Amount (expense negative, income positive)
        <input id="t_amt" type="number" step="0.01" placeholder="-181.00">
      </label>
      <label>Due day (optional)
        <input id="t_dueday" type="number" min="1" max="31" placeholder="19">
      </label>
      <label>Due label (optional)
        <input id="t_duelabel" type="text" placeholder="19th / by the 9th">
      </label>
    </div>
  `;
  const footer = `<button class="btn" id="saveTx">Save</button>`;
  openModal("Add Transaction", body, footer);

  $("#saveTx").addEventListener("click", async () => {
    try {
    const account_id = Number($("#t_acct").value);
    const effective_date = $("#t_date").value;
    const description = $("#t_desc").value.trim();
    const url = $("#t_url").value.trim() || null;
    const amount = Number($("#t_amt").value || 0);
    const due_day_raw = $("#t_dueday").value;
    const due_day = due_day_raw ? Number(due_day_raw) : null;
    const due_label = $("#t_duelabel").value.trim() || null;

    if (!description) { alert("Please enter a description"); return; }
    if (!effective_date) { alert("Please choose a date"); return; }

    await apiPost("/api/transactions", { account_id, effective_date, description, url, amount, due_day, due_label });
    closeModal();
    await refresh();
    } catch (err) {
      console.error(err);
      alert("Could not save transaction: " + (err && err.message ? err.message : err));
    }
  }, { once: true });
});

async function openRecurringRulesManager() {
  const [accounts, settings, rules] = await Promise.all([
    apiGet("/api/accounts"),
    apiGet("/api/settings"),
    apiGet("/api/recurring_rules"),
  ]);
  const anchor = settings.anchor_date || new Date().toISOString().slice(0,10);
  const horizonDays = Number(settings.horizon_days || 365);
  const defaultToDate = new Date(new Date(anchor).getTime() + horizonDays*86400000).toISOString().slice(0,10);
  const acctName = (id) => (accounts.find(a => Number(a.id) === Number(id)) || {}).name || `Acct ${id}`;

  const listHtml = (rules || []).map(r => `
    <div class="item" style="grid-template-columns:1fr auto auto;">
      <div class="desc">
        <b>${escapeHtml(r.description || "")}</b>
        <div class="muted" style="margin-top:2px">
          ${escapeHtml(acctName(r.account_id))} • ${escapeHtml((r.cadence||"").toLowerCase())}${r.cadence==="monthly" && r.day_of_month ? ` • DOM ${r.day_of_month}` : ""}
          ${r.is_active ? "" : " • (inactive)"}
        </div>
      </div>
      <div class="amt ${amtClass(r.amount)}">${fmtMoney(r.amount)}</div>
      <div class="actions">
        <button class="btn btn-secondary" data-action="editRule" data-ruleid="${r.id}">Edit</button>
      </div>
    </div>
  `).join("") || `<div class="muted">No recurring rules yet.</div>`;

  const body = `
    <div class="muted" style="margin-bottom:10px">Manage recurring rules. Edit an existing rule, or create a new one.</div>
    <div class="items">${listHtml}</div>
    <div style="height:12px"></div>
    <button class="btn" id="btnNewRule" type="button">+ New Rule</button>
  `;
  openModal("Recurring Rules", body, ``);

  document.getElementById("btnNewRule").addEventListener("click", () => openRuleForm(null, accounts, anchor, defaultToDate), { once:true });

  // Delegate edit clicks
  document.getElementById("modalBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action='editRule']");
    if (!b) return;
    const id = Number(b.getAttribute("data-ruleid"));
    const rule = (rules || []).find(x => Number(x.id) === id);
    if (rule) openRuleForm(rule, accounts, anchor, defaultToDate);
  });
}

function openRuleForm(rule, accounts, anchor, defaultToDate) {
  const isEdit = !!rule;
  const syncActionLabel = isEdit ? "Save + Update" : "Save + Generate";
  const syncThroughLabel = isEdit ? "Update through" : "Generate through";
  const body = `
    <div class="form">
      <label>Account
        <select id="r_acct">
          ${accounts.map(a => `<option value="${a.id}" ${isEdit && Number(rule.account_id)===Number(a.id)?"selected":""}>${a.name}</option>`).join("")}
        </select>
      </label>
      <label>Cadence
        <select id="r_cadence">
          <option value="monthly" ${(isEdit?rule.cadence:"monthly")==="monthly"?"selected":""}>Monthly</option>
          <option value="biweekly" ${(isEdit?rule.cadence:"")==="biweekly"?"selected":""}>Bi-weekly</option>
        </select>
      </label>
      <label>Description
        <input id="r_desc" type="text" value="${escapeAttr(isEdit?rule.description:"")}" placeholder="e.g., Mortgage, Insurance">
      </label>
      <label>Manage URL (optional)
        <input id="r_url" type="url" value="${escapeAttr(isEdit?(rule.url||""):"")}" placeholder="https://..." />
      </label>
      <label>Amount
        <input id="r_amt" type="number" step="0.01" value="${isEdit?rule.amount:""}" placeholder="-2931.00">
      </label>
      <label>Day of month (monthly only)
        <input id="r_dom" type="number" min="1" max="31" value="${isEdit && rule.day_of_month?rule.day_of_month:""}" placeholder="1">
      </label>
      <label>Start date
        <input id="r_start" type="date" value="${isEdit?(rule.start_date||anchor):anchor}">
      </label>
      <label>Due day (optional; defaults to day-of-month)
        <input id="r_dueday" type="number" min="1" max="31" value="${isEdit && rule.due_day?rule.due_day:""}" placeholder="">
      </label>
      <label>Label as “by the Nth”
        <select id="r_by">
          <option value="0" ${(isEdit?Number(rule.by_day_of_month||0):0)===0?"selected":""}>No</option>
          <option value="1" ${(isEdit?Number(rule.by_day_of_month||0):0)===1?"selected":""}>Yes</option>
        </select>
      </label>
      <label>Active
        <select id="r_active">
          <option value="1" ${(isEdit?Number(rule.is_active||1):1)===1?"selected":""}>Yes</option>
          <option value="0" ${(isEdit?Number(rule.is_active||1):1)===0?"selected":""}>No</option>
        </select>
      </label>
      <label>${syncThroughLabel}
        <input id="r_to" type="date" value="${defaultToDate}">
      </label>
    </div>
  `;
  const footer = `
    <div style="display:flex; gap:8px; justify-content:flex-end; width:100%">
      ${isEdit?`<button class="btn btn-secondary" id="btnDeleteRule">Delete</button>`:""}
      <button class="btn btn-secondary" id="btnSaveRule">Save</button>
      <button class="btn" id="btnSaveGenRule">${syncActionLabel}</button>
    </div>
  `;
  openModal(isEdit?"Edit Recurring Rule":"New Recurring Rule", body, footer);

  const readForm = () => {
    const account_id = Number($("#r_acct").value);
    const cadence = $("#r_cadence").value;
    const description = $("#r_desc").value.trim();
    const url = $("#r_url").value.trim() || null;
    const amount = Number($("#r_amt").value || 0);
    const day_of_month = $("#r_dom").value ? Number($("#r_dom").value) : null;
    const start_date = $("#r_start").value;
    const due_day = $("#r_dueday").value ? Number($("#r_dueday").value) : null;
    const by_day_of_month = $("#r_by").value === "1";
    const is_active = $("#r_active").value === "1";
    const to_date = $("#r_to").value;

    if (!description) throw new Error("Please enter a description");
    if (!start_date) throw new Error("Please choose a start date");
    if (cadence === "monthly" && !day_of_month) throw new Error("Monthly rules need Day of month");

    return { account_id, cadence, description, url, amount, day_of_month, start_date, due_day, by_day_of_month, is_active, to_date };
  };

  async function saveRule(doGenerate) {
    const btn = doGenerate ? $("#btnSaveGenRule") : $("#btnSaveRule");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const f = readForm();
      let ruleId = isEdit ? Number(rule.id) : null;
      if (isEdit) {
        await apiPatch(`/api/recurring_rules/${ruleId}`, {
          account_id: f.account_id,
          cadence: f.cadence,
          description: f.description,
          amount: f.amount,
          day_of_month: f.day_of_month,
          start_date: f.start_date,
          due_day: f.due_day,
          by_day_of_month: f.by_day_of_month,
          url: f.url,
          is_active: f.is_active,
        });
      } else {
        const res = await apiPost("/api/recurring_rules", {
          account_id: f.account_id,
          cadence: f.cadence,
          description: f.description,
          amount: f.amount,
          day_of_month: f.day_of_month,
          start_date: f.start_date,
          due_day: f.due_day,
          by_day_of_month: f.by_day_of_month,
          url: f.url,
        });
        ruleId = res.id;
      }
      if (doGenerate && ruleId) {
        const syncEndpoint = isEdit
          ? `/api/recurring_rules/${ruleId}/update_future`
          : `/api/recurring_rules/${ruleId}/generate`;
        await apiPost(syncEndpoint, { to_date: f.to_date });
      }
      closeModal();
      await refresh();
    } catch (err) {
      console.error(err);
      alert(err && err.message ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = doGenerate ? syncActionLabel : "Save";
    }
  }

  $("#btnSaveRule").addEventListener("click", () => saveRule(false), { once:true });
  $("#btnSaveGenRule").addEventListener("click", () => saveRule(true), { once:true });
  if (isEdit) {
    $("#btnDeleteRule").addEventListener("click", async () => {
      if (!confirm("Delete this recurring rule?")) return;
      await apiDelete(`/api/recurring_rules/${rule.id}`);
      closeModal();
      await refresh();
    }, { once:true });
  }
}

$("#btnAddRule").addEventListener("click", openRecurringRulesManager);

refresh().catch(err => {
  $("#statusText").textContent = "Error loading projection. Click Setup / Paychecks first.";
  console.error(err);
});


// CC: Card setup (name/url/due day) + per-paycheck balances

async function openCCCards(sideDefault="personal") {
  let side = sideDefault;

  const rowHtml = (name="", url="", due_day="") => `
    <div class="ccrow cc-carddef">
      <input class="ccname" type="text" placeholder="Card name" value="${escapeAttr(name)}">
      <input class="ccurl" type="url" placeholder="Manage URL" value="${escapeAttr(url)}">
      <input class="ccdue" type="text" inputmode="numeric" maxlength="2" placeholder="DD" value="${escapeAttr(due_day)}">
      <button class="btn btn-secondary ccdel" type="button">Remove</button>
    </div>
  `;

  const load = async () => {
    const existing = await apiGet(`/api/cc_cards?side=${side}`).catch(()=>({cards:[]}));
    const cards = existing.cards || [];
    const body = `
      <div class="tabs">
        <button class="tabbtn ${side==="personal"?"active":""}" id="tabPersonal" type="button">Personal</button>
        <button class="tabbtn ${side==="business"?"active":""}" id="tabBusiness" type="button">Business</button>
      </div>
      <div class="muted">Define cards once: name, manage link, and 2-digit due day (01–31). Balances are entered per paycheck period.</div>
      <div style="height:10px"></div>
      <div id="cc_rows">
        ${(cards.length?cards:[{name:"",url:"",due_day:""}]).map(c => rowHtml(c.name, c.url||"", c.due_day||"" )).join("")}
      </div>
      <div style="height:10px"></div>
      <button class="btn btn-secondary" id="cc_add" type="button">Add Card</button>
    `;
    const footer = `<button class="btn" id="cc_save">Save Cards</button>`;
    openModal("Credit Card Setup", body, footer);

    const rowsDiv = document.getElementById("cc_rows");
    rowsDiv.addEventListener("click", (e) => {
      if (e.target && e.target.classList.contains("ccdel")) e.target.closest(".ccrow").remove();
    });
    document.getElementById("cc_add").addEventListener("click", () => {
      rowsDiv.insertAdjacentHTML("beforeend", rowHtml());
    });

    // only digits in DD
    rowsDiv.addEventListener("input", (e) => {
      if (!e.target || !e.target.classList.contains("ccdue")) return;
      let v = (e.target.value || "").replace(/\D/g, "");
      if (v.length > 2) v = v.slice(0,2);
      e.target.value = v;
    });

    document.getElementById("tabPersonal").addEventListener("click", async () => { side="personal"; await load(); }, { once:true });
    document.getElementById("tabBusiness").addEventListener("click", async () => { side="business"; await load(); }, { once:true });

    document.getElementById("cc_save").addEventListener("click", async () => {
      const rows = Array.from(document.querySelectorAll(".ccrow")).map(r => {
        const name = r.querySelector(".ccname").value.trim();
        const url = (r.querySelector(".ccurl")?.value || "").trim() || null;
        let due_day = (r.querySelector(".ccdue")?.value || "").trim();
        if (due_day && due_day.length === 1) due_day = "0" + due_day;
        return {name, url, due_day};
      }).filter(x => x.name);
      await apiPost("/api/cc_cards/save", { side, cards: rows });
      closeModal();
      await refresh();
    }, { once:true });
  };

  await load();
}


async function openCCPeriodBalances(paycheckDate, sideDefault="personal") {
  const snapshotDate = paycheckDate;
  let side = sideDefault;

  const rowHtml = (c) => `
    <div class="ccrow cc-balance">
      <div class="ccname readonly">${escapeHtml(c.name)}${c.due_day ? ` <span class="due-bubble" title="Due day">${escapeHtml(c.due_day)}</span>` : ``}</div>
      <input class="ccbal" type="number" step="0.01" value="${c.balance ?? 0}">
      <select class="ccstat" title="Payment status">
        <option value="pay" ${normPayStatus(c.pay_status)==="pay"?"selected":""}>Pay</option>
        <option value="paid" ${normPayStatus(c.pay_status)==="paid"?"selected":""}>Paid</option>
        <option value="reconciled" ${normPayStatus(c.pay_status)==="reconciled"?"selected":""}>Reconciled</option>
      </select>
      <div class="ccactions">${c.url ? `<a class="linkicon" href="${escapeAttr(c.url)}" target="_blank" rel="noopener" title="Open account">🔗</a>` : `<span class="muted">—</span>`}</div>
    </div>
  `;

  const load = async () => {
    const existing = await apiGet(`/api/cc_snapshots?as_of=${snapshotDate}&side=${side}`).catch(()=>({cards:[], total:0}));
    const cards = existing.cards || [];
    const body = `
      <div class="tabs">
        <button class="tabbtn ${side==="personal"?"active":""}" id="tabPersonal" type="button">Personal</button>
        <button class="tabbtn ${side==="business"?"active":""}" id="tabBusiness" type="button">Business</button>
      </div>
      <div class="muted">Balances for paycheck date <b>${snapshotDate}</b>.</div>
      <div style="height:10px"></div>
      <div id="cc_rows">
        ${(cards.length?cards:[{name:"",balance:0,url:"",due_day:""}]).map(c => rowHtml(c)).join("")}
      </div>
    `;
    const footer = `<button class="btn" id="cc_save">Save Balances</button>`;
    openModal(side==="business" ? "Business CC Balances" : "Personal CC Balances", body, footer);

    document.getElementById("tabPersonal").addEventListener("click", async () => { side="personal"; await load(); }, { once:true });
    document.getElementById("tabBusiness").addEventListener("click", async () => { side="business"; await load(); }, { once:true });

    document.getElementById("cc_save").addEventListener("click", async () => {
      const rowEls = Array.from(document.querySelectorAll("#cc_rows .ccrow"));
      const rows = rowEls.map((r, idx) => {
        const name = (cards[idx] && cards[idx].name) ? cards[idx].name : "";
        const balance = Number(r.querySelector(".ccbal")?.value || 0);
        const pay_status = r.querySelector(".ccstat")?.value || "pay";
        const url = (cards[idx] && cards[idx].url) ? cards[idx].url : null;
        return {name, balance, url, pay_status};
      }).filter(x => x.name);
      await apiPost("/api/cc_snapshots/save", { snapshot_date: snapshotDate, side, cards: rows });
      closeModal();
      await refresh();
    }, { once:true });
  };

  await load();
}


document.getElementById("btnCC").addEventListener("click", async () => {
  await openCCCards("personal");
});

// Delegate click for per-period CC payment button
document.addEventListener("click", async (e) => {
  if (e.target && e.target.classList.contains("btn-ccpay")) {
    const periodStart = e.target.getAttribute("data-period");
    try {
      const res = await apiPost("/api/cc/create_payment", { period_start: periodStart, offset_days: 6, side: (e.target.getAttribute("data-side")||"personal") });
      alert(res.skipped ? "CC payment already exists for that period/date." : `Created CC payment: ${fmtMoney(res.amount)}`);
      await refresh();
    } catch (err) {
      alert("Could not create CC payment. Add CC snapshots first.\n\n" + err);
    }
  }
});

document.addEventListener("DOMContentLoaded",()=>{
  const b=document.getElementById("exportSheetsBtn");
  if(b){
    b.onclick=async()=>{
      const r=await fetch("/api/export/google_sheet",{method:"POST"});
      const j=await r.json();
      alert(JSON.stringify(j));
    };
  }
});


// Calculator Widget
document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("calcWidget");
  const toggle = document.getElementById("calcToggle");
  const minBtn = document.getElementById("calcMinBtn");
  const display = document.getElementById("calcDisplay");

  toggle.onclick = () => {
    widget.style.display = "block";
    toggle.style.display = "none";
  };

  minBtn.onclick = () => {
    widget.style.display = "none";
    toggle.style.display = "block";
  };

  document.querySelectorAll(".calc-buttons button").forEach(btn=>{
    btn.onclick = () => {
      const val = btn.innerText;
      if(val==="="){
        try { display.value = eval(display.value); }
        catch { display.value = "Err"; }
      } else if(val==="C"){
        display.value = "";
      } else {
        display.value += val;
      }
    };
  });

  const header = document.getElementById("calcHeader");
  let offsetX=0, offsetY=0, dragging=false;

  header.onmousedown = (e)=>{
    dragging = true;
    offsetX = e.clientX - widget.offsetLeft;
    offsetY = e.clientY - widget.offsetTop;
  };

  document.onmousemove = (e)=>{
    if(!dragging) return;
    widget.style.left = (e.clientX - offsetX) + "px";
    widget.style.top = (e.clientY - offsetY) + "px";
  };

  document.onmouseup = ()=> dragging=false;
});
