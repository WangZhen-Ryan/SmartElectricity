from __future__ import annotations

from datetime import datetime

from core.events import FillEvent, MarketEvent
from data.models import BacktestPoint, BacktestResult, BatteryState


class BatteryPortfolio:
    def __init__(
        self,
        *,
        capacity_kwh: float,
        daily_supply_charge_aud: float,
        start_soc_kwh: float,
    ) -> None:
        self.capacity_kwh = capacity_kwh
        self.daily_supply_charge_aud = daily_supply_charge_aud
        self.state = BatteryState(soc_kwh=start_soc_kwh, cash_aud=0.0)
        self.total_buy_kwh = 0.0
        self.total_sell_kwh = 0.0
        self.total_cycles_kwh = 0.0

    def on_fill(self, fill: FillEvent) -> None:
        if fill.side == "BUY":
            self.state.soc_kwh += fill.quantity_kwh
            cost_aud = fill.quantity_kwh * (fill.price_cents / 100.0)
            self.state.cash_aud -= cost_aud
            self.total_buy_kwh += fill.quantity_kwh
            self.total_cycles_kwh += fill.quantity_kwh
            return

        if fill.side == "SELL":
            self.state.soc_kwh -= fill.quantity_kwh
            revenue_aud = fill.quantity_kwh * (fill.price_cents / 100.0)
            self.state.cash_aud += revenue_aud
            self.total_sell_kwh += fill.quantity_kwh
            self.total_cycles_kwh += fill.quantity_kwh

    def snapshot(self, market: MarketEvent) -> BacktestPoint:
        return BacktestPoint(
            start_time=market.start_time,
            soc_kwh=self.state.soc_kwh,
            general_cents=market.general_cents or 0.0,
            feedin_cents=market.feedin_cents or 0.0,
        )

    def apply_daily_supply_charge(self, start: datetime, end: datetime) -> None:
        days = _days_covered(start, end)
        self.state.cash_aud -= days * self.daily_supply_charge_aud

    def finalize(self, start: datetime, end: datetime) -> BacktestResult:
        return BacktestResult(
            start=start,
            end=end,
            final_state=self.state,
            total_buy_kwh=self.total_buy_kwh,
            total_sell_kwh=self.total_sell_kwh,
            total_cycles_kwh=self.total_cycles_kwh,
            net_profit_aud=self.state.cash_aud,
        )


def _days_covered(start: datetime, end: datetime) -> int:
    start_date = start.date()
    end_date = end.date()
    return (end_date - start_date).days + 1
