from typing import Optional
from pydantic import BaseModel


class ReceiptItemOut(BaseModel):
    line_no: int
    product: str            # as printed: 'QUESO GRANA PADANO'
    display: str            # 'Queso grana padano'
    quantity: float
    weight_kg: Optional[float]
    unit_price: Optional[float]   # € per unit, or €/kg when weight_kg is set
    amount: float
    group: str
    avoid: bool


class ReceiptOut(BaseModel):
    id: int
    transaction_id: str
    store: str
    purchased_at: Optional[str]
    invoice_no: Optional[str]
    total: float
    matches_transaction: bool     # ticket total == expense amount
    pdf_url: str                  # path on the API, e.g. /money/receipts/3/pdf
    items: list[ReceiptItemOut]


class GroceryGroupSpend(BaseModel):
    group: str
    amount: float
    share: float


class GroceryAvoidItem(BaseModel):
    product: str
    display: str
    group: str
    times: int
    amount: float
    last_date: str


class GroceryMonth(BaseModel):
    month: str
    total: float
    avoid: float


class GrocerySummary(BaseModel):
    start: str
    receipts: int
    total: float
    groups: list[GroceryGroupSpend]
    avoid_total: float
    avoid_share: float
    avoid_items: list[GroceryAvoidItem]
    months: list[GroceryMonth]


class PricePoint(BaseModel):
    date: str
    price: float


class GroceryProduct(BaseModel):
    product: str
    display: str
    group: str
    avoid: bool
    per_kg: bool
    times: int
    spent: float
    last_date: str
    first_price: float
    last_price: float
    change_pct: float
    history: list[PricePoint]


class GroceryProductPatch(BaseModel):
    product: str                  # as printed on the ticket
    group: Optional[str] = None
    avoid: Optional[bool] = None
    reset: bool = False           # drop the override, back to the keyword rules


class RecentGrocery(BaseModel):
    product: str
    display: str
    group: str
    avoid: bool
    times: int
    last_date: str
