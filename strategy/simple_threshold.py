from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from core.events import MarketEvent, SignalEvent
from data.models import BatteryState
from strategy.base import Strategy


@dataclass
class ThresholdStrategy(Strategy):
    buy_threshold_cents: float = 15.0
    sell_threshold_cents: float = 60.0

    def generate_signal(
        self,
        market: MarketEvent,
        state: BatteryState,
    ) -> Optional[SignalEvent]:
        # Prefer selling first if both thresholds are met.
        if market.feedin_cents is not None and market.feedin_cents >= self.sell_threshold_cents:
            return SignalEvent(timestamp=market.start_time, action="SELL")

        if market.general_cents is not None and market.general_cents <= self.buy_threshold_cents:
            return SignalEvent(timestamp=market.start_time, action="BUY")

        return None
