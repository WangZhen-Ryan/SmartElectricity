from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class MarketEvent:
    start_time: datetime
    end_time: datetime
    general_cents: Optional[float]
    feedin_cents: Optional[float]


@dataclass
class SignalEvent:
    timestamp: datetime
    action: str  # "BUY" or "SELL"
    strength: float = 1.0


@dataclass
class OrderEvent:
    timestamp: datetime
    side: str  # "BUY" or "SELL"
    quantity_kwh: float
    price_cents: float


@dataclass
class FillEvent:
    timestamp: datetime
    side: str  # "BUY" or "SELL"
    quantity_kwh: float
    price_cents: float
