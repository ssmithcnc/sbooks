"use client";

import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: Record<string, unknown>) => {
        render: (selectorOrElement: string | HTMLElement) => Promise<void> | void;
        close?: () => void;
      };
    };
  }
}

type PayPalButtonsProps = {
  clientId: string;
  publicId: string;
  currency: string;
  showVenmo: boolean;
  buttonLabel: string;
};

const VENMO_ICON =
  "data:image/png;base64,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";

function sdkUrl(clientId: string, currency: string, showVenmo: boolean) {
  const params = new URLSearchParams({
    "client-id": clientId,
    components: "buttons",
    intent: "capture",
    currency: (currency || "USD").toUpperCase()
  });
  if (showVenmo) {
    params.set("enable-funding", "venmo");
  }
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

async function ensurePayPalSdk(src: string) {
  const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
  if (existing) {
    if (existing.src === src && window.paypal) return;
    existing.remove();
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.paypalSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal SDK failed to load."));
    document.head.appendChild(script);
  });
}

export function PayPalButtons({
  clientId,
  publicId,
  currency,
  showVenmo,
  buttonLabel
}: PayPalButtonsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string>("");
  const [ready, setReady] = useState(false);
  const url = useMemo(() => sdkUrl(clientId, currency, showVenmo), [clientId, currency, showVenmo]);

  useEffect(() => {
    let cancelled = false;

    async function mountButtons() {
      setError("");
      setReady(false);

      try {
        await ensurePayPalSdk(url);
        if (cancelled || !containerRef.current || !window.paypal) return;

        containerRef.current.innerHTML = "";

        const buttons = window.paypal.Buttons({
          style: {
            layout: "vertical",
            shape: "pill",
            label: "paypal",
            tagline: false
          },
          createOrder: async () => {
            const response = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({ publicId })
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.orderId) {
              throw new Error(payload?.error || "PayPal did not return an order id.");
            }
            return payload.orderId;
          },
          onApprove: async (data: Record<string, unknown>) => {
            const orderId = String(data.orderID || "");
            const response = await fetch("/api/paypal/capture-order", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({ publicId, orderId })
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok) {
              throw new Error(payload?.error || "PayPal capture failed.");
            }
            if (payload?.redirectUrl) {
              window.location.href = payload.redirectUrl;
            }
          },
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : "PayPal checkout failed.";
            setError(message);
          }
        });

        await buttons.render(containerRef.current);
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "PayPal checkout failed to initialize.";
          setError(message);
        }
      }
    }

    mountButtons();
    return () => {
      cancelled = true;
    };
  }, [publicId, url]);

  return (
    <div className="paypal-block">
      <div className="paypal-headline">
        <img className="paypal-venmo-icon" src={VENMO_ICON} alt="Venmo" />
        <div className="eyebrow paypal-label">{buttonLabel}</div>
      </div>
      <div ref={containerRef} className="paypal-buttons-slot" />
      {!ready && !error ? <div className="paypal-helper">Loading PayPal checkout options...</div> : null}
      {error ? <div className="paypal-error">{error}</div> : null}
    </div>
  );
}
