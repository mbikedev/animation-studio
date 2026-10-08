-- Demo / local seed. No user and no admin account is created here.
-- Prices are placeholders for Stripe TEST mode only; the owner must create
-- the matching Stripe test prices and update stripe_price_id.
insert into public.credit_packs (id, name, credits, stripe_price_id, amount_minor, currency, active) values
  ('00000000-0000-4000-8000-000000000101', 'Découverte', 100, null, 500, 'EUR', true),
  ('00000000-0000-4000-8000-000000000102', 'Créateur', 500, null, 2000, 'EUR', true)
on conflict (id) do nothing;
