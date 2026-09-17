"use client";

import { MAX_STOCK_SHEET, MIN_STOCK_SHEET, StockSheet } from "@/lib/config";

/**
 * Plaatvoorraad voor één materiaal: lijst van plaatmaten met aantal.
 * Aantal leeg = onbeperkt (de standaardplaat die je bijbestelt); regels met
 * een aantal (restplaten, al ingekochte platen) gebruikt de nesting eerst.
 */
export default function StockEditor({
  label,
  stock,
  onChange,
  defaultSize,
}: {
  label: string;
  stock: StockSheet[];
  onChange: (stock: StockSheet[]) => void;
  /** Maat voor een nieuwe regel. */
  defaultSize: { length: number; width: number };
}) {
  const set = (i: number, patch: Partial<StockSheet>) =>
    onChange(stock.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => onChange(stock.filter((_, k) => k !== i));
  const clampMm = (v: number) => Math.min(MAX_STOCK_SHEET, Math.max(MIN_STOCK_SHEET, Math.round(v)));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-neutral-500">lengte × breedte · aantal</span>
      </div>
      <ul className="space-y-2">
        {stock.map((e, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              aria-label={`${label} plaat ${i + 1} lengte`}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-2 text-sm"
              value={e.length}
              min={MIN_STOCK_SHEET}
              max={MAX_STOCK_SHEET}
              step={10}
              onChange={(ev) => set(i, { length: Number(ev.target.value) })}
              onBlur={(ev) => set(i, { length: clampMm(Number(ev.target.value) || defaultSize.length) })}
            />
            <span className="text-neutral-400">×</span>
            <input
              type="number"
              inputMode="numeric"
              aria-label={`${label} plaat ${i + 1} breedte`}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-2 text-sm"
              value={e.width}
              min={MIN_STOCK_SHEET}
              max={MAX_STOCK_SHEET}
              step={10}
              onChange={(ev) => set(i, { width: Number(ev.target.value) })}
              onBlur={(ev) => set(i, { width: clampMm(Number(ev.target.value) || defaultSize.width) })}
            />
            <input
              type="number"
              inputMode="numeric"
              aria-label={`${label} plaat ${i + 1} aantal`}
              title="Leeg = onbeperkt"
              placeholder="∞"
              className="w-14 rounded-lg border border-neutral-300 px-2 py-2 text-center text-sm"
              value={e.qty ?? ""}
              min={1}
              max={999}
              onChange={(ev) => {
                const n = parseInt(ev.target.value, 10);
                set(i, { qty: Number.isFinite(n) && n >= 1 ? n : null });
              }}
            />
            <button
              type="button"
              className="btn-touch flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:text-red-700 disabled:opacity-30"
              aria-label={`${label} plaat ${i + 1} verwijderen`}
              disabled={stock.length <= 1}
              onClick={() => remove(i)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-touch rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium"
          onClick={() =>
            onChange([{ length: 1200, width: 600, qty: 1, naam: "restplaat" }, ...stock])
          }
        >
          + Restplaat
        </button>
        {!stock.some((e) => e.qty === null) && (
          <button
            type="button"
            className="btn-touch rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium"
            onClick={() => onChange([...stock, { ...defaultSize, qty: null }])}
          >
            + Standaardplaat (onbeperkt)
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Aantal leeg = onbeperkt bijbestellen. Platen met een aantal (restmateriaal, al
        ingekocht) worden eerst gebruikt, in deze volgorde.
      </p>
    </div>
  );
}
