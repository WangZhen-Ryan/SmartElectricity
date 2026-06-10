from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from core.events import MarketEvent, SignalEvent
from data.models import BatteryState
from strategy.base import Strategy


@dataclass
class PercentileStrategy(Strategy):
    window_size: int = 48
    buy_percentile: float = 0.2
    sell_percentile: float = 0.8
    _general_window: List[float] = field(default_factory=list, init=False)
    _feedin_window: List[float] = field(default_factory=list, init=False)

    def generate_signal(
        self,
        market: MarketEvent,
        state: BatteryState,
    ) -> Optional[SignalEvent]:
        if market.general_cents is not None:
            _append_window(self._general_window, market.general_cents, self.window_size)
        if market.feedin_cents is not None:
            _append_window(self._feedin_window, market.feedin_cents, self.window_size)

        buy_threshold = _percentile(self._general_window, self.buy_percentile)
        sell_threshold = _percentile(self._feedin_window, self.sell_percentile)

        if sell_threshold is not None and market.feedin_cents is not None:
            if market.feedin_cents >= sell_threshold:
                return SignalEvent(timestamp=market.start_time, action="SELL")

        if buy_threshold is not None and market.general_cents is not None:
            if market.general_cents <= buy_threshold:
                return SignalEvent(timestamp=market.start_time, action="BUY")

        return None


def _append_window(values: List[float], value: float, limit: int) -> None:
    values.append(value)
    if len(values) > limit:
        values.pop(0)


def _percentile(values: List[float], pct: float) -> Optional[float]:
    if not values:
        return None
    pct = min(max(pct, 0.0), 1.0)
    ordered = sorted(values)
    idx = int((len(ordered) - 1) * pct)
    return ordered[idx]
