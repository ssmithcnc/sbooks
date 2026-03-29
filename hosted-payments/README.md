# S-Books Hosted Payments

This is the public payment app for S-Books. It is meant to be deployed to Vercel
with the project root set to `hosted-payments/`.

## What it will handle

- public invoice payment pages
- Stripe Checkout session creation
- Stripe webhook processing
- Supabase-backed invoice/payment state

## Vercel setup

1. Connect the `ssmithcnc/sbooks` repository.
2. Set the Vercel project's Root Directory to `hosted-payments`.
3. Add the environment variables from `.env.example`.
4. Deploy.

## Next implementation steps

- apply `supabase/schema.sql` in the Supabase SQL editor
- add Stripe keys and webhook secret in Vercel
- wire invoice sync from the desktop app into Supabase
- add the final pay page buttons for card, ACH, and manual bank transfer
