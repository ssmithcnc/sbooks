const state = {
  settings: {},
  customers: [],
  products: [],
  documents: [],
  invoiceReport: null,
  documentFilter: "all",
  importPreview: null,
  emailDraft: null,
};

const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
const todayIso = () => new Date().toISOString().slice(0, 10);
const SMTP_PRESETS = {
  custom: {
    hint: "Use this for any provider. Enter host, port, username, password, and TLS mode manually.",
  },
  postmark: {
    host: "smtp.postmarkapp.com",
    port: "587",
    username: "",
    use_tls: true,
    hint: "Postmark SMTP uses smtp.postmarkapp.com on port 587 with STARTTLS. Use your server token as both username and password.",
  },
  resend: {
    host: "smtp.resend.com",
    port: "465",
    username: "resend",
    use_tls: false,
    hint: "Resend SMTP uses smtp.resend.com. Port 465 uses implicit SSL, so leave STARTTLS off. Username is resend and password is your Resend API key.",
  },
};

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function apiJson(path, method, payload) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function apiForm(path, formData) {
  const res = await fetch(path, { method: "POST", body: formData });
  if (!res.ok) throw await buildApiError(res);
  return res.json();
}

async function buildApiError(res) {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch (err) {
    bodyText = "";
  }
  let message = bodyText || `Request failed with status ${res.status}`;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
      message = parsed.error.trim();
    }
  } catch (err) {
  }
  const error = new Error(message);
  error.status = res.status;
  error.bodyText = bodyText;
  return error;
}

function setStatus(message) {
  $("#businessStatus").textContent = message || "";
}

function setEmailSendStatus(message, tone = "") {
  const el = $("#emailSendStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.remove("status-good", "status-bad");
  if (tone === "good") el.classList.add("status-good");
  if (tone === "bad") el.classList.add("status-bad");
}

function asCheckedValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(text);
}

function setFormValues(form, values) {
  Array.from(form.elements).forEach((el) => {
    if (!el.name) return;
    if (el.type === "checkbox") el.checked = asCheckedValue(values[el.name]);
    else el.value = values[el.name] ?? "";
  });
}

function formToObject(form) {
  const out = {};
  Array.from(form.elements).forEach((el) => {
    if (!el.name) return;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else out[el.name] = el.value;
  });
  return out;
}

function renderSettings() {
  setFormValues($("#settingsForm"), state.settings);
  const receiptPortalBtn = $("#receiptPortalBtn");
  if (receiptPortalBtn) {
    const base = String(state.settings.invoice_payment_url_base || "").trim();
    let receiptUrl = "https://project-rzdrv.vercel.app/receipts/upload";
    if (base) {
      if (base.endsWith("/invoice")) receiptUrl = `${base}/../receipts/upload`;
      else if (base.endsWith("/invoice/")) receiptUrl = `${base}../receipts/upload`;
      else receiptUrl = `${base.replace(/\/+$/, "")}/receipts/upload`;
    }
    try {
      receiptPortalBtn.href = new URL(receiptUrl, window.location.origin).toString();
    } catch (err) {
      receiptPortalBtn.href = "https://project-rzdrv.vercel.app/receipts/upload";
    }
  }
  updateSmtpProviderHint();
}

function documentPaymentSyncMeta(document) {
  if (!document) return "Desktop-only until you publish this invoice to the hosted payment service.";
  if (!document.cloud_public_id) return "Desktop-only until you publish this invoice to the hosted payment service.";
  const status = document.cloud_sync_status || "synced";
  const syncedAt = document.cloud_synced_at ? ` on ${document.cloud_synced_at}` : "";
  const paymentUrl = document.payment_url ? ` | ${document.payment_url}` : "";
  return `Hosted payment ID ${document.cloud_public_id} | sync status: ${status}${syncedAt}${paymentUrl}`;
}

function renderCustomers() {
  const rows = state.customers.map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.email || "")}</td>
      <td>${escapeHtml(c.phone || "")}</td>
      <td>${c.is_active ? "Active" : "Inactive"}</td>
      <td class="row-actions">
        <button class="btn btn-secondary" type="button" data-edit-customer="${c.id}">Edit</button>
        <button class="btn btn-secondary" type="button" data-delete-customer="${c.id}">Delete</button>
      </td>
    </tr>
  `).join("");
  $("#customersTable").innerHTML = `
    <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="muted">No customers yet.</td></tr>`}</tbody>
  `;
  renderCustomerOptions();
}

function renderProducts() {
  const rows = state.products.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.sku || "")}</td>
      <td>${fmtMoney(p.default_unit_price)}</td>
      <td>${p.taxable ? "Taxable" : "Non-taxable"}</td>
      <td class="row-actions">
        <button class="btn btn-secondary" type="button" data-edit-product="${p.id}">Edit</button>
        <button class="btn btn-secondary" type="button" data-delete-product="${p.id}">Delete</button>
      </td>
    </tr>
  `).join("");
  $("#productsTable").innerHTML = `
    <thead><tr><th>Name</th><th>SKU</th><th>Price</th><th>Tax</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="muted">No products yet.</td></tr>`}</tbody>
  `;
}

function renderCustomerOptions() {
  const options = state.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  const select = $("#documentForm select[name='customer_id']");
  select.innerHTML = options || `<option value="">No customers available</option>`;
}

function filteredDocuments() {
  if (state.documentFilter === "all") return state.documents;
  return state.documents.filter((d) => d.type === state.documentFilter);
}

function renderDocuments() {
  const rows = filteredDocuments().map((d) => `
    <tr>
      <td>${escapeHtml(d.type)}</td>
      <td>${escapeHtml(d.number)}</td>
      <td>${escapeHtml(d.customer_name)}</td>
      <td>${escapeHtml(d.issue_date || "")}</td>
      <td>${escapeHtml(d.status || "")}</td>
      <td>${fmtMoney(d.total)}</td>
      <td>${d.cloud_public_id ? `Hosted: ${escapeHtml(d.cloud_sync_status || "synced")}` : (d.imported ? "Imported" : "Local")}</td>
      <td class="row-actions">
        <button class="btn btn-secondary" type="button" data-edit-document="${d.id}">Edit</button>
        ${d.type === "estimate" ? `<button class="btn btn-secondary" type="button" data-convert-document="${d.id}">Convert</button>` : ``}
        ${d.type === "invoice" ? `<button class="btn btn-secondary" type="button" data-publish-document="${d.id}">${d.cloud_public_id ? "Republish Pay Link" : "Publish Pay Link"}</button>` : ``}
        ${d.type === "invoice" ? `<button class="btn btn-secondary" type="button" data-review-email="${d.id}">Review & Send</button>` : ``}
        <a class="btn btn-secondary" target="_blank" rel="noopener" href="/api/documents/${d.id}/print">Print</a>
        <a class="btn btn-secondary" href="/api/documents/${d.id}/pdf">PDF</a>
        <button class="btn btn-secondary" type="button" data-delete-document="${d.id}">Delete</button>
      </td>
    </tr>
  `).join("");
  $("#documentsTable").innerHTML = `
    <thead><tr><th>Type</th><th>Number</th><th>Customer</th><th>Issue</th><th>Status</th><th>Total</th><th>Source</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="muted">No documents yet.</td></tr>`}</tbody>
  `;
}

function defaultReportMonth() {
  return new Date().toISOString().slice(0, 7);
}

function invoiceReportUrl(kind = "json") {
  const month = $("#invoiceReportMonth")?.value || defaultReportMonth();
  const query = `month=${encodeURIComponent(month)}`;
  if (kind === "csv") return `/api/reports/invoices/csv?${query}`;
  if (kind === "pdf") return `/api/reports/invoices/pdf?${query}`;
  return `/api/reports/invoices?${query}`;
}

function renderInvoiceReport() {
  const monthInput = $("#invoiceReportMonth");
  if (monthInput && !monthInput.value) monthInput.value = defaultReportMonth();
  $("#invoiceReportCsvBtn").href = invoiceReportUrl("csv");
  $("#invoiceReportPdfBtn").href = invoiceReportUrl("pdf");

  const report = state.invoiceReport;
  if (!report) {
    $("#invoiceReportSummary").innerHTML = "";
    $("#invoiceReportTable").innerHTML = `<tbody><tr><td class="muted">Load a month to see invoice totals.</td></tr></tbody>`;
    return;
  }

  $("#invoiceReportSummary").innerHTML = `
    <div><span>Month</span><b>${escapeHtml(report.month_label)}</b></div>
    <div><span>Invoices</span><b>${Number(report.invoice_count || 0)}</b></div>
    <div><span>Pre-tax</span><b>${fmtMoney(report.summary?.subtotal || 0)}</b></div>
    <div><span>Tax</span><b>${fmtMoney(report.summary?.tax_amount || 0)}</b></div>
    <div><span>Total</span><b>${fmtMoney(report.summary?.total || 0)}</b></div>
  `;

  const rows = (report.invoices || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.number)}</td>
      <td>${escapeHtml(item.issue_date || "")}</td>
      <td>${escapeHtml(item.due_date || "")}</td>
      <td>${escapeHtml(item.customer_name || "")}</td>
      <td>${escapeHtml(item.status || "")}</td>
      <td>${fmtMoney(item.subtotal || 0)}</td>
      <td>${fmtMoney(item.tax_amount || 0)}</td>
      <td>${fmtMoney(item.total || 0)}</td>
    </tr>
  `).join("");

  $("#invoiceReportTable").innerHTML = `
    <thead><tr><th>Invoice</th><th>Issue</th><th>Due</th><th>Customer</th><th>Status</th><th>Pre-tax</th><th>Tax</th><th>Total</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="muted">No invoices found for ${escapeHtml(report.month_label)}.</td></tr>`}</tbody>
  `;
}

function emptyLine() {
  return { product_id: "", description: "", quantity: 1, unit_price: 0, taxable: true };
}

function getLineRows() {
  return Array.from(document.querySelectorAll(".line-item")).map((row) => ({
    product_id: row.querySelector("[data-line-product]").value || null,
    description: row.querySelector("[data-line-description]").value,
    quantity: Number(row.querySelector("[data-line-qty]").value || 0),
    unit_price: Number(row.querySelector("[data-line-price]").value || 0),
    taxable: row.querySelector("[data-line-taxable]").checked,
  }));
}

function computeTotals(lines, taxRate) {
  let subtotal = 0;
  let taxableSubtotal = 0;
  for (const line of lines) {
    const amount = Number(line.quantity || 0) * Number(line.unit_price || 0);
    subtotal += amount;
    if (line.taxable) taxableSubtotal += amount;
  }
  const taxAmount = taxableSubtotal * (Number(taxRate || 0) / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function renderDocumentTotals() {
  const taxRate = Number($("#documentForm [name='tax_rate']").value || 0);
  const totals = computeTotals(getLineRows(), taxRate);
  $("#documentTotals").innerHTML = `
    <div><span>Subtotal</span><b>${fmtMoney(totals.subtotal)}</b></div>
    <div><span>Tax</span><b>${fmtMoney(totals.taxAmount)}</b></div>
    <div><span>Total</span><b>${fmtMoney(totals.total)}</b></div>
  `;
}

function lineRowHtml(line = emptyLine()) {
  const productOptions = ['<option value="">Manual item</option>']
    .concat(state.products.map((p) => `<option value="${p.id}" ${Number(line.product_id) === Number(p.id) ? "selected" : ""}>${escapeHtml(p.name)}</option>`))
    .join("");
  return `
    <div class="line-item">
      <select data-line-product>${productOptions}</select>
      <input type="text" data-line-description placeholder="Description" value="${escapeAttr(line.description || "")}">
      <input type="number" data-line-qty min="0" step="0.01" value="${Number(line.quantity || 0)}">
      <input type="number" data-line-price min="0" step="0.01" value="${Number(line.unit_price || 0)}">
      <label class="checkboxline inline-check">
        <input type="checkbox" data-line-taxable ${line.taxable ? "checked" : ""}>
        <span>Taxable</span>
      </label>
      <button class="btn btn-secondary" type="button" data-remove-line>Remove</button>
    </div>
  `;
}

function renderDocumentLines(lines = [emptyLine()]) {
  $("#documentLines").innerHTML = lines.map((line) => lineRowHtml(line)).join("");
  renderDocumentTotals();
}

function resetCustomerForm() {
  setFormValues($("#customerForm"), { id: "", name: "", contact_name: "", email: "", phone: "", billing_address: "", notes: "", is_active: true });
}

function resetProductForm() {
  setFormValues($("#productForm"), { id: "", name: "", description: "", sku: "", default_unit_price: "", taxable: true, is_active: true });
}

function resetDocumentForm() {
  setFormValues($("#documentForm"), {
    id: "",
    type: "estimate",
    number: "",
    customer_id: state.customers[0]?.id || "",
    issue_date: todayIso(),
    due_date: "",
    status: "draft",
    tax_rate: state.settings.default_tax_rate || 0,
    notes: "",
    terms: state.settings.default_terms || "",
    accept_manual_ach: asCheckedValue(state.settings.default_accept_manual_ach),
    accept_stripe_card: asCheckedValue(state.settings.default_accept_stripe_card),
    accept_stripe_ach: asCheckedValue(state.settings.default_accept_stripe_ach),
    accept_paypal: asCheckedValue(state.settings.default_accept_paypal),
    accept_venmo: asCheckedValue(state.settings.default_accept_venmo),
    use_full_portal: true,
  });
  $("#documentPaymentSyncMeta").textContent = documentPaymentSyncMeta(null);
  renderDocumentLines([emptyLine()]);
}

function renderImportPreview() {
  const preview = state.importPreview;
  $("#commitImportBtn").disabled = !preview || (preview.errors || []).length > 0;
  if (!preview) {
    $("#importSummary").textContent = "";
    $("#importWarnings").innerHTML = "";
    $("#importErrors").innerHTML = "";
    return;
  }
  const summary = preview.summary || {};
  $("#importSummary").textContent = `Preview ready: ${summary.customers || 0} customers, ${summary.products || 0} products, ${summary.documents || 0} documents.`;
  $("#importWarnings").innerHTML = (preview.warnings || []).map((m) => `<div class="muted">${escapeHtml(m)}</div>`).join("");
  $("#importErrors").innerHTML = (preview.errors || []).map((m) => `<div>${escapeHtml(m)}</div>`).join("");
}

function renderEmailComposer() {
  const panel = $("#emailComposerPanel");
  const preview = $("#emailPreview");
  if (!state.emailDraft) {
    panel.classList.add("hidden");
    preview.innerHTML = "";
    setEmailSendStatus("");
    return;
  }
  const { draft, document } = state.emailDraft;
  panel.classList.remove("hidden");
  setFormValues($("#emailComposerForm"), {
    document_id: document.id,
    to: draft.to || "",
    subject: draft.subject || "",
    html: draft.html || "",
    text: draft.text || "",
  });
  $("#emailComposerMeta").textContent = `Invoice ${document.number} for ${document.customer.name} | ${fmtMoney(document.total)}`;
  $("#emailPaymentLink").href = draft.payment_url || `/pay/${document.id}`;
  preview.innerHTML = draft.preview_html || draft.html || `<div class="muted">No preview available.</div>`;
}

function updateSmtpProviderHint() {
  const provider = $("#settingsForm [name='smtp_provider']")?.value || "custom";
  $("#smtpProviderHint").textContent = SMTP_PRESETS[provider]?.hint || SMTP_PRESETS.custom.hint;
}

function applySmtpPreset(provider, force = false) {
  const preset = SMTP_PRESETS[provider];
  if (!preset) return;
  const form = $("#settingsForm");
  const host = form.querySelector("[name='smtp_host']");
  const port = form.querySelector("[name='smtp_port']");
  const username = form.querySelector("[name='smtp_username']");
  const useTls = form.querySelector("[name='smtp_use_tls']");
  if (force || !host.value) host.value = preset.host || "";
  if (force || !port.value) port.value = preset.port || "";
  if ((force || !username.value) && preset.username !== undefined) username.value = preset.username;
  if (preset.use_tls !== undefined) useTls.checked = Boolean(preset.use_tls);
  updateSmtpProviderHint();
}

async function loadAll() {
  setStatus("Loading business data...");
  const settings = await apiGet("/api/business_settings");
  let syncSummary = "";
  if (settings.supabase_url && settings.supabase_secret_key && settings.invoice_payment_url_base) {
    try {
      const sync = await apiJson("/api/hosted_payments/sync", "POST", {});
      if (sync.updated) {
        const paidInvoices = (sync.updated_documents || []).filter((doc) => doc.to_status === "paid");
        if (paidInvoices.length) {
          const labels = paidInvoices.map((doc) => doc.number || `#${doc.id}`).slice(0, 3);
          const extra = paidInvoices.length > 3 ? ` and ${paidInvoices.length - 3} more` : "";
          syncSummary = `${paidInvoices.length === 1 ? "Marked" : "Marked"} ${labels.join(", ")} ${paidInvoices.length === 1 ? "paid" : "paid"}${extra}.`;
        } else {
          syncSummary = `Synced ${sync.updated} hosted invoice${sync.updated === 1 ? "" : "s"}.`;
        }
      }
    } catch (err) {
      console.warn("Hosted payment sync failed", err);
    }
  }
  const [customers, products, documents] = await Promise.all([
    apiGet("/api/customers"),
    apiGet("/api/products"),
    apiGet("/api/documents")
  ]);
  state.settings = settings;
  state.customers = customers;
  state.products = products;
  state.documents = documents;
  renderSettings();
  renderCustomers();
  renderProducts();
  renderDocuments();
  renderInvoiceReport();
  resetDocumentForm();
  renderImportPreview();
  renderEmailComposer();
  setStatus(syncSummary.trim());
}

async function loadInvoiceReport() {
  const response = await apiGet(invoiceReportUrl("json"));
  state.invoiceReport = response.report || null;
  renderInvoiceReport();
  setStatus(`Invoice report loaded for ${state.invoiceReport?.month_label || ($("#invoiceReportMonth")?.value || defaultReportMonth())}.`);
}

function escapeHtml(s) {
  return String(s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = formToObject($("#settingsForm"));
  await apiJson("/api/business_settings", "PUT", payload);
  state.settings = await apiGet("/api/business_settings");
  renderSettings();
  resetDocumentForm();
  setStatus("Business profile saved.");
}

async function saveCustomer(e) {
  e.preventDefault();
  const payload = formToObject($("#customerForm"));
  const id = payload.id;
  delete payload.id;
  if (id) await apiJson(`/api/customers/${id}`, "PATCH", payload);
  else await apiJson("/api/customers", "POST", payload);
  await loadAll();
  resetCustomerForm();
  setStatus("Customer saved.");
}

async function saveProduct(e) {
  e.preventDefault();
  const payload = formToObject($("#productForm"));
  const id = payload.id;
  delete payload.id;
  if (id) await apiJson(`/api/products/${id}`, "PATCH", payload);
  else await apiJson("/api/products", "POST", payload);
  await loadAll();
  resetProductForm();
  setStatus("Product saved.");
}

async function saveDocument(e) {
  e.preventDefault();
  const payload = formToObject($("#documentForm"));
  const id = payload.id;
  delete payload.id;
  payload.lines = getLineRows().filter((line) => line.description || line.product_id);
  if (!payload.lines.length) {
    alert("Add at least one line item.");
    return;
  }
  if (payload.type === "estimate") payload.status = "draft";
  if (id) await apiJson(`/api/documents/${id}`, "PATCH", payload);
  else await apiJson("/api/documents", "POST", payload);
  await loadAll();
  resetDocumentForm();
  setStatus("Document saved.");
}

async function previewImport() {
  const form = $("#importForm");
  const fd = new FormData(form);
  state.importPreview = await apiForm("/api/import/quickbooks/preview", fd);
  renderImportPreview();
  setStatus("Import preview ready.");
}

async function commitImport() {
  if (!state.importPreview) return;
  await apiJson("/api/import/quickbooks/commit", "POST", { preview: state.importPreview });
  state.importPreview = null;
  $("#importForm").reset();
  renderImportPreview();
  await loadAll();
  setStatus("QuickBooks data imported.");
}

async function editDocument(id) {
  const document = await apiGet(`/api/documents/${id}`);
  setFormValues($("#documentForm"), {
    id: document.id,
    type: document.type,
    number: document.number,
    customer_id: document.customer_id,
    issue_date: document.issue_date,
    due_date: document.due_date || "",
    status: document.status,
    tax_rate: document.tax_rate,
    notes: document.notes || "",
    terms: document.terms || "",
    accept_manual_ach: document.accept_manual_ach,
    accept_stripe_card: document.accept_stripe_card,
    accept_stripe_ach: document.accept_stripe_ach,
    accept_paypal: document.accept_paypal,
    accept_venmo: document.accept_venmo,
    use_full_portal: document.use_full_portal,
  });
  $("#documentPaymentSyncMeta").textContent = documentPaymentSyncMeta(document);
  renderDocumentLines(document.lines || [emptyLine()]);
  window.scrollTo({ top: $("#documentForm").offsetTop - 80, behavior: "smooth" });
}

async function loadEmailDraft(id) {
  state.emailDraft = await apiGet(`/api/documents/${id}/email_draft`);
  renderEmailComposer();
  const sentTo = state.emailDraft.document.last_sent_to;
  const sentAt = state.emailDraft.document.last_sent_at;
  const lastError = state.emailDraft.document.last_email_error;
  if (sentTo && sentAt) {
    setEmailSendStatus(`Last sent to ${sentTo} at ${sentAt}.`, "good");
  } else if (lastError) {
    setEmailSendStatus(`Last send failed: ${lastError}`, "bad");
  } else {
    setEmailSendStatus("");
  }
  window.scrollTo({ top: $("#emailComposerPanel").offsetTop - 80, behavior: "smooth" });
}

async function publishDocumentPayment() {
  const documentId = $("#documentForm [name='id']").value;
  if (!documentId) {
    alert("Load or save an invoice first.");
    return;
  }
  const response = await apiJson(`/api/documents/${documentId}/publish_payment`, "POST", {});
  await loadAll();
  const fresh = await apiGet(`/api/documents/${documentId}`);
  $("#documentPaymentSyncMeta").textContent = documentPaymentSyncMeta(fresh);
  const paymentUrl = response.payment_url || fresh.payment_url;
  const statusMessage = response.message || `Hosted payment page published for ${fresh.number}.`;
  setStatus(paymentUrl ? `${statusMessage} ${paymentUrl}` : statusMessage);
  if ($("#emailComposerForm [name='document_id']").value === String(documentId)) {
    await loadEmailDraft(documentId);
  }
}

async function refreshEmailDraft() {
  const documentId = $("#emailComposerForm [name='document_id']").value;
  if (!documentId) return;
  await loadEmailDraft(documentId);
  setStatus("Email draft refreshed.");
}

async function sendInvoiceEmail() {
  const form = $("#emailComposerForm");
  const payload = formToObject(form);
  const documentId = payload.document_id;
  if (!documentId) {
    alert("Review an invoice email first.");
    return;
  }
  setEmailSendStatus("Sending invoice email...");
  const response = await apiJson(`/api/documents/${documentId}/send_email`, "POST", payload);
  await loadAll();
  await loadEmailDraft(documentId);
  const message = response?.message || `Invoice email sent to ${payload.to}.`;
  setStatus(message);
  setEmailSendStatus(message, "good");
}

function bindEvents() {
  $("#settingsForm").addEventListener("submit", (e) => saveSettings(e).catch(showError));
  $("#customerForm").addEventListener("submit", (e) => saveCustomer(e).catch(showError));
  $("#productForm").addEventListener("submit", (e) => saveProduct(e).catch(showError));
  $("#documentForm").addEventListener("submit", (e) => saveDocument(e).catch(showError));
  $("#previewImportBtn").addEventListener("click", () => previewImport().catch(showError));
  $("#commitImportBtn").addEventListener("click", () => commitImport().catch(showError));
  $("#refreshBusinessBtn").addEventListener("click", () => loadAll().catch(showError));
  $("#loadInvoiceReportBtn").addEventListener("click", () => loadInvoiceReport().catch(showError));
  $("#refreshEmailDraftBtn").addEventListener("click", () => refreshEmailDraft().catch(showError));
  $("#sendInvoiceEmailBtn").addEventListener("click", () => sendInvoiceEmail().catch(showError));
  $("#publishDocumentBtn").addEventListener("click", () => publishDocumentPayment().catch(showError));
  $("#smtpProviderSelect").addEventListener("change", (e) => {
    applySmtpPreset(e.target.value, true);
  });
  $("#resetCustomerBtn").addEventListener("click", resetCustomerForm);
  $("#resetProductBtn").addEventListener("click", resetProductForm);
  $("#resetDocumentBtn").addEventListener("click", resetDocumentForm);
  $("#addLineBtn").addEventListener("click", () => {
    $("#documentLines").insertAdjacentHTML("beforeend", lineRowHtml(emptyLine()));
    renderDocumentTotals();
  });

  document.addEventListener("input", (e) => {
    if (e.target.closest("#documentForm")) renderDocumentTotals();
    if (e.target.id === "invoiceReportMonth") renderInvoiceReport();
    if (e.target.closest("#emailComposerForm")) {
      $("#emailPreview").innerHTML = $("#emailComposerForm [name='html']").value || "";
    }
  });

  document.addEventListener("change", (e) => {
    const line = e.target.closest(".line-item");
    if (!line) return;
    if (e.target.matches("[data-line-product]")) {
      const product = state.products.find((p) => Number(p.id) === Number(e.target.value));
      if (product) {
        line.querySelector("[data-line-description]").value = product.description || product.name;
        line.querySelector("[data-line-price]").value = Number(product.default_unit_price || 0);
        line.querySelector("[data-line-taxable]").checked = Boolean(product.taxable);
        renderDocumentTotals();
      }
    }
  });

  document.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove-line]");
    if (removeBtn) {
      removeBtn.closest(".line-item").remove();
      if (!document.querySelector(".line-item")) renderDocumentLines([emptyLine()]);
      renderDocumentTotals();
      return;
    }
    const customerEdit = e.target.closest("[data-edit-customer]");
    if (customerEdit) {
      const customer = state.customers.find((c) => Number(c.id) === Number(customerEdit.dataset.editCustomer));
      if (customer) setFormValues($("#customerForm"), customer);
      return;
    }
    const customerDelete = e.target.closest("[data-delete-customer]");
    if (customerDelete && confirm("Delete this customer?")) {
      await apiJson(`/api/customers/${customerDelete.dataset.deleteCustomer}`, "DELETE");
      await loadAll();
      return;
    }
    const productEdit = e.target.closest("[data-edit-product]");
    if (productEdit) {
      const product = state.products.find((p) => Number(p.id) === Number(productEdit.dataset.editProduct));
      if (product) setFormValues($("#productForm"), product);
      return;
    }
    const productDelete = e.target.closest("[data-delete-product]");
    if (productDelete && confirm("Delete this product?")) {
      await apiJson(`/api/products/${productDelete.dataset.deleteProduct}`, "DELETE");
      await loadAll();
      return;
    }
    const docEdit = e.target.closest("[data-edit-document]");
    if (docEdit) {
      await editDocument(docEdit.dataset.editDocument);
      return;
    }
    const docDelete = e.target.closest("[data-delete-document]");
    if (docDelete && confirm("Delete this document?")) {
      await apiJson(`/api/documents/${docDelete.dataset.deleteDocument}`, "DELETE");
      await loadAll();
      return;
    }
    const docConvert = e.target.closest("[data-convert-document]");
    if (docConvert) {
      await apiJson(`/api/documents/${docConvert.dataset.convertDocument}/convert_to_invoice`, "POST", {});
      await loadAll();
      setStatus("Estimate converted to invoice.");
      return;
    }
    const docReview = e.target.closest("[data-review-email]");
    if (docReview) {
      await loadEmailDraft(docReview.dataset.reviewEmail);
      setStatus("Invoice email draft loaded.");
      return;
    }
    const docPublish = e.target.closest("[data-publish-document]");
    if (docPublish) {
      await apiJson(`/api/documents/${docPublish.dataset.publishDocument}/publish_payment`, "POST", {});
      await loadAll();
      if ($("#documentForm [name='id']").value === String(docPublish.dataset.publishDocument)) {
        const fresh = await apiGet(`/api/documents/${docPublish.dataset.publishDocument}`);
        $("#documentPaymentSyncMeta").textContent = documentPaymentSyncMeta(fresh);
      }
      setStatus("Hosted payment page published.");
      return;
    }
    const tab = e.target.closest("[data-doc-filter]");
    if (tab) {
      state.documentFilter = tab.dataset.docFilter;
      document.querySelectorAll("[data-doc-filter]").forEach((btn) => btn.classList.toggle("active", btn === tab));
      renderDocuments();
    }
  });
}

function showError(err) {
  console.error(err);
  const message = err && err.message ? err.message : String(err);
  if ($("#emailComposerPanel") && !$("#emailComposerPanel").classList.contains("hidden")) {
    setEmailSendStatus(message, "bad");
  }
  alert(message);
  setStatus("There was a problem. See alert for details.");
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  resetCustomerForm();
  resetProductForm();
  loadAll()
    .then(() => loadInvoiceReport())
    .catch(showError);
});
