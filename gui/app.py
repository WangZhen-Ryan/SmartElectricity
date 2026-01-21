from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox

from data.amber_api import fetch_amber_payload_range
from data.cache import save_payload
from data.loader import load_prices_from_json
from data.parser import parse_amber_payload
from engine.backtest import BacktestConfig, run_backtest
from strategy.percentile import PercentileStrategy
from strategy.simple_threshold import ThresholdStrategy

try:
    import matplotlib
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    from matplotlib.figure import Figure
except ImportError:
    matplotlib = None
    FigureCanvasTkAgg = None
    Figure = None


class BacktestApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Amber Battery Backtest")
        self.geometry("980x640")

        self.path_var = tk.StringVar(value="prices.json")
        self.cache_path_var = tk.StringVar(value="amber_cache.json")
        self.cache_enabled_var = tk.BooleanVar(value=False)
        self.site_id_var = tk.StringVar()
        self.token_var = tk.StringVar()
        self.start_var = tk.StringVar(value="2024-01-01T00:00:00+10:00")
        self.end_var = tk.StringVar(value="2024-01-02T00:00:00+10:00")
        self.resolution_var = tk.StringVar(value="30")
        self.capacity_var = tk.StringVar(value="40")
        self.max_power_var = tk.StringVar(value="10")
        self.daily_charge_var = tk.StringVar(value="0.98")
        self.start_soc_var = tk.StringVar(value="0")
        self.strategy_var = tk.StringVar(value="threshold")
        self.buy_threshold_var = tk.StringVar(value="15")
        self.sell_threshold_var = tk.StringVar(value="60")
        self.window_size_var = tk.StringVar(value="48")
        self.buy_percentile_var = tk.StringVar(value="0.2")
        self.sell_percentile_var = tk.StringVar(value="0.8")
        self.output_var = tk.StringVar(value="Ready.")

        self._build_ui()

    def _build_ui(self) -> None:
        top = tk.Frame(self)
        top.pack(fill=tk.X, padx=12, pady=8)

        tk.Label(top, text="Prices JSON:").pack(side=tk.LEFT)
        tk.Entry(top, textvariable=self.path_var, width=50).pack(side=tk.LEFT, padx=6)
        tk.Button(top, text="Browse", command=self._browse).pack(side=tk.LEFT)
        tk.Button(top, text="Run JSON", command=self._run_json).pack(side=tk.LEFT, padx=6)

        api_row = tk.Frame(self)
        api_row.pack(fill=tk.X, padx=12, pady=6)
        tk.Label(api_row, text="Site ID:").pack(side=tk.LEFT)
        tk.Entry(api_row, textvariable=self.site_id_var, width=18).pack(side=tk.LEFT, padx=4)
        tk.Label(api_row, text="Token:").pack(side=tk.LEFT)
        tk.Entry(api_row, textvariable=self.token_var, width=28, show="*").pack(side=tk.LEFT, padx=4)
        tk.Label(api_row, text="Resolution:").pack(side=tk.LEFT)
        tk.Entry(api_row, textvariable=self.resolution_var, width=5).pack(side=tk.LEFT, padx=4)
        tk.Button(api_row, text="Run API", command=self._run_api).pack(side=tk.LEFT, padx=6)

        range_row = tk.Frame(self)
        range_row.pack(fill=tk.X, padx=12, pady=4)
        tk.Label(range_row, text="Start:").pack(side=tk.LEFT)
        tk.Entry(range_row, textvariable=self.start_var, width=30).pack(side=tk.LEFT, padx=4)
        tk.Label(range_row, text="End:").pack(side=tk.LEFT)
        tk.Entry(range_row, textvariable=self.end_var, width=30).pack(side=tk.LEFT, padx=4)

        config_row = tk.Frame(self)
        config_row.pack(fill=tk.X, padx=12, pady=6)
        tk.Label(config_row, text="Capacity:").pack(side=tk.LEFT)
        tk.Entry(config_row, textvariable=self.capacity_var, width=6).pack(side=tk.LEFT, padx=4)
        tk.Label(config_row, text="Max kW:").pack(side=tk.LEFT)
        tk.Entry(config_row, textvariable=self.max_power_var, width=6).pack(side=tk.LEFT, padx=4)
        tk.Label(config_row, text="Daily $:").pack(side=tk.LEFT)
        tk.Entry(config_row, textvariable=self.daily_charge_var, width=6).pack(side=tk.LEFT, padx=4)
        tk.Label(config_row, text="Start SOC:").pack(side=tk.LEFT)
        tk.Entry(config_row, textvariable=self.start_soc_var, width=6).pack(side=tk.LEFT, padx=4)

        strat_row = tk.Frame(self)
        strat_row.pack(fill=tk.X, padx=12, pady=6)
        tk.Label(strat_row, text="Strategy:").pack(side=tk.LEFT)
        tk.OptionMenu(strat_row, self.strategy_var, "threshold", "percentile").pack(
            side=tk.LEFT, padx=4
        )
        tk.Label(strat_row, text="Buy <= ").pack(side=tk.LEFT)
        tk.Entry(strat_row, textvariable=self.buy_threshold_var, width=6).pack(
            side=tk.LEFT, padx=2
        )
        tk.Label(strat_row, text="Sell >= ").pack(side=tk.LEFT)
        tk.Entry(strat_row, textvariable=self.sell_threshold_var, width=6).pack(
            side=tk.LEFT, padx=2
        )
        tk.Label(strat_row, text="Window:").pack(side=tk.LEFT, padx=4)
        tk.Entry(strat_row, textvariable=self.window_size_var, width=6).pack(
            side=tk.LEFT, padx=2
        )
        tk.Label(strat_row, text="Buy%:").pack(side=tk.LEFT, padx=2)
        tk.Entry(strat_row, textvariable=self.buy_percentile_var, width=6).pack(
            side=tk.LEFT, padx=2
        )
        tk.Label(strat_row, text="Sell%:").pack(side=tk.LEFT, padx=2)
        tk.Entry(strat_row, textvariable=self.sell_percentile_var, width=6).pack(
            side=tk.LEFT, padx=2
        )

        cache_row = tk.Frame(self)
        cache_row.pack(fill=tk.X, padx=12, pady=4)
        tk.Label(cache_row, text="Cache JSON:").pack(side=tk.LEFT)
        tk.Entry(cache_row, textvariable=self.cache_path_var, width=44).pack(
            side=tk.LEFT, padx=6
        )
        tk.Checkbutton(
            cache_row,
            text="Save payload",
            variable=self.cache_enabled_var,
        ).pack(side=tk.LEFT)

        status = tk.Frame(self)
        status.pack(fill=tk.X, padx=12, pady=6)
        tk.Label(status, textvariable=self.output_var, anchor="w").pack(fill=tk.X)

        self.plot_frame = tk.Frame(self)
        self.plot_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=10)

        if matplotlib is None:
            note = tk.Label(
                self.plot_frame,
                text="matplotlib not installed; showing text summary only.",
                fg="gray",
            )
            note.pack(anchor="w")

    def _browse(self) -> None:
        path = filedialog.askopenfilename(
            title="Select Amber prices JSON",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if path:
            self.path_var.set(path)

    def _run_json(self) -> None:
        path = self.path_var.get().strip()
        if not path:
            messagebox.showerror("Missing file", "Please choose a prices JSON file.")
            return

        try:
            intervals = load_prices_from_json(path)
            strategy = self._build_strategy()
            config = self._build_config()
            result, history = run_backtest(intervals, strategy=strategy, config=config)
        except Exception as exc:
            messagebox.showerror("Backtest failed", str(exc))
            return

        summary = (
            f"Net profit: ${result.net_profit_aud:.2f} | "
            f"Buy: {result.total_buy_kwh:.1f} kWh | "
            f"Sell: {result.total_sell_kwh:.1f} kWh | "
            f"End SOC: {result.final_state.soc_kwh:.1f} kWh"
        )
        self.output_var.set(summary)

        if matplotlib is not None:
            self._render_plot(history)

    def _run_api(self) -> None:
        site_id = self.site_id_var.get().strip()
        token = self.token_var.get().strip()
        start_time = self.start_var.get().strip()
        end_time = self.end_var.get().strip()
        resolution = self.resolution_var.get().strip()

        if not site_id or not token:
            messagebox.showerror("Missing credentials", "Please provide site ID and token.")
            return
        if not start_time or not end_time:
            messagebox.showerror("Missing range", "Please provide start and end time.")
            return

        try:
            res_value = int(resolution)
        except ValueError:
            messagebox.showerror("Invalid resolution", "Resolution must be an integer.")
            return

        try:
            payload = fetch_amber_payload_range(
                site_id,
                token,
                start_time=start_time,
                end_time=end_time,
                resolution=res_value,
            )
            if self.cache_enabled_var.get():
                cache_path = self.cache_path_var.get().strip()
                if cache_path:
                    save_payload(payload, cache_path)
            intervals = parse_amber_payload(payload)
            strategy = self._build_strategy()
            config = self._build_config()
            result, history = run_backtest(intervals, strategy=strategy, config=config)
        except Exception as exc:
            messagebox.showerror("API fetch failed", str(exc))
            return

        summary = (
            f"Net profit: ${result.net_profit_aud:.2f} | "
            f"Buy: {result.total_buy_kwh:.1f} kWh | "
            f"Sell: {result.total_sell_kwh:.1f} kWh | "
            f"End SOC: {result.final_state.soc_kwh:.1f} kWh"
        )
        self.output_var.set(summary)

        if matplotlib is not None:
            self._render_plot(history)

    def _build_config(self) -> BacktestConfig:
        capacity = _parse_float(self.capacity_var.get(), "Capacity")
        max_power = _parse_float(self.max_power_var.get(), "Max kW")
        daily_charge = _parse_float(self.daily_charge_var.get(), "Daily $")
        start_soc = _parse_float(self.start_soc_var.get(), "Start SOC")
        return BacktestConfig(
            capacity_kwh=capacity,
            max_power_kw=max_power,
            daily_supply_charge_aud=daily_charge,
            start_soc_kwh=start_soc,
        )

    def _build_strategy(self):
        if self.strategy_var.get() == "percentile":
            window = _parse_int(self.window_size_var.get(), "Window size")
            buy_pct = _parse_float(self.buy_percentile_var.get(), "Buy percentile")
            sell_pct = _parse_float(self.sell_percentile_var.get(), "Sell percentile")
            return PercentileStrategy(
                window_size=window,
                buy_percentile=buy_pct,
                sell_percentile=sell_pct,
            )

        buy = _parse_float(self.buy_threshold_var.get(), "Buy threshold")
        sell = _parse_float(self.sell_threshold_var.get(), "Sell threshold")
        return ThresholdStrategy(
            buy_threshold_cents=buy,
            sell_threshold_cents=sell,
        )

    def _render_plot(self, history) -> None:
        for child in self.plot_frame.winfo_children():
            child.destroy()

        fig = Figure(figsize=(9, 4), dpi=100)
        ax1 = fig.add_subplot(111)
        ax2 = ax1.twinx()

        times = [p.start_time for p in history]
        soc = [p.soc_kwh for p in history]
        buy = [p.general_cents for p in history]
        sell = [p.feedin_cents for p in history]

        ax1.plot(times, buy, color="#1f77b4", label="Buy (cents)")
        ax1.plot(times, sell, color="#ff7f0e", label="Sell (cents)")
        ax1.set_ylabel("Price (cents/kWh)")
        ax1.legend(loc="upper left")

        ax2.plot(times, soc, color="#2ca02c", label="SOC (kWh)")
        ax2.set_ylabel("SOC (kWh)")
        ax2.legend(loc="upper right")

        fig.autofmt_xdate()
        canvas = FigureCanvasTkAgg(fig, master=self.plot_frame)
        canvas.draw()
        canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)


def _parse_float(value: str, label: str) -> float:
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be a number.") from exc


def _parse_int(value: str, label: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be an integer.") from exc


def main() -> None:
    app = BacktestApp()
    app.mainloop()


if __name__ == "__main__":
    main()
