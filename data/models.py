from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class PriceInterval:
    start_time: datetime
    end_time: datetime
    channel_type: str  # "general" (buy) or "feedIn" (sell)
    per_kwh_cents: float  # Amber returns cents; keep as cents for precision


@dataclass
class BatteryState:
    soc_kwh: float
    cash_aud: float


@dataclass
class BacktestResult:
    start: datetime
    end: datetime
    final_state: BatteryState
    total_buy_kwh: float
    total_sell_kwh: float
    total_cycles_kwh: float
    net_profit_aud: float


@dataclass
class BacktestPoint:
    start_time: datetime
    soc_kwh: float
    general_cents: float
    feedin_cents: float
