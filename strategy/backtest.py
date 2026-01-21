from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, Optional, Tuple

from data.models import BacktestPoint, BacktestResult, BatteryState, PriceInterval
from strategy.simple_threshold import ThresholdStrategy


def backtest(
    intervals: Iterable[PriceInterval],
    *,
    capacity_kwh: float = 40.0,
    max_power_kw: float = 10.0,
    daily_supply_charge_aud: float = 0.98,
    start_soc_kwh: float = 0.0,
    strategy: Optional[ThresholdStrategy] = None,
) -> BacktestResult:
    """
    Backtest a strategy over Amber intervals.
    Strategy defaults to a simple threshold policy.
    """
    result, _ = _run_backtest(
        intervals,
        capacity_kwh=capacity_kwh,
        max_power_kw=max_power_kw,
        daily_supply_charge_aud=daily_supply_charge_aud,
        start_soc_kwh=start_soc_kwh,
        strategy=strategy,
        record_history=False,
    )
    return result


def backtest_with_history(
    intervals: Iterable[PriceInterval],
    *,
    capacity_kwh: float = 40.0,
    max_power_kw: float = 10.0,
    daily_supply_charge_aud: float = 0.98,
    start_soc_kwh: float = 0.0,
    strategy: Optional[ThresholdStrategy] = None,
) -> Tuple[BacktestResult, list[BacktestPoint]]:
    return _run_backtest(
        intervals,
        capacity_kwh=capacity_kwh,
        max_power_kw=max_power_kw,
        daily_supply_charge_aud=daily_supply_charge_aud,
        start_soc_kwh=start_soc_kwh,
        strategy=strategy,
        record_history=True,
    )


def _run_backtest(
    intervals: Iterable[PriceInterval],
    *,
    capacity_kwh: float,
    max_power_kw: float,
    daily_supply_charge_aud: float,
    start_soc_kwh: float,
    strategy: Optional[ThresholdStrategy],
    record_history: bool,
) -> Tuple[BacktestResult, list[BacktestPoint]]:
    buckets = _group_by_start(intervals)
    starts = sorted(buckets.keys())
    if not starts:
        raise ValueError("no intervals")

    if strategy is None:
        strategy = ThresholdStrategy()

    state = BatteryState(soc_kwh=start_soc_kwh, cash_aud=0.0)
    total_buy_kwh = 0.0
    total_sell_kwh = 0.0
    total_cycles_kwh = 0.0
    history: list[BacktestPoint] = []

    for start_time in starts:
        general, feedin, end_time = buckets[start_time]
        interval_hours = (end_time - start_time).total_seconds() / 3600.0
        energy_limit_kwh = max_power_kw * interval_hours

        charge_kwh, discharge_kwh = strategy.decide(
            general=general,
            feedin=feedin,
            state=state,
            capacity_kwh=capacity_kwh,
            energy_limit_kwh=energy_limit_kwh,
        )

        if charge_kwh > 0 and general is not None:
            state.soc_kwh += charge_kwh
            cost_aud = charge_kwh * (general.per_kwh_cents / 100.0)
            state.cash_aud -= cost_aud
            total_buy_kwh += charge_kwh
            total_cycles_kwh += charge_kwh

        if discharge_kwh > 0 and feedin is not None:
            state.soc_kwh -= discharge_kwh
            revenue_aud = discharge_kwh * (feedin.per_kwh_cents / 100.0)
            state.cash_aud += revenue_aud
            total_sell_kwh += discharge_kwh
            total_cycles_kwh += discharge_kwh

        if record_history:
            history.append(
                BacktestPoint(
                    start_time=start_time,
                    soc_kwh=state.soc_kwh,
                    general_cents=general.per_kwh_cents if general else 0.0,
                    feedin_cents=feedin.per_kwh_cents if feedin else 0.0,
                )
            )

    days = _days_covered(starts[0], buckets[starts[-1]][2])
    state.cash_aud -= days * daily_supply_charge_aud

    result = BacktestResult(
        start=starts[0],
        end=buckets[starts[-1]][2],
        final_state=state,
        total_buy_kwh=total_buy_kwh,
        total_sell_kwh=total_sell_kwh,
        total_cycles_kwh=total_cycles_kwh,
        net_profit_aud=state.cash_aud,
    )
    return result, history


def _group_by_start(
    intervals: Iterable[PriceInterval],
) -> Dict[datetime, Tuple[Optional[PriceInterval], Optional[PriceInterval], datetime]]:
    buckets: Dict[datetime, Tuple[Optional[PriceInterval], Optional[PriceInterval], datetime]] = {}
    for interval in intervals:
        general, feedin, end_time = buckets.get(interval.start_time, (None, None, interval.end_time))
        if interval.channel_type == "general":
            general = interval
        elif interval.channel_type == "feedIn":
            feedin = interval
        buckets[interval.start_time] = (general, feedin, interval.end_time)
    return buckets


def _days_covered(start: datetime, end: datetime) -> int:
    # Count calendar days spanned; minimum 1 day if any data exists.
    start_date = start.date()
    end_date = end.date()
    return (end_date - start_date).days + 1
