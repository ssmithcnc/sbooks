import { getEnv } from "@/lib/env";

type PayPalAccessTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type PayPalLink = {
  href: string;
  rel: string;
  method: string;
};

export type PayPalOrderResponse = {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    custom_id?: string;
    invoice_id?: string;
  }>;
  payer?: {
    email_address?: string;
  };
};

export type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    custom_id?: string;
    invoice_id?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
  summary?: string;
};

function getPayPalBaseUrl() {
  return process.env.PAYPAL_BASE_URL || "https://api-m.paypal.com";
}

async function getPayPalAccessToken() {
  const clientId = getEnv("PAYPAL_CLIENT_ID");
  const clientSecret = getEnv("PAYPAL_CLIENT_SECRET");
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials",
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal auth failed: ${text || response.statusText}`);
  }

  return (await response.json()) as PayPalAccessTokenResponse;
}

async function paypalRequest<T>(path: string, init?: RequestInit) {
  const token = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal request failed: ${text || response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function createPayPalOrder(args: {
  publicId: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string | null;
  amount: number;
  currency: string;
  businessName: string;
  returnUrl: string;
  cancelUrl: string;
}) {
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: args.invoiceNumber,
        invoice_id: args.invoiceNumber,
        custom_id: args.publicId,
        description: `S-Books payment for ${args.customerName}`,
        amount: {
          currency_code: (args.currency || "USD").toUpperCase(),
          value: Number(args.amount || 0).toFixed(2)
        }
      }
    ],
    payer: args.customerEmail
      ? {
          email_address: args.customerEmail
        }
      : undefined,
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: args.businessName || "S-Books",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: args.returnUrl,
          cancel_url: args.cancelUrl
        }
      }
    }
  };

  return paypalRequest<PayPalOrderResponse>("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function capturePayPalOrder(orderId: string) {
  return paypalRequest<PayPalOrderResponse>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function verifyPayPalWebhook(args: {
  headers: Headers;
  eventBody: unknown;
}) {
  const webhookId = getEnv("PAYPAL_WEBHOOK_ID");

  const body = {
    auth_algo: args.headers.get("paypal-auth-algo"),
    cert_url: args.headers.get("paypal-cert-url"),
    transmission_id: args.headers.get("paypal-transmission-id"),
    transmission_sig: args.headers.get("paypal-transmission-sig"),
    transmission_time: args.headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: args.eventBody
  };

  const result = await paypalRequest<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );

  return result.verification_status === "SUCCESS";
}

export function approvalLink(order: PayPalOrderResponse) {
  return (
    order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href ||
    null
  );
}
