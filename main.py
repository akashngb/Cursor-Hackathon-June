import base64
import binascii
import logging
import os
import random
from datetime import datetime
from pathlib import Path

import httpx
import stripe
from dotenv import load_dotenv
from twilio.rest import Client as TwilioClient
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Capture Webhook Pipeline")

INVOICES_DIR = Path("./invoices")

# Always email the finalized invoice here for the demo.
INVOICE_RECIPIENT = "akash30n@gmail.com"

# Stripe (test mode)
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY")
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# Resend HTTP API (no SMTP). Set RESEND_API_KEY to enable real sends.
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM = os.getenv("RESEND_FROM", "Invoices <onboarding@resend.dev>")

# Twilio — WhatsApp/SMS invoice delivery
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
_twilio_client: TwilioClient | None = (
    TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
    else None
)


# --- Pydantic models ---


class Customer(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None  # E.164 format, e.g. +15558675310


class ImageInput(BaseModel):
    id: str
    data: str

    @field_validator("data")
    @classmethod
    def validate_base64(cls, v: str) -> str:
        try:
            base64.b64decode(v, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"Invalid base64 data: {exc}") from exc
        return v


class CaptureRequest(BaseModel):
    job_id: str
    customer: Customer
    images: list[ImageInput]


class ImageBreakdown(BaseModel):
    id: str
    value: float


class CaptureResponse(BaseModel):
    job_id: str
    total_value: float
    breakdown: list[ImageBreakdown]
    invoice_path: str
    stripe: str


class FinalizeRequest(BaseModel):
    job_id: str
    customer: Customer
    final_price: float
    image_count: int | None = None


class FinalizeResponse(BaseModel):
    job_id: str
    final_price: float
    invoice_path: str
    email_to: str
    email_status: str
    stripe_payment_url: str | None
    stripe_status: str
    whatsapp_status: str


# --- Helpers ---


def value_for_image(image_id: str) -> float:
    rng = random.Random(image_id)
    return round(rng.uniform(50, 500), 2)


def generate_invoice(
    job_id: str,
    customer: Customer,
    breakdown: list[ImageBreakdown],
    total_value: float,
) -> Path:
    INVOICES_DIR.mkdir(parents=True, exist_ok=True)
    invoice_path = INVOICES_DIR / f"{job_id}.pdf"

    c = canvas.Canvas(str(invoice_path), pagesize=letter)
    width, height = letter
    y = height - inch

    c.setFont("Helvetica-Bold", 16)
    c.drawString(inch, y, "INVOICE")
    y -= 0.4 * inch

    c.setFont("Helvetica", 11)
    c.drawString(inch, y, f"Job ID: {job_id}")
    y -= 0.25 * inch
    c.drawString(inch, y, f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    y -= 0.25 * inch
    c.drawString(inch, y, f"Customer: {customer.name}")
    y -= 0.25 * inch
    c.drawString(inch, y, f"Email: {customer.email}")
    y -= 0.5 * inch

    c.setFont("Helvetica-Bold", 11)
    c.drawString(inch, y, "Image ID")
    c.drawString(4 * inch, y, "Value")
    y -= 0.25 * inch
    c.line(inch, y, width - inch, y)
    y -= 0.2 * inch

    c.setFont("Helvetica", 11)
    for item in breakdown:
        if y < inch:
            c.showPage()
            y = height - inch
            c.setFont("Helvetica", 11)
        c.drawString(inch, y, item.id)
        c.drawString(4 * inch, y, f"${item.value:.2f}")
        y -= 0.25 * inch

    y -= 0.15 * inch
    c.line(inch, y, width - inch, y)
    y -= 0.3 * inch
    c.setFont("Helvetica-Bold", 12)
    c.drawString(inch, y, "Total")
    c.drawString(4 * inch, y, f"${total_value:.2f}")

    c.save()
    return invoice_path


def generate_simple_invoice(
    job_id: str,
    customer: Customer,
    final_price: float,
    image_count: int | None,
    payment_url: str | None,
) -> Path:
    """Bare-bones post-bartering invoice. One page, only what matters."""
    INVOICES_DIR.mkdir(parents=True, exist_ok=True)
    invoice_path = INVOICES_DIR / f"{job_id}-final.pdf"

    c = canvas.Canvas(str(invoice_path), pagesize=letter)
    _, height = letter
    y = height - inch

    c.setFont("Helvetica-Bold", 20)
    c.drawString(inch, y, "INVOICE")
    y -= 0.5 * inch

    c.setFont("Helvetica", 12)
    c.drawString(inch, y, f"Date: {datetime.now().strftime('%Y-%m-%d')}")
    y -= 0.3 * inch
    c.drawString(inch, y, f"Job: {job_id}")
    y -= 0.3 * inch
    c.drawString(inch, y, f"Billed to: {customer.name} <{customer.email}>")
    if image_count is not None:
        y -= 0.3 * inch
        c.drawString(inch, y, f"Photos delivered: {image_count}")

    y -= 0.7 * inch
    c.setFont("Helvetica-Bold", 16)
    c.drawString(inch, y, f"Amount due: ${final_price:.2f}")

    if payment_url:
        y -= 0.6 * inch
        c.setFont("Helvetica", 11)
        c.drawString(inch, y, "Pay online:")
        y -= 0.25 * inch
        c.setFillColorRGB(0.13, 0.36, 0.79)
        c.drawString(inch, y, payment_url)
        c.linkURL(payment_url, (inch, y - 2, inch + 6 * inch, y + 12), relative=0)
        c.setFillColorRGB(0, 0, 0)

    c.save()
    return invoice_path


def create_stripe_payment_link(
    job_id: str,
    customer: Customer,
    final_price: float,
) -> tuple[str | None, str]:
    """Create a Stripe Payment Link for the final price.

    Returns (url, status). status is "ok", "skipped (no api key)", or "failed: ...".
    """
    if not STRIPE_SECRET_KEY:
        logger.info("[STRIPE STUB] Charge $%.2f for %s (%s)", final_price, customer.email, job_id)
        return None, "skipped (no api key)"

    try:
        price = stripe.Price.create(
            currency="usd",
            unit_amount=int(round(final_price * 100)),
            product_data={"name": f"Wedding photos - Job {job_id}"},
        )
        link = stripe.PaymentLink.create(
            line_items=[{"price": price.id, "quantity": 1}],
            metadata={"job_id": job_id, "customer_email": customer.email},
        )
        logger.info("Stripe PaymentLink created: %s", link.url)
        return link.url, "ok"
    except stripe.StripeError as exc:
        logger.exception("Stripe payment link failed")
        return None, f"failed: {exc.user_message or exc}"


def send_invoice_email(
    invoice_path: Path,
    job_id: str,
    final_price: float,
    customer_name: str,
    payment_url: str | None,
) -> str:
    """Send PDF invoice via Resend HTTP API (no SMTP).

    Returns "sent", "skipped (no api key)", or "failed: ...".
    """
    subject = f"Invoice for {customer_name} - Job {job_id} - ${final_price:.2f}"
    body_text = (
        f"Hi,\n\nAttached is the final invoice for job {job_id}.\n"
        f"Amount due: ${final_price:.2f}\n"
    )
    if payment_url:
        body_text += f"\nPay here: {payment_url}\n"
    body_text += "\n(Sent via the capture pipeline.)"

    if not RESEND_API_KEY:
        msg = f"[EMAIL STUB] Would send {invoice_path.name} to {INVOICE_RECIPIENT}"
        print(msg)
        logger.info(msg)
        return "skipped (no api key)"

    pdf_b64 = base64.b64encode(invoice_path.read_bytes()).decode("ascii")
    payload = {
        "from": RESEND_FROM,
        "to": [INVOICE_RECIPIENT],
        "subject": subject,
        "text": body_text,
        "attachments": [{"filename": invoice_path.name, "content": pdf_b64}],
    }
    try:
        r = httpx.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            timeout=15.0,
        )
        if r.status_code >= 300:
            logger.error("Resend send failed: %s %s", r.status_code, r.text)
            return f"failed: {r.status_code}"
        logger.info("Resend send ok: %s", r.json().get("id"))
        return "sent"
    except httpx.HTTPError as exc:
        logger.exception("Resend send error")
        return f"failed: {exc}"


def send_invoice_whatsapp(
    customer: Customer,
    job_id: str,
    final_price: float,
    payment_url: str | None,
) -> str:
    """Send the finalized invoice via WhatsApp (falls back to SMS if phone is plain E.164).

    Returns "sent:<sid>", "skipped (no phone)", "skipped (no twilio credentials)", or "failed: ...".
    """
    if not customer.phone:
        return "skipped (no phone)"
    if not _twilio_client:
        logger.info("[TWILIO STUB] Would WhatsApp invoice for job %s to %s", job_id, customer.phone)
        return "skipped (no twilio credentials)"

    pay_line = f"\nPay here 👉 {payment_url}" if payment_url else ""
    body = (
        f"🧾 *Invoice — Barter Deal Confirmed*\n\n"
        f"Hi {customer.name}!\n"
        f"Job: {job_id}\n"
        f"Amount due: ${final_price:.2f}{pay_line}\n\n"
        f"Thanks for dealing with us, no cap. 🤝"
    )
    to = f"whatsapp:{customer.phone}"
    try:
        msg = _twilio_client.messages.create(from_=TWILIO_WHATSAPP_FROM, to=to, body=body)
        logger.info("Twilio WhatsApp sent: %s", msg.sid)
        return f"sent:{msg.sid}"
    except Exception as exc:
        logger.exception("Twilio send failed")
        return f"failed: {exc}"


# TODO: ElevenLabs handoff placeholder


# --- Endpoints ---


@app.post("/webhook/capture", response_model=CaptureResponse)
def capture_webhook(request: CaptureRequest) -> CaptureResponse:
    if not request.images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    breakdown = [
        ImageBreakdown(id=img.id, value=value_for_image(img.id))
        for img in request.images
    ]
    total_value = round(sum(item.value for item in breakdown), 2)

    invoice_path = generate_invoice(
        job_id=request.job_id,
        customer=request.customer,
        breakdown=breakdown,
        total_value=total_value,
    )

    return CaptureResponse(
        job_id=request.job_id,
        total_value=total_value,
        breakdown=breakdown,
        invoice_path=str(invoice_path),
        stripe="pending-bartering",
    )


@app.post("/webhook/finalize", response_model=FinalizeResponse)
def finalize_webhook(request: FinalizeRequest) -> FinalizeResponse:
    """Called after bartering completes. Builds a simple PDF, creates a Stripe
    Payment Link, and emails the invoice."""
    if request.final_price <= 0:
        raise HTTPException(status_code=400, detail="final_price must be > 0")

    payment_url, stripe_status = create_stripe_payment_link(
        job_id=request.job_id,
        customer=request.customer,
        final_price=request.final_price,
    )

    invoice_path = generate_simple_invoice(
        job_id=request.job_id,
        customer=request.customer,
        final_price=request.final_price,
        image_count=request.image_count,
        payment_url=payment_url,
    )

    email_status = send_invoice_email(
        invoice_path=invoice_path,
        job_id=request.job_id,
        final_price=request.final_price,
        customer_name=request.customer.name,
        payment_url=payment_url,
    )

    whatsapp_status = send_invoice_whatsapp(
        customer=request.customer,
        job_id=request.job_id,
        final_price=request.final_price,
        payment_url=payment_url,
    )

    return FinalizeResponse(
        job_id=request.job_id,
        final_price=request.final_price,
        invoice_path=str(invoice_path),
        email_to=INVOICE_RECIPIENT,
        email_status=email_status,
        stripe_payment_url=payment_url,
        stripe_status=stripe_status,
        whatsapp_status=whatsapp_status,
    )
