# Capture Webhook Pipeline

FastAPI webhook that:
1. **`/webhook/capture`** — accepts a batch of base64 photos, assigns stub valuations, and writes a per-image PDF.
2. **`/webhook/finalize`** — called after bartering with the final price. Creates a real Stripe Payment Link, writes a very simple PDF invoice (date, customer, photo count, amount due, pay link), and emails it to `akash30n@gmail.com` via Resend's HTTP API (no SMTP).

## Setup

```bash
pip install -r requirements.txt
cp .env .env.local  # .env is git-ignored, holds your test keys
uvicorn main:app --reload
```

Env vars (see `.env`):
- `STRIPE_SECRET_KEY` — test mode (`sk_test_…`). Without it, Stripe is stubbed.
- `STRIPE_PUBLISHABLE_KEY` — kept for the client side.
- `RESEND_API_KEY` — get a free key at resend.com. Without it, the PDF is generated and the send is logged but not sent.
- `RESEND_FROM` — defaults to Resend's sandbox sender `onboarding@resend.dev`.

> **No-SMTP rationale:** Resend is a pure HTTP email API — one POST to `api.resend.com/emails`, PDF attached as base64. If you'd rather go through Supabase, swap `send_invoice_email` for a call to a Supabase Edge Function.

## Capture (mass upload)

```bash
curl -X POST http://127.0.0.1:8000/webhook/capture \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "job-001",
    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
    "images": [
      {"id": "img-1", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="},
      {"id": "img-2", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}
    ]
  }'
```

## Finalize (post-bartering)

```bash
curl -X POST http://127.0.0.1:8000/webhook/finalize \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "job-001",
    "customer": {"name": "Jane Doe", "email": "jane@example.com"},
    "final_price": 742.50,
    "image_count": 2
  }'
```

Response:

```json
{
  "job_id": "job-001",
  "final_price": 742.50,
  "invoice_path": "invoices/job-001-final.pdf",
  "email_to": "akash30n@gmail.com",
  "email_status": "sent",
  "stripe_payment_url": "https://buy.stripe.com/test_...",
  "stripe_status": "ok"
}
```
