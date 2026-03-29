import Stripe from "stripe";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

type InvoiceRecord = {
  id: string;
  public_id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total: number;
  payment_options?: {
    accept_manual_ach: boolean;
    accept_stripe_card: boolean;
    accept_stripe_ach: boolean;
    accept_paypal: boolean;
    accept_venmo: boolean;
  };
};

type PaymentOptionsRecord = {
  accept_manual_ach: boolean;
  accept_stripe_card: boolean;
  accept_stripe_ach: boolean;
  accept_paypal: boolean;
  accept_venmo: boolean;
};

type BusinessProfileRecord = {
  company_name: string | null;
  company_email: string | null;
  manual_bank_instructions: string | null;
};

export async function getInvoiceByPublicId(publicId: string) {
  const supabase = getSupabaseAdmin();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, public_id, invoice_number, customer_name, customer_email, issue_date, due_date, currency, total")
    .eq("public_id", publicId)
    .returns<InvoiceRecord | null>()
    .maybeSingle();

  if (invoiceError) {
    throw invoiceError;
  }
  if (!invoice) {
    if (publicId === "demo-invoice") {
      return {
        public_id: publicId,
        invoice_number: "INV-DEMO",
        customer_name: "Demo Customer",
        customer_email: "customer@example.com",
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: null,
        currency: "USD",
        total: 250,
        manual_bank_instructions: "CNC Powder ACH: include invoice INV-DEMO in the remittance memo.",
        business: { company_name: "CNC Powder, LLC", company_email: "steve@cncpowder.com" },
        payment_options: {
          accept_manual_ach: true,
          accept_stripe_card: true,
          accept_stripe_ach: true,
          accept_paypal: false,
          accept_venmo: false
        }
      };
    }
    return null;
  }

  const invoiceRecord = invoice as InvoiceRecord;

  const { data: options, error: optionsError } = await supabase
    .from("invoice_payment_options")
    .select("accept_manual_ach, accept_stripe_card, accept_stripe_ach, accept_paypal, accept_venmo")
    .eq("invoice_id", invoiceRecord.id)
    .returns<PaymentOptionsRecord | null>()
    .maybeSingle();

  if (optionsError && optionsError.code !== "PGRST116") {
    throw optionsError;
  }

  const { data: businessProfile } = await supabase
    .from("business_profiles")
    .select("company_name, company_email, manual_bank_instructions")
    .returns<BusinessProfileRecord | null>()
    .limit(1)
    .maybeSingle();

  const businessProfileRecord = businessProfile as BusinessProfileRecord | null;

  return {
    ...invoiceRecord,
    manual_bank_instructions: businessProfileRecord?.manual_bank_instructions || null,
    business: {
      company_name: businessProfileRecord?.company_name || "S-Books",
      company_email: businessProfileRecord?.company_email || null
    },
    payment_options: options || {
      accept_manual_ach: true,
      accept_stripe_card: true,
      accept_stripe_ach: true,
      accept_paypal: false,
      accept_venmo: false
    }
  };
}

export async function recordStripeWebhookEvent(event: Stripe.Event) {
  const supabase = getSupabaseAdmin();

  const session = event.data.object as Stripe.Checkout.Session;
  const publicId = session.metadata?.public_id || null;

  let invoiceId: string | null = null;
  if (publicId) {
    const { data } = await supabase
      .from("invoices")
      .select("id")
      .returns<{ id: string } | null>()
      .eq("public_id", publicId)
      .maybeSingle();
    const invoiceLookup = data as { id: string } | null;
    invoiceId = invoiceLookup?.id || null;
  }

  await supabase.from("payment_events").insert({
    invoice_id: invoiceId,
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>
  });

  if (event.type === "checkout.session.completed" && invoiceId) {
    await supabase
      .from("invoices")
      .update({
        payment_status: "paid",
        status: "paid",
        latest_checkout_url: session.url || null,
        updated_at: new Date().toISOString()
      })
      .eq("id", invoiceId);
  }
}
