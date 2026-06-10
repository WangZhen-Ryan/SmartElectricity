from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from core.events import MarketEvent, OrderEvent, SignalEvent
from data.models import BatteryState


@dataclass
class SimpleRiskManager:
    capacity_kwh: float
    max_power_kw: float

    def generate_order(
        self,
        signal: SignalEvent,
        market: MarketEvent,
        state: BatteryState,
    ) -> Optional[OrderEvent]:
        interval_hours = (market.end_time - market.start_time).total_seconds() / 3600.0
        energy_limit_kwh = self.max_power_kw * interval_hours

        if signal.action == "BUY":
            if market.general_cents is None:
                return None
            quantity_kwh = min(energy_limit_kwh, self.capacity_kwh - state.soc_kwh)
            if quantity_kwh <= 0:
                return None
            return OrderEvent(
                timestamp=market.start_time,
                side="BUY",
                quantity_kwh=quantity_kwh,
                price_cents=market.general_cents,
            )

        if signal.action == "SELL":
            if market.feedin_cents is None:
                return None
            quantity_kwh = min(energy_limit_kwh, state.soc_kwh)
            if quantity_kwh <= 0:
                return None
            return OrderEvent(
                timestamp=market.start_time,
                side="SELL",
                quantity_kwh=quantity_kwh,
                price_cents=market.feedin_cents,
            )

        return None
