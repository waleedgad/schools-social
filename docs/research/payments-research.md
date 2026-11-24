# Payment gateways for selling School Social Hub in Egypt (L-29)

Helper, 24 Nov 2026. Document only, nothing built. Prices change often: re-check each vendor's own page before signing.

## What we need to take payment for
- **School plans** (Small / Standard / Large, extras) paid by the school, usually yearly or per term. A school is a business customer: it often wants an invoice and pays by card, bank transfer, or a Fawry reference.
- Later, maybe yearbook orders from Parents (many small EGP payments, cash via Fawry matters most there).
- The app already enforces plans on the server (active / read-only / blocked), so the gateway only has to tell us "paid", and we switch the school on. No card data ever touches our servers (use the gateway's hosted checkout page).

## Side by side

| | Kashier | Paymob | Fawry |
|---|---|---|---|
| Local card fee | 2.75% + EGP 3 (own pricing page) + 14% VAT on the fee only | about 2.75% + EGP 3 (third-party pages; some say 2.7-2.9%) | not published; third-party pages say 2.75% + EGP 3 or a 1.5-2.5% quote |
| Setup / monthly fee | none (standard online plan) | none for small businesses | one page says EGP 999 setup + EGP 499-1,499 monthly minimum (not confirmed) |
| Wallets (Vodafone Cash etc.), Meeza, Apple Pay | yes; wallet rate "quoted by sales" | yes, many wallets, installments (valU, Souhoola) | wallets/QR (about 1.5% per one page) |
| Cash at a kiosk | Basata kiosks | Fawry/Aman references through Paymob (verify) | **its own network, 225,000+ points**, the best for cash |
| Recurring / subscriptions | card saved with consent at first payment, then our server charges it on our schedule through an API; webhook confirms. Payment links + billing portal are separate products | tokenised cards exist (no detail on pages read; check docs) | no recurring card billing found; reference numbers are one-off |
| Currency | EGP, settled to an Egyptian bank | EGP only (no USD) | EGP |
| Money reaches us | "scheduled" (one page: 3 working days) | pages disagree: next day / 2-3 days / weekly | weekly or per contract |
| Developer docs + test sandbox | yes, developers.kashier.io with a sandbox; reported 2-4 days to build | yes; newer "Intention" API is simpler than the old 3-step flow; 3-6 days | yes (FawryPay developer site with staging); 4-8 days |
| Licence | Central Bank of Egypt licensed, PCI DSS Level 1, SOC 2 | Central Bank licensed payment facilitator | Egypt's biggest payment network |

Stripe does not serve Egypt-based sellers, so it is not an option without a foreign company.

## Recommendation: Kashier first, Fawry references through it, Paymob as back-up
1. **Kashier** has the only fully published price, no monthly fee (fits "free until selling"), saved-card charging for yearly/term renewals, payment links (good for "here is your invoice, pay here" emails to a school), and Basata kiosk cash. Fewest surprises.
2. **Paymob** is the back-up if Kashier refuses us or a school wants installments; same price level, more wallets.
3. **Fawry directly** only if many schools insist on paying cash with a Fawry number; check first whether Kashier or Paymob already offer Fawry references (then we do not need a second contract).
4. Many schools will still pay by **bank transfer against an invoice**. Keep a "mark as paid" button on the Owner page (owner only) so that works with no gateway at all. This is also the plan for the first schools.

## What it needs from Waleed (later, at selling time, not now)
- A registered business: commercial register + tax card + business bank account in Egypt (all three gateways ask for these; individuals usually cannot get online card acceptance). Confirm with the gateway's sales team.
- Ask the lawyer (add to the privacy papers questions): e-invoicing with the Egyptian Tax Authority for B2B sales to schools, and VAT on the plans.
- Get a written quote from Kashier for wallets and kiosk payments, and the settlement time in the contract.

## How it would plug in (for the code thread, later; no code now)
- Owner page: "Send payment link" per school (amount, plan, period) -> gateway hosted page -> webhook to a new `/api/payments/webhook` route that checks the gateway's signature and extends the school's plan end date. Same server rule as today decides active / read-only / blocked.
- Renewals: either a new payment link 14 days before the end (simple, works with every method) or saved-card charge (Kashier recurring API) if the school agrees.
- Test with the gateway's sandbox in robot tests, the same way the fake Meta server works.

## Sources (read 24 Nov 2026)
- Kashier pricing (vendor): https://www.kashier.io/pricing
- Kashier subscriptions (vendor): https://www.kashier.io/subscriptions
- Comparison, Aug 2026 (consultant blog): https://www.kerolosxgad.com/writing/payment-gateways-egypt-comparison
- Comparison, Aug 2026 (agency, has ties with providers): https://digitology.co/payment-gateway-egypt/
- Paymob vs Stripe, May 2026 (sells a competitor): https://orcaa.cloud/blog/paymob-vs-stripe-egypt
- Paymob alternatives, May 2026 (sells a competitor): https://dodopayments.com/blogs/paymob-alternatives
- Fawry's own pricing page (https://fawrydigital.com/pricing) could not be read from here; all Fawry numbers above are second-hand.
