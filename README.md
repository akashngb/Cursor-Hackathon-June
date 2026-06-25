# Capture Webhook Pipeline

FastAPI webhook that validates base64 images, assigns stub valuations, generates a PDF invoice, and logs a fake Stripe charge.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## Sample request

Tiny 1×1 PNG (base64) for testing:

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

Response includes per-image valuation breakdown, total, invoice path, and `"stripe": "stubbed"`.
