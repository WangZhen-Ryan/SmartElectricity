from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

from core.events import FillEvent, MarketEvent, OrderEvent, SignalEvent
from data.market_data import AmberPriceFeed
from data.models import BacktestPoint, BacktestResult, PriceInterval
from execution.simulated import SimulatedExecution
from portfolio.battery_portfolio import BatteryPortfolio
from risk.simple import SimpleRiskManager
from strategy.base import Strategy
from strategy.simple_threshold import ThresholdStrategy


@dataclass
class BacktestConfig:
    capacity_kwh: float = 40.0
    max_power_kw: float = 10.0
    daily_supply_charge_aud: float = 0.98
    start_soc_kwh: float = 0.0


class BacktestEngine:
    def __init__(
        self,
        *,
        feed: AmberPriceFeed,
        strategy: Strategy,
        risk_manager: SimpleRiskManager,
        execution: SimulatedExecution,
        portfolio: BatteryPortfolio,
    ) -> None:
        self.feed = feed
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.execution = execution
        self.portfolio = portfolio
        self.events = deque()
        self.last_market: Optional[MarketEvent] = None

    def run(self) -> Tuple[BacktestResult, List[BacktestPoint]]:
        history: List[BacktestPoint] = []
        start_time = None
        end_time = None

        while self.feed.has_next():
            market_event = self.feed.next_event()
            start_time = start_time or market_event.start_time
            end_time = market_event.end_time
            self.events.append(market_event)
            self._process_events()
            history.append(self.portfolio.snapshot(market_event))

        if start_time is None or end_time is None:
            raise ValueError("no intervals")

        self.portfolio.apply_daily_supply_charge(start_time, end_time)
        result = self.portfolio.finalize(start_time, end_time)
        return result, history

    def _process_events(self) -> None:
        while self.events:
            event = self.events.popleft()

            if isinstance(event, MarketEvent):
                self.last_market = event
                signal = self.strategy.generate_signal(event, self.portfolio.state)
                if signal:
                    self.events.append(signal)
                continue

            if isinstance(event, SignalEvent):
                if self.last_market is None:
                    continue
                order = self.risk_manager.generate_order(
                    event, self.last_market, self.portfolio.state
                )
                if order:
                    self.events.append(order)
                continue

            if isinstance(event, OrderEvent):
                fill = self.execution.execute_order(event)
                if fill:
                    self.events.append(fill)
                continue

            if isinstance(event, FillEvent):
                self.portfolio.on_fill(event)


def run_backtest(
    intervals: Iterable[PriceInterval],
    *,
    strategy: Optional[Strategy] = None,
    config: Optional[BacktestConfig] = None,
) -> Tuple[BacktestResult, List[BacktestPoint]]:
    cfg = config or BacktestConfig()
    strat = strategy or ThresholdStrategy()

    feed = AmberPriceFeed(list(intervals))
    risk_manager = SimpleRiskManager(
        capacity_kwh=cfg.capacity_kwh,
        max_power_kw=cfg.max_power_kw,
    )
    execution = SimulatedExecution()
    portfolio = BatteryPortfolio(
        capacity_kwh=cfg.capacity_kwh,
        daily_supply_charge_aud=cfg.daily_supply_charge_aud,
        start_soc_kwh=cfg.start_soc_kwh,
    )

    engine = BacktestEngine(
        feed=feed,
        strategy=strat,
        risk_manager=risk_manager,
        execution=execution,
        portfolio=portfolio,
    )
    return engine.run()
