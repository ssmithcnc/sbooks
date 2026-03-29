import Stripe from "stripe";

import { getEnv } from "@/lib/env";

let stripe: Stripe | null = null;

export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-02-24.acacia"
    });
  }
  return stripe;
}
