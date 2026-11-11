import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  BarXAxis,
  BarYAxis,
  ChartTooltip,
  Gauge,
  Grid,
  PieCenter,
  PieChart,
  PieSlice,
} from "@/components/charts";
import raw from "./data.json";
import { parseWorkbook, ParseError, type Dataset } from "./parse";

type Zone = Dataset["zones"][number];

const SAMPLE: Dataset = { ...(raw as unknown as Omit<Dataset, "source">), source: "All_Dashbord_09.11.2026.xlsm" };
const STORE_KEY = "monarx-sales-dataset-v1";
function loadSaved(): Dataset {
  try {
    const t = localStorage.getItem(STORE_KEY);
    if (t) {
      const d = JSON.parse(t) as Dataset;
      if (d && Array.isArray(d.zones) && d.zones.length && d.period) return d;
    }
  } catch {
    /* storage unavailable */
  }
  return SAMPLE;
}

/* The current dataset; swapped by App when a file is loaded, then the tree re-renders. */
let zones: Dataset["zones"] = [];
let lines: Dataset["lines"] = [];
let period: Dataset["period"] = SAMPLE.period;
let elapsed = 0;
function applyDataset(d: Dataset) {
  zones = d.zones;
  lines = d.lines;
  period = d.period;
  elapsed = period.work_days ? period.days_passed / period.work_days : 0;
}

const CHANNELS = ["Город", "Базар", "Хорека", "Key Account", "Регион"] as const;
const CATEGORIES = ["Кетчуп", "Майонез", "Соус", "Premium"] as const;
const CAT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];


const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mlnNum = (v: number) => (Math.abs(v / 1e6) >= 100 ? nf0 : nf1).format(v / 1e6);
const mln = (v: number) => `${mlnNum(v)} млн`;
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${nf1.format(v * 100)}%`);

type Totals = {
  target: number;
  fact: number;
  pct: number | null;
  forecast: number;
  forecastPct: number | null;
  paceGap: number;
  dailyNeed: number;
  count: number;
};
function totals(rows: Zone[]): Totals {
  const target = rows.reduce((s, r) => s + r.target, 0);
  const fact = rows.reduce((s, r) => s + r.fact, 0);
  const forecast = elapsed ? fact / elapsed : 0;
  return {
    target,
    fact,
    pct: target ? fact / target : null,
    forecast,
    forecastPct: target ? forecast / target : null,
    paceGap: fact - target * elapsed,
    dailyNeed: period.days_left ? Math.max(0, target - fact) / period.days_left : 0,
    count: rows.length,
  };
}

type Status = "ok" | "warn" | "bad" | "none";
const status = (fp: number | null): Status =>
  fp == null ? "none" : fp >= 1 ? "ok" : fp >= 0.85 ? "warn" : "bad";
const STATUS_TEXT: Record<Status, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  none: "text-muted-foreground",
};
const STATUS_PILL: Record<Status, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/20 text-warn",
  bad: "bg-bad/15 text-bad",
  none: "bg-muted text-muted-foreground",
};

/* Follow the host theme: explicit data-theme wins, otherwise the OS setting. */
function useHostTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const t = root.getAttribute("data-theme");
      root.classList.toggle("dark", t ? t === "dark" : mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", apply);
      mo.disconnect();
    };
  }, []);
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: React.ReactNode; tone?: Status }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 text-[21px] sm:text-[28px] leading-tight font-semibold tabular-nums tracking-tight ${tone ? STATUS_TEXT[tone] : ""}`}>
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">{sub}</div>
    </div>
  );
}

function Card({ id, title, note, children, className = "" }: { id: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`min-w-0 rounded-2xl border border-border bg-card p-5 ${className}`}>
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {note && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function useNarrow() {
  const q = "(max-width: 640px)";
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setN(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return n;
}

type SortKey = "zone" | "target" | "fact" | "pct" | "forecastPct" | "dailyNeed";

export default function App() {
  useHostTheme();
  const [data, setData] = useState<Dataset>(loadSaved);
  applyDataset(data);
  const [loadMsg, setLoadMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setLoadMsg(null);
    try {
      const d = parseWorkbook(await f.arrayBuffer(), f.name);
      setData(d);
      setChannel("");
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(d));
      } catch {
        /* storage unavailable: data stays until the app is closed */
      }
      setLoadMsg({ kind: "ok", text: `Загружено: ${f.name} — ${d.zones.length} зон` });
    } catch (e) {
      setLoadMsg({
        kind: "error",
        text: e instanceof ParseError ? e.message : "Не удалось прочитать файл. Выберите файл All_Dashbord в формате .xlsm или .xlsx.",
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const [channel, setChannel] = useState<string>("");
  const narrow = useNarrow();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "forecastPct", dir: -1 });

  const scoped = useMemo(() => (channel ? zones.filter((z) => z.channel === channel) : zones), [channel, data]);
  const t = useMemo(() => totals(scoped), [scoped]);

  const channelBars = useMemo(
    () =>
      CHANNELS.map((c) => {
        const x = totals(zones.filter((z) => z.channel === c));
        return {
          name: c,
          plan: Math.round(x.target / 1e6),
          fact: Math.round(x.fact / 1e6),
          pace: Math.round((x.target * elapsed) / 1e6),
          pct: x.pct,
          forecastPct: x.forecastPct,
        };
      }),
    [data]
  );

  const supervisorBars = useMemo(() => {
    const by = new Map<string, Zone[]>();
    for (const z of scoped) by.set(z.supervisor, [...(by.get(z.supervisor) ?? []), z]);
    return [...by.entries()]
      .map(([name, rows]) => {
        const x = totals(rows);
        return {
          name: name.split(" ")[0],
          full: name,
          channel: rows[0].channel,
          forecast: Math.round((x.forecastPct ?? 0) * 1000) / 10,
          fact: x.fact,
          target: x.target,
          zones: rows.length,
        };
      })
      .sort((a, b) => b.forecast - a.forecast);
  }, [scoped]);

  const catData = useMemo(() => {
    const ls = channel ? lines.filter((l) => l.channel === channel) : lines;
    return CATEGORIES.map((c, i) => {
      const rows = ls.filter((l) => l.category === c);
      const amount = rows.reduce((s, l) => s + l.amount, 0);
      const labro = rows.filter((l) => l.brand === "Labro").reduce((s, l) => s + l.amount, 0);
      return { label: c, value: Math.round(amount / 1e6), amount, labro, color: CAT_COLORS[i] };
    }).filter((d) => d.amount > 0);
  }, [channel, data]);
  const catTotal = catData.reduce((s, d) => s + d.amount, 0);

  const zoneRows = useMemo(() => {
    const rows = scoped.map((z) => {
      const x = totals([z]);
      return { ...z, pct: x.pct, forecastPct: x.forecastPct, dailyNeed: x.dailyNeed };
    });
    const v = (r: (typeof rows)[number]) => (sort.key === "zone" ? r.zone : (r[sort.key] as number | null) ?? -1);
    return rows.sort((a, b) => {
      const A = v(a), B = v(b);
      return (typeof A === "string" ? A.localeCompare(B as string, "ru") : (A as number) - (B as number)) * sort.dir;
    });
  }, [scoped, sort]);

  const st = status(t.forecastPct);
  const scopeText = channel ? `по каналу «${channel}»` : "по всем каналам";
  const date = new Date(`${period.report_date}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const sortBtn = (key: SortKey, label: string, right = true) => (
    <button
      type="button"
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "zone" ? 1 : -1 }))}
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${right ? "flex-row-reverse" : ""} ${sort.key === key ? "text-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className="w-2 text-[10px]">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] px-[max(16px,env(safe-area-inset-left,0px))] py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Monarx · отчёт на {date}
          </div>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-balance sm:text-[32px]">Тошкент Трейд — продажи</h1>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
            Прошло <b className="font-semibold text-foreground">{period.days_passed}</b> из{" "}
            <b className="font-semibold text-foreground">{period.work_days}</b> рабочих дней. Факт {scopeText}:{" "}
            <b className="font-semibold text-foreground">{mln(t.fact)}</b>, это{" "}
            <b className="font-semibold text-foreground">{pct(t.pct)}</b> месячного плана. При текущем темпе месяц закроется на{" "}
            <b className={`font-semibold ${STATUS_TEXT[st]}`}>{pct(t.forecastPct)}</b> плана.
          </p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
          <input
            ref={fileRef}
            id="file-input"
            type="file"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-60"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            {busy ? "Читаю файл…" : "Загрузить All_Dashbord"}
          </button>
          <div className="max-w-[320px] truncate text-xs text-muted-foreground sm:text-right">Файл: {data.source}</div>
        </div>
      </header>
      {loadMsg && (
        <div
          role="status"
          className={`mt-4 rounded-xl px-4 py-2.5 text-sm ${loadMsg.kind === "ok" ? "bg-ok/12 text-ok" : "bg-bad/12 text-bad"}`}
        >
          {loadMsg.text}
        </div>
      )}

      <nav aria-label="Канал" className="mt-6 flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/60 p-1 w-fit max-w-full">
        {["", ...CHANNELS].map((c) => {
          const on = channel === c;
          return (
            <button
              key={c || "all"}
              type="button"
              aria-pressed={on}
              onClick={() => setChannel(c)}
              className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                on ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c || "Все каналы"}
            </button>
          );
        })}
      </nav>

      <section aria-label="Главные показатели" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <Kpi label="План месяца" value={mln(t.target)} sub={<>Зон в плане: {t.count}</>} />
        <Kpi label="Факт продаж" value={mln(t.fact)} sub={<>{pct(t.pct)} плана · прошло {pct(elapsed)} месяца</>} />
        <Kpi label="Прогноз на месяц" value={mln(t.forecast)} tone={st} sub={<>{pct(t.forecastPct)} плана при текущем темпе</>} />
        <Kpi
          label="Отклонение от темпа"
          value={`${t.paceGap >= 0 ? "+" : "−"}${mln(Math.abs(t.paceGap))}`}
          tone={t.paceGap >= 0 ? "ok" : "bad"}
          sub="Факт минус план на сегодня"
        />
        <Kpi label="Нужно продавать в день" value={mln(t.dailyNeed)} sub={<>Осталось рабочих дней: {period.days_left}</>} />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card id="gauge" title="Выполнение плана" note={`Факт к месячному плану ${scopeText}. Прошло ${pct(elapsed)} рабочих дней.`}>
          <div className="mx-auto w-full max-w-[340px]">
            <Gauge
              key={channel || "all"}
              value={Math.min(100, (t.pct ?? 0) * 100)}
              centerValue={Math.round((t.pct ?? 0) * 1000) / 10}
              suffix="%"
              defaultLabel="факт к плану"
              totalNotches={40}
              formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
              minWidth={240}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-muted/60 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Должно быть</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{pct(elapsed)}</div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Прогноз</div>
              <div className={`mt-1 text-lg font-semibold tabular-nums ${STATUS_TEXT[st]}`}>{pct(t.forecastPct)}</div>
            </div>
          </div>
        </Card>

        <Card id="by-channel" title="План и факт по каналам, млн сум" note="Серые столбцы — план месяца, цветные — факт. Наведите на столбец, чтобы увидеть детали.">
          <BarChart data={channelBars} xDataKey="name" aspectRatio={narrow ? "4 / 3" : "16 / 8"} margin={{ top: 16, right: 8, bottom: 36, left: 8 }}>
            <Grid horizontal />
            <Bar dataKey="plan" fill="var(--chart-scale-01)" lineCap={6} />
            <Bar dataKey="fact" fill="var(--chart-line-primary)" lineCap={6} />
            <BarXAxis showAllLabels />
            <ChartTooltip
              rows={(p) => [
                { color: "var(--chart-scale-01)", label: "План", value: `${nf0.format(p.plan as number)} млн` },
                { color: "var(--chart-line-primary)", label: "Факт", value: `${nf0.format(p.fact as number)} млн · ${pct(p.pct as number)}` },
                { color: "var(--foreground)", label: "К сегодня по плану", value: `${nf0.format(p.pace as number)} млн` },
                { color: "var(--chart-2)", label: "Прогноз", value: pct(p.forecastPct as number) },
              ]}
            />
          </BarChart>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card id="by-supervisor" title="Прогноз выполнения по супервайзерам, %" note="Факт, пересчитанный на весь месяц при текущем темпе, к плану. 100% — план будет выполнен.">
          <BarChart
            key={channel || "all"}
            data={supervisorBars}
            xDataKey="name"
            orientation="horizontal"
            aspectRatio={`16 / ${Math.max(4, supervisorBars.length * (narrow ? 2.6 : 1.1))}`}
            margin={{ top: 8, right: 16, bottom: 8, left: 118 }}
          >
            <Grid horizontal={false} vertical fadeVertical />
            <Bar dataKey="forecast" fill="var(--chart-line-primary)" lineCap={6} showValue valueLabelPosition="top" valueLabelFormatter={(v) => `${nf0.format(v)}%`} />
            <BarYAxis />
            <ChartTooltip
              rows={(p) => [
                { color: "var(--chart-line-primary)", label: "Прогноз", value: `${nf1.format(p.forecast as number)}%` },
                { color: "var(--chart-scale-01)", label: "План", value: mln(p.target as number) },
                { color: "var(--chart-2)", label: "Факт", value: mln(p.fact as number) },
                { color: "var(--chart-4)", label: `${p.channel}, зон`, value: String(p.zones) },
              ]}
            />
          </BarChart>
        </Card>

        <Card id="by-category" title="Продажи по категориям" note="Доля категорий в факте. Наведите на сектор, чтобы увидеть сумму.">
          <div className="mx-auto w-full max-w-[280px]">
            <PieChart key={channel || "all"} data={catData} innerRadius={78} padAngle={0.03} cornerRadius={6}>
              {catData.map((d, i) => (
                <PieSlice key={d.label} index={i} />
              ))}
              <PieCenter defaultLabel="млн сум">
                {({ value, label }) => (
                  <div className="flex flex-col items-center text-center">
                    <span className="text-2xl font-semibold tabular-nums tracking-tight">{nf0.format(value)}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                )}
              </PieCenter>
            </PieChart>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {catData.map((d) => (
              <li key={d.label} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="tabular-nums text-muted-foreground">{mln(d.amount)}</span>
                <span className="w-14 text-right tabular-nums font-medium">{pct(catTotal ? d.amount / catTotal : null)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Бренд Labro: {mln(catData.reduce((s, d) => s + d.labro, 0))} из {mln(catTotal)}. Планы по категориям в файле заданы не для всех зон, поэтому здесь показан только факт.
          </p>
        </Card>
      </div>

      <Card id="zones" title="Рабочие зоны" note="Цвет прогноза: зелёный — 100% плана и выше, жёлтый — 85–100%, красный — ниже 85%. Нажмите на заголовок, чтобы отсортировать." className="mt-4">
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[860px] border-collapse whitespace-nowrap text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Канал</th>
                <th className="py-2 pr-3 font-medium">Супервайзер</th>
                <th className="py-2 pr-3 font-medium">Торговый представитель</th>
                <th className="py-2 pr-3">{sortBtn("zone", "Зона", false)}</th>
                <th className="py-2 pr-3 text-right">{sortBtn("target", "План, млн")}</th>
                <th className="py-2 pr-3 text-right">{sortBtn("fact", "Факт, млн")}</th>
                <th className="py-2 pr-3 text-right">{sortBtn("pct", "% плана")}</th>
                <th className="py-2 pr-3 text-right">{sortBtn("forecastPct", "Прогноз")}</th>
                <th className="py-2 text-right">{sortBtn("dailyNeed", "Нужно в день, млн")}</th>
              </tr>
            </thead>
            <tbody>
              {zoneRows.map((r) => {
                const s = status(r.forecastPct);
                return (
                  <tr key={r.zone} className="border-b border-border/70 hover:bg-muted/50">
                    <td className="py-2 pr-3 text-muted-foreground">{r.channel}</td>
                    <td className="py-2 pr-3">{r.supervisor}</td>
                    <td className="py-2 pr-3">{r.rep}</td>
                    <td className="py-2 pr-3 font-medium">{r.zone}</td>
                    <td className="py-2 pr-3 text-right">{mlnNum(r.target)}</td>
                    <td className="py-2 pr-3 text-right">{mlnNum(r.fact)}</td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-[var(--chart-line-primary)]" style={{ width: `${Math.min(100, (r.pct ?? 0) * 100)}%` }} />
                        </div>
                        <span className="w-12">{pct(r.pct)}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <span className={`inline-block min-w-[4.5em] rounded-full px-2 py-0.5 text-center text-xs font-medium ${STATUS_PILL[s]}`}>{pct(r.forecastPct)}</span>
                    </td>
                    <td className="py-2 text-right">{mlnNum(r.dailyNeed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <details className="mt-6 text-sm text-muted-foreground">
        <summary className="cursor-pointer">Как считаются показатели</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
          <li>% плана — факт продаж (сумма с переоценкой), делённый на план месяца.</li>
          <li>Прогноз — факт, делённый на прошедшие рабочие дни и умноженный на все рабочие дни месяца.</li>
          <li>Отклонение от темпа — факт минус часть плана, приходящаяся на прошедшие рабочие дни.</li>
          <li>Нужно продавать в день — остаток плана, делённый на оставшиеся рабочие дни.</li>
          <li>Источник: {data.source}, лист TRADE. Новый файл загружается кнопкой «Загрузить All_Dashbord» и запоминается на этом устройстве. Графики — Bklit UI.</li>
        </ul>
      </details>
    </div>
  );
}
