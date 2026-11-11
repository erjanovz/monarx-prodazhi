import * as XLSX from "xlsx";

export type Zone = {
  channel: string;
  group: string;
  supervisor: string;
  rep: string;
  zone: string;
  target: number;
  fact: number;
};
export type Line = { client_zone: string; zone_type: string; channel: string; category: string; brand: string; amount: number };
export type Period = { work_days: number; days_passed: number; days_left: number; report_date: string };
export type Dataset = { zones: Zone[]; lines: Line[]; period: Period; source: string };

/** Row label in column A of the TRADE sheet → channel shown in the app. */
const ZONE_GROUPS: Record<string, string> = {
  "ГОРОД": "Город",
  "ОСДО 1": "Базар",
  "ОСДО 2": "Базар",
  "ОСДО": "Базар",
  "БАЗАР": "Базар",
  "ХОРЕКА": "Хорека",
  "KEY ACCOUNT": "Key Account",
  "КА": "Key Account",
  "РЕГИОН": "Регион",
};
/** «Тип рабочей зоны» in the raw sales block → channel. */
const LINE_TYPES: Record<string, string> = {
  "ГОРОД": "Город",
  "ОСДО": "Базар",
  "ХОРЕКА": "Хорека",
  "ХОРЕКА СЕТЬ": "Хорека",
  "KEY ACCOUNT": "Key Account",
  "РЕГИОН": "Регион",
};

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  if (typeof v === "number") return v;
  const n = Number(str(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const up = (v: unknown) => str(v).toUpperCase();

function dateFromName(name: string): string {
  const m = name.match(/(\d{2})[._-](\d{2})[._-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class ParseError extends Error {}

export function parseWorkbook(buf: ArrayBuffer, fileName: string): Dataset {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => n.trim().toUpperCase() === "TRADE") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new ParseError("В файле нет листа TRADE.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });

  // Working days: labels «Total days», «Passed», «Remain» with the number in the next cell.
  const findLabel = (label: string) => {
    for (const r of rows) {
      if (!r) continue;
      for (let c = 0; c < r.length - 1; c++) if (up(r[c]) === label.toUpperCase()) return num(r[c + 1]);
    }
    return null;
  };
  const workDays = findLabel("Total days");
  const passed = findLabel("Passed");
  const remain = findLabel("Remain");
  if (workDays == null || passed == null) throw new ParseError("Не нашёл рабочие дни (Total days / Passed) на листе TRADE.");

  // Plan/fact table: rows whose column A is a known zone group (skips «Итого» rows).
  const zones: Zone[] = [];
  for (const r of rows) {
    if (!r) continue;
    const group = str(r[0]);
    const channel = ZONE_GROUPS[group.toUpperCase()];
    if (!channel || !str(r[3])) continue;
    if (str(r[1]).startsWith("'")) continue;
    zones.push({
      channel,
      group,
      supervisor: str(r[1]),
      rep: str(r[2]),
      zone: str(r[3]),
      target: num(r[4]),
      fact: num(r[5]),
    });
  }
  if (!zones.length) throw new ParseError("Не нашёл таблицу зон (колонки ТИП ЗОНЫ, Супервайзер, Рабочие зоны, Таргет, Факт).");

  // Raw sales block: header «Рабочая зона | Тип рабочей зоны | ХП:Категория | ХП:Торговая марка | Сумма с переоценкой».
  const lines: Line[] = [];
  let hdrRow = -1, hdrCol = -1;
  rows.some((r, i) => {
    const c = r ? r.findIndex((v) => up(v) === "РАБОЧАЯ ЗОНА") : -1;
    if (c >= 0) { hdrRow = i; hdrCol = c; return true; }
    return false;
  });
  if (hdrRow >= 0) {
    for (let i = hdrRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !str(r[hdrCol])) continue;
      const type = str(r[hdrCol + 1]);
      lines.push({
        client_zone: str(r[hdrCol]),
        zone_type: type,
        channel: LINE_TYPES[type.toUpperCase()] ?? type,
        category: str(r[hdrCol + 2]),
        brand: str(r[hdrCol + 3]),
        amount: num(r[hdrCol + 4]),
      });
    }
  }

  return {
    zones,
    lines,
    period: {
      work_days: workDays,
      days_passed: passed,
      days_left: remain ?? Math.max(0, workDays - passed),
      report_date: dateFromName(fileName),
    },
    source: fileName,
  };
}
