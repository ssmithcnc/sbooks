import { getSupabaseAdmin } from "@/lib/supabase-admin";

type EstimateRecord = {
  id: string;
  business_profile_id: string;
  public_id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  status: string;
  payment_status: string;
  payment_page_url: string | null;
  latest_checkout_url: string | null;
  metadata: Record<string, unknown> | null;
  document_type: string;
  acceptance_enabled: boolean;
  acceptance_token: string | null;
  acceptance_deposit_type: string | null;
  acceptance_deposit_value: number | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  deposit_invoice_public_id: string | null;
};

type PaymentOptionsRecord = {
  accept_manual_ach: boolean;
  accept_stripe_card: boolean;
  accept_stripe_ach: boolean;
  accept_paypal: boolean;
  accept_venmo: boolean;
};

type BusinessProfileRecord = {
  id: string;
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  company_website: string | null;
  manual_bank_instructions: string | null;
};

type DocumentLineItemDbRow = {
  id: string;
  sort_order: number | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  metadata: Record<string, unknown> | null;
};

export type EstimateLineItem = {
  id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
  metadata: Record<string, unknown>;
};

export type EstimateDeposit = {
  type: "percent" | "fixed";
  configuredValue: number;
  percent: number;
  factor: number;
  label: string;
  summary: string;
  targetTotal: number;
  subtotal: number;
  taxAmount: number;
  taxRate: number;
  lines: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
    taxable: boolean;
    sort_order: number;
    metadata: Record<string, unknown>;
  }>;
};

export type EstimateDetails = EstimateRecord & {
  amount_due: number;
  manual_bank_instructions: string | null;
  business: {
    company_name: string;
    company_email: string | null;
    company_phone: string | null;
    company_website: string | null;
  };
  customer: {
    billing_address: string | null;
    company_name: string | null;
    contact_name: string | null;
  };
  notes: string | null;
  terms: string | null;
  line_items: EstimateLineItem[];
  public_url: string | null;
  deposit: EstimateDeposit | null;
  payment_options: PaymentOptionsRecord;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]/g, "").trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundMoney(value: number) {
  return Number((value || 0).toFixed(2));
}

function getBaseUrl() {
  return clean(process.env.NEXT_PUBLIC_APP_BASE_URL);
}

function getPublicAcceptEstimateUrl(token: string) {
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/accept-estimate/${encodeURIComponent(token)}` : null;
}

function getPublicInvoiceUrl(publicId: string) {
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/invoice/${publicId}` : null;
}

function getMetadataText(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = clean(metadata?.[key]);
    if (value) return value;
  }
  return null;
}

function getCustomerAddress(metadata: Record<string, unknown> | null) {
  const direct = getMetadataText(metadata, ["billing_address", "customer_address", "bill_to"]);
  if (direct) return direct;

  const lines = [
    getMetadataText(metadata, ["customer_company", "billing_company"]),
    getMetadataText(metadata, ["customer_contact", "contact_name"]),
    getMetadataText(metadata, ["address_line_1", "billing_address_line_1"]),
    getMetadataText(metadata, ["address_line_2", "billing_address_line_2"]),
    [getMetadataText(metadata, ["city"]), getMetadataText(metadata, ["state"]), getMetadataText(metadata, ["postal_code", "zip"])]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : null;
}

function normalizeLineItemsFromMetadata(
  metadata: Record<string, unknown> | null,
  document: Pick<EstimateRecord, "subtotal" | "tax_amount" | "total">,
) {
  const metadataItems =
    (Array.isArray(metadata?.line_items) ? metadata.line_items : null) ||
    (Array.isArray(metadata?.items) ? metadata.items : null) ||
    [];

  const normalized = metadataItems
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const quantity = toNumber(row.quantity ?? row.qty) ?? 1;
      const unitPrice = toNumber(row.unit_price ?? row.unitPrice ?? row.rate);
      const explicitAmount = toNumber(row.amount ?? row.total ?? row.line_total);
      const amount = explicitAmount ?? (unitPrice !== null ? roundMoney(quantity * unitPrice) : 0);

      return {
        id: clean(row.id) || `meta-${index + 1}`,
        sort_order: index,
        description: clean(row.description || row.name || row.title || `Line item ${index + 1}`),
        quantity,
        unit_price: unitPrice,
        amount,
        metadata: row,
      } satisfies EstimateLineItem;
    })
    .filter((item) => item.description);

  if (normalized.length) return normalized;

  return [
    {
      id: "summary-subtotal",
      sort_order: 0,
      description: "Estimate subtotal",
      quantity: 1,
      unit_price: document.subtotal || document.total || 0,
      amount: document.subtotal || document.total || 0,
      metadata: {},
    },
    ...(document.tax_amount
      ? [
          {
            id: "summary-tax",
            sort_order: 1,
            description: "Sales tax",
            quantity: 1,
            unit_price: document.tax_amount,
            amount: document.tax_amount,
            metadata: {},
          } satisfies EstimateLineItem,
        ]
      : []),
  ];
}

async function getDocumentLineItems(document: EstimateRecord) {
  const metadataFallback = normalizeLineItemsFromMetadata(document.metadata, document);
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await (supabase.from("invoice_line_items") as any)
      .select("id, sort_order, description, quantity, unit_price, amount, metadata")
      .eq("invoice_id", document.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return metadataFallback;

    const rows = (data || []) as DocumentLineItemDbRow[];
    if (!rows.length) return metadataFallback;

    return rows.map((row, index) => {
      const quantity = toNumber(row.quantity) ?? 1;
      const unitPrice = toNumber(row.unit_price);
      const amount = toNumber(row.amount) ?? (unitPrice !== null ? roundMoney(quantity * unitPrice) : 0);

      return {
        id: row.id,
        sort_order: row.sort_order ?? index,
        description: clean(row.description) || `Line item ${index + 1}`,
        quantity,
        unit_price: unitPrice,
        amount,
        metadata: row.metadata || {},
      } satisfies EstimateLineItem;
    });
  } catch {
    return metadataFallback;
  }
}

function findTaxableSubtotalForTotal(targetTotal: number, startingSubtotal: number, taxRate: number) {
  const roundedTarget = roundMoney(targetTotal);
  const startingCents = Math.max(Math.round(roundMoney(startingSubtotal) * 100), 0);
  for (let delta = 0; delta <= 1000; delta += 1) {
    for (const sign of [1, -1]) {
      const candidateCents = startingCents + delta * sign;
      if (candidateCents < 0) continue;
      const candidate = candidateCents / 100;
      const candidateTotal = roundMoney(candidate + roundMoney(candidate * (taxRate / 100)));
      if (candidateTotal === roundedTarget) return roundMoney(candidate);
    }
  }
  if (!taxRate) return roundedTarget;
  return Math.max(roundMoney(roundedTarget / (1 + taxRate / 100)), 0);
}

function buildEstimateDeposit(estimate: {
  invoice_number: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  acceptance_deposit_type: string | null;
  acceptance_deposit_value: number | null;
  line_items: EstimateLineItem[];
}) {
  const depositType = clean(estimate.acceptance_deposit_type).toLowerCase();
  if (depositType !== "percent" && depositType !== "fixed") return null;

  const configuredValue = roundMoney(toNumber(estimate.acceptance_deposit_value) ?? 0);
  const total = roundMoney(toNumber(estimate.total) ?? 0);
  const subtotal = roundMoney(toNumber(estimate.subtotal) ?? 0);
  if (configuredValue <= 0 || total <= 0) return null;

  let percent = 0;
  let targetTotal = 0;
  let factor = 0;
  let label = "";

  if (depositType === "percent") {
    percent = Math.min(configuredValue, 100);
    targetTotal = roundMoney(total * (percent / 100));
    factor = percent / 100;
    label = `${Number.isInteger(percent) ? percent.toFixed(0) : percent}% deposit`;
  } else {
    targetTotal = roundMoney(Math.min(configuredValue, total));
    factor = total ? targetTotal / total : 0;
    percent = total ? roundMoney((targetTotal / total) * 100) : 0;
    label = `$${targetTotal.toFixed(2)} deposit`;
  }

  const taxableSubtotal = roundMoney(
    estimate.line_items.reduce((sum, item) => {
      const taxable = item.metadata?.taxable;
      const isTaxable =
        typeof taxable === "boolean"
          ? taxable
          : ["1", "true", "yes", "y", "on"].includes(clean(taxable).toLowerCase());
      return isTaxable ? sum + item.amount : sum;
    }, 0),
  );
  const nonTaxableSubtotal = roundMoney(subtotal - taxableSubtotal);
  const taxRate = taxableSubtotal > 0 ? roundMoney((roundMoney(estimate.tax_amount) / taxableSubtotal) * 100) : 0;

  let depositTaxableSubtotal = roundMoney(taxableSubtotal * factor);
  let depositNonTaxableSubtotal = roundMoney(nonTaxableSubtotal * factor);
  let depositTaxAmount = roundMoney(depositTaxableSubtotal * (taxRate / 100));
  let currentTotal = roundMoney(depositTaxableSubtotal + depositNonTaxableSubtotal + depositTaxAmount);
  let difference = roundMoney(targetTotal - currentTotal);

  if (Math.abs(difference) >= 0.01) {
    if (Math.abs(depositNonTaxableSubtotal) > 0 || Math.abs(nonTaxableSubtotal) > 0) {
      depositNonTaxableSubtotal = roundMoney(depositNonTaxableSubtotal + difference);
    } else if (Math.abs(depositTaxableSubtotal) > 0 || Math.abs(taxableSubtotal) > 0) {
      depositTaxableSubtotal = findTaxableSubtotalForTotal(targetTotal, depositTaxableSubtotal, taxRate);
    }
    depositTaxAmount = roundMoney(depositTaxableSubtotal * (taxRate / 100));
    currentTotal = roundMoney(depositTaxableSubtotal + depositNonTaxableSubtotal + depositTaxAmount);
    difference = roundMoney(targetTotal - currentTotal);
    if (Math.abs(difference) >= 0.01) {
      depositNonTaxableSubtotal = roundMoney(depositNonTaxableSubtotal + difference);
      currentTotal = roundMoney(
        depositTaxableSubtotal + depositNonTaxableSubtotal + roundMoney(depositTaxableSubtotal * (taxRate / 100)),
      );
    }
  }

  const lines: EstimateDeposit["lines"] = [];
  if (depositTaxableSubtotal > 0) {
    lines.push({
      description: `${label} for Estimate ${estimate.invoice_number}`,
      quantity: 1,
      unit_price: depositTaxableSubtotal,
      amount: depositTaxableSubtotal,
      taxable: true,
      sort_order: 0,
      metadata: { taxable: true },
    });
  }
  if (depositNonTaxableSubtotal > 0) {
    lines.push({
      description: `${label} for Estimate ${estimate.invoice_number} (non-taxable)`,
      quantity: 1,
      unit_price: depositNonTaxableSubtotal,
      amount: depositNonTaxableSubtotal,
      taxable: false,
      sort_order: lines.length,
      metadata: { taxable: false },
    });
  }

  return {
    type: depositType,
    configuredValue,
    percent,
    factor,
    label,
    summary: `${label} due on acceptance`,
    targetTotal: roundMoney(targetTotal),
    subtotal: roundMoney(depositTaxableSubtotal + depositNonTaxableSubtotal),
    taxAmount: roundMoney(depositTaxAmount),
    taxRate,
    lines,
  } satisfies EstimateDeposit;
}

function getDepositInvoiceNumber(estimateNumber: string) {
  return `DEP-${clean(estimateNumber).replace(/\s+/g, "-")}`;
}

async function getPaymentOptions(documentId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("invoice_payment_options")
    .select("accept_manual_ach, accept_stripe_card, accept_stripe_ach, accept_paypal, accept_venmo")
    .eq("invoice_id", documentId)
    .returns<PaymentOptionsRecord | null>()
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return (
    (data as PaymentOptionsRecord | null) || {
      accept_manual_ach: true,
      accept_stripe_card: true,
      accept_stripe_ach: true,
      accept_paypal: false,
      accept_venmo: false,
    }
  );
}

async function getBusinessProfile(businessProfileId: string) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("business_profiles")
    .select("id, company_name, company_email, company_phone, company_website, manual_bank_instructions")
    .eq("id", businessProfileId)
    .returns<BusinessProfileRecord | null>()
    .maybeSingle();
  return data as BusinessProfileRecord | null;
}

async function getEstimateRecordByAcceptanceToken(acceptanceToken: string) {
  const token = clean(acceptanceToken);
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, business_profile_id, public_id, invoice_number, customer_name, customer_email, issue_date, due_date, currency, subtotal, tax_amount, total, amount_paid, status, payment_status, payment_page_url, latest_checkout_url, metadata, document_type, acceptance_enabled, acceptance_token, acceptance_deposit_type, acceptance_deposit_value, accepted_at, accepted_by_name, accepted_by_email, deposit_invoice_public_id",
    )
    .eq("acceptance_token", token)
    .eq("document_type", "estimate")
    .returns<EstimateRecord | null>()
    .maybeSingle();

  if (error) throw error;
  return data as EstimateRecord | null;
}

export async function getEstimateByAcceptanceToken(acceptanceToken: string): Promise<EstimateDetails | null> {
  const estimateRecord = await getEstimateRecordByAcceptanceToken(acceptanceToken);
  if (!estimateRecord || !estimateRecord.acceptance_enabled) return null;

  const [paymentOptions, businessProfile, lineItems] = await Promise.all([
    getPaymentOptions(estimateRecord.id),
    getBusinessProfile(estimateRecord.business_profile_id),
    getDocumentLineItems(estimateRecord),
  ]);

  const metadata = estimateRecord.metadata || {};
  const subtotal = roundMoney(toNumber(estimateRecord.subtotal) ?? lineItems.reduce((sum, item) => sum + item.amount, 0));
  const taxAmount = roundMoney(toNumber(estimateRecord.tax_amount) ?? 0);
  const total = roundMoney(toNumber(estimateRecord.total) ?? subtotal + taxAmount);
  const amountPaid = roundMoney(toNumber(estimateRecord.amount_paid) ?? 0);
  const publicUrl = getPublicAcceptEstimateUrl(acceptanceToken);
  const deposit = buildEstimateDeposit({
    invoice_number: estimateRecord.invoice_number,
    subtotal,
    tax_amount: taxAmount,
    total,
    acceptance_deposit_type: estimateRecord.acceptance_deposit_type,
    acceptance_deposit_value: toNumber(estimateRecord.acceptance_deposit_value),
    line_items: lineItems,
  });

  return {
    ...estimateRecord,
    subtotal,
    tax_amount: taxAmount,
    total,
    amount_paid: amountPaid,
    amount_due: total,
    manual_bank_instructions: businessProfile?.manual_bank_instructions || null,
    business: {
      company_name: businessProfile?.company_name || "S-Books",
      company_email: businessProfile?.company_email || null,
      company_phone: businessProfile?.company_phone || null,
      company_website: businessProfile?.company_website || null,
    },
    customer: {
      billing_address: getCustomerAddress(metadata),
      company_name: getMetadataText(metadata, ["customer_company", "billing_company"]),
      contact_name: getMetadataText(metadata, ["customer_contact", "contact_name"]),
    },
    notes: getMetadataText(metadata, ["notes", "memo", "message"]),
    terms: getMetadataText(metadata, ["terms"]),
    line_items: lineItems,
    public_url: publicUrl,
    deposit,
    payment_options: paymentOptions,
  };
}

async function findExistingDepositInvoice(estimate: EstimateDetails) {
  const knownPublicId = clean(estimate.deposit_invoice_public_id);
  if (knownPublicId) return knownPublicId;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("invoices")
    .select("public_id")
    .eq("document_type", "invoice")
    .eq("source_estimate_public_id", estimate.public_id)
    .limit(1)
    .returns<{ public_id: string } | null>()
    .maybeSingle();

  const invoice = data as { public_id: string } | null;
  return clean(invoice?.public_id) || null;
}

export async function acceptEstimateByToken(
  acceptanceToken: string,
  args: { acceptedByName?: string; acceptedByEmail?: string },
) {
  const estimate = await getEstimateByAcceptanceToken(acceptanceToken);
  if (!estimate) {
    throw new Error("Estimate acceptance link not found.");
  }

  const supabase = getSupabaseAdmin();
  const acceptedAt = clean(estimate.accepted_at) || new Date().toISOString();
  const acceptedByName = clean(args.acceptedByName) || estimate.customer.contact_name || estimate.customer_name;
  const acceptedByEmail = clean(args.acceptedByEmail) || estimate.customer_email || null;

  let depositInvoicePublicId = await findExistingDepositInvoice(estimate);

  if (!depositInvoicePublicId && estimate.deposit) {
    depositInvoicePublicId = crypto.randomUUID().replace(/-/g, "");
    const { data: insertedInvoice, error: invoiceError } = await (supabase.from("invoices") as any)
      .upsert(
        {
          business_profile_id: estimate.business_profile_id,
          local_invoice_id: null,
          document_type: "invoice",
          public_id: depositInvoicePublicId,
          invoice_number: getDepositInvoiceNumber(estimate.invoice_number),
          customer_name: estimate.customer_name,
          customer_email: estimate.customer_email,
          issue_date: new Date().toISOString().slice(0, 10),
          due_date: null,
          currency: estimate.currency || "USD",
          subtotal: estimate.deposit.subtotal,
          tax_amount: estimate.deposit.taxAmount,
          total: estimate.deposit.targetTotal,
          amount_paid: 0,
          status: "open",
          payment_status: "unpaid",
          payment_page_url: getPublicInvoiceUrl(depositInvoicePublicId),
          source_estimate_public_id: estimate.public_id,
          metadata: {
            source: "sbooks-hosted-estimate-acceptance",
            document_type: "invoice",
            source_estimate_public_id: estimate.public_id,
            estimate_number: estimate.invoice_number,
            customer_contact: estimate.customer.contact_name || "",
            billing_address: estimate.customer.billing_address || "",
            terms: estimate.terms || "Deposit due on acceptance.",
            notes: [
              `${estimate.deposit.summary} created from accepted estimate ${estimate.invoice_number}.`,
              acceptedByName ? `Accepted by: ${acceptedByName}` : "",
              acceptedByEmail ? `Acceptance email: ${acceptedByEmail}` : "",
              estimate.notes || "",
            ]
              .filter(Boolean)
              .join("\n"),
            use_full_portal: true,
            line_items: estimate.deposit.lines,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "public_id" },
      )
      .select("id")
      .single();

    if (invoiceError) throw invoiceError;

    const invoiceId = clean(insertedInvoice?.id);
    if (!invoiceId) {
      throw new Error("Supabase did not return the hosted deposit invoice id.");
    }

    await (supabase.from("invoice_line_items") as any).delete().eq("invoice_id", invoiceId);

    if (estimate.deposit.lines.length) {
      const linePayload = estimate.deposit.lines.map((line) => ({
        invoice_id: invoiceId,
        sort_order: line.sort_order,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: line.amount,
        metadata: line.metadata,
        updated_at: new Date().toISOString(),
      }));
      const { error: lineError } = await (supabase.from("invoice_line_items") as any).insert(linePayload);
      if (lineError) throw lineError;
    }

    const { error: optionError } = await (supabase.from("invoice_payment_options") as any)
      .upsert(
        {
          invoice_id: invoiceId,
          accept_manual_ach: estimate.payment_options.accept_manual_ach,
          accept_stripe_card: estimate.payment_options.accept_stripe_card,
          accept_stripe_ach: estimate.payment_options.accept_stripe_ach,
          accept_paypal: estimate.payment_options.accept_paypal,
          accept_venmo: estimate.payment_options.accept_venmo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "invoice_id" },
      );
    if (optionError) throw optionError;
  }

  const { error: updateError } = await (supabase.from("invoices") as any)
    .update({
      status: "accepted",
      payment_status: "accepted",
      accepted_at: acceptedAt,
      accepted_by_name: acceptedByName || null,
      accepted_by_email: acceptedByEmail,
      deposit_invoice_public_id: depositInvoicePublicId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimate.id);

  if (updateError) throw updateError;

  return {
    acceptedAt,
    acceptedByName,
    acceptedByEmail,
    depositInvoicePublicId,
  };
}
