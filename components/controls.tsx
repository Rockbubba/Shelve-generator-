"use client";

/** Kleine, mobile-first bedieningscomponenten met grote touch-targets. */

export function Stepper({
  label,
  value,
  onChange,
  step = 10,
  min,
  max,
  unit = "mm",
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min: number;
  max: number;
  unit?: string;
  hint?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
      </div>
      <div className="mt-1 flex items-stretch gap-2">
        <button
          type="button"
          aria-label={`${label} verlagen`}
          className="btn-touch rounded-xl border border-neutral-300 px-4 text-xl font-semibold active:bg-neutral-100"
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <div className="flex flex-1 items-center justify-center rounded-xl bg-neutral-100">
          <input
            type="number"
            inputMode="numeric"
            className="w-20 bg-transparent text-center text-base font-semibold outline-none"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(clamp(v));
            }}
          />
          <span className="text-sm text-neutral-500">{unit}</span>
        </div>
        <button
          type="button"
          aria-label={`${label} verhogen`}
          className="btn-touch rounded-xl border border-neutral-300 px-4 text-xl font-semibold active:bg-neutral-100"
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-neutral-100 p-1">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className={`btn-touch rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
              opt.value === value
                ? "bg-white text-ink shadow"
                : "text-neutral-500"
            }`}
            onClick={() => onChange(opt.value)}
          >
            <span className="block">{opt.label}</span>
            {opt.sub ? (
              <span className="block text-[11px] font-normal text-neutral-400">
                {opt.sub}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className="btn-touch flex w-full items-center justify-between py-2 text-left"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-neutral-500">{hint}</span> : null}
      </span>
      <span
        className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-neutral-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
