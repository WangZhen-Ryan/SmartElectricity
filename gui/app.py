from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox

from data.loader import load_prices_from_json
from strategy.backtest import backtest_with_history
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
        self.output_var = tk.StringVar(value="Ready.")

        self._build_ui()

    def _build_ui(self) -> None:
        top = tk.Frame(self)
        top.pack(fill=tk.X, padx=12, pady=10)

        tk.Label(top, text="Prices JSON:").pack(side=tk.LEFT)
        tk.Entry(top, textvariable=self.path_var, width=60).pack(side=tk.LEFT, padx=6)
        tk.Button(top, text="Browse", command=self._browse).pack(side=tk.LEFT)
        tk.Button(top, text="Run", command=self._run).pack(side=tk.LEFT, padx=6)

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

    def _run(self) -> None:
        path = self.path_var.get().strip()
        if not path:
            messagebox.showerror("Missing file", "Please choose a prices JSON file.")
            return

        try:
            intervals = load_prices_from_json(path)
            strategy = ThresholdStrategy()
            result, history = backtest_with_history(intervals, strategy=strategy)
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


def main() -> None:
    app = BacktestApp()
    app.mainloop()


if __name__ == "__main__":
    main()
