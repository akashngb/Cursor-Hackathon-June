import base64
import binascii
import logging
import random
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, field_validator
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Capture Webhook Pipeline")

INVOICES_DIR = Path("./invoices")


# --- Pydantic models ---


class Customer(BaseModel):
    name: str
    email: EmailStr


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


def stub_stripe_charge(total_value: float, customer_email: str, job_id: str) -> None:
    # TODO: Integrate real Stripe test-mode charge here.
    # Use stripe.PaymentIntent.create() with test API key and webhook confirmation.
    message = f"[STRIPE STUB] Charge ${total_value} for {customer_email} ({job_id})"
    print(message)
    logger.info(message)


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

    stub_stripe_charge(
        total_value=total_value,
        customer_email=request.customer.email,
        job_id=request.job_id,
    )

    return CaptureResponse(
        job_id=request.job_id,
        total_value=total_value,
        breakdown=breakdown,
        invoice_path=str(invoice_path),
        stripe="stubbed",
    )
