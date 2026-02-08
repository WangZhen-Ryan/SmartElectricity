import { UsageInterval } from "../core/types";

export type UsageDaySummary = {
  date: string;
  importKwh: number;
  exportKwh: number;
  costAud: number;
  revenueAud: number;
  netAud: number;
};

export type UsageWeekSummary = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  days: UsageDaySummary[];
  totals: UsageDaySummary;
};

function dateKey(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function weekKey(dateStr: string) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const day = (base.getUTCDay() + 6) % 7;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const startDate = monday.toISOString().slice(0, 10);
  const endDate = sunday.toISOString().slice(0, 10);
  return {
    key: startDate,
    label: `Week of ${startDate}`,
    startDate,
    endDate,
  };
}

function summarizeDay(rows: UsageInterval[], timezone: string): UsageDaySummary[] {
  const grouped = new Map<string, UsageDaySummary>();
  rows.forEach((row) => {
    const key = dateKey(row.startTime, timezone);
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: key,
        importKwh: 0,
        exportKwh: 0,
        costAud: 0,
        revenueAud: 0,
        netAud: 0,
      });
    }
    const entry = grouped.get(key)!;
    const kwh = Math.abs(row.kwh || 0);
    const rateAud = Math.abs(row.perKwh || 0) / 100;
    if (row.channelType === "general") {
      entry.importKwh += kwh;
      entry.costAud += kwh * rateAud;
    } else {
      entry.exportKwh += kwh;
      entry.revenueAud += kwh * rateAud;
    }
  });

  const days = Array.from(grouped.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  days.forEach((day) => {
    day.netAud = day.revenueAud - day.costAud;
  });
  return days;
}

function totalSummary(days: UsageDaySummary[]): UsageDaySummary {
  return days.reduce(
    (acc, day) => {
      acc.importKwh += day.importKwh;
      acc.exportKwh += day.exportKwh;
      acc.costAud += day.costAud;
      acc.revenueAud += day.revenueAud;
      acc.netAud += day.netAud;
      return acc;
    },
    { date: "total", importKwh: 0, exportKwh: 0, costAud: 0, revenueAud: 0, netAud: 0 },
  );
}

export function buildUsageSummaries(
  usage: UsageInterval[] | null,
  timezone = "Australia/Canberra",
): UsageWeekSummary[] {
  if (!usage || !usage.length) return [];
  const days = summarizeDay(usage, timezone);
  const weekly = new Map<string, UsageWeekSummary>();
  days.forEach((day) => {
    const meta = weekKey(day.date);
    if (!weekly.has(meta.key)) {
      weekly.set(meta.key, {
        key: meta.key,
        label: meta.label,
        startDate: meta.startDate,
        endDate: meta.endDate,
        days: [],
        totals: { date: "total", importKwh: 0, exportKwh: 0, costAud: 0, revenueAud: 0, netAud: 0 },
      });
    }
    weekly.get(meta.key)!.days.push(day);
  });

  const weeks = Array.from(weekly.values()).sort((a, b) => (a.key > b.key ? 1 : -1));
  weeks.forEach((week) => {
    week.days.sort((a, b) => (a.date > b.date ? 1 : -1));
    week.totals = totalSummary(week.days);
  });
  return weeks;
}
