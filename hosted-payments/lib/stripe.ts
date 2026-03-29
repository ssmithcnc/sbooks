import Stripe from "stripe";

import { getEnv } from "@/lib/env";

let stripe: Stripe | null = null;

export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-08-27.basil"
    });
  }
  return stripe;
}
