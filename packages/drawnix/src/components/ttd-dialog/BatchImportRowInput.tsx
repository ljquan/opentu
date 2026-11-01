import React, { useState } from 'react';

interface BatchImportRowInputProps {
  id: string;
  label: string;
  unit: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  describedBy?: string;
}

export function BatchImportRowInput({
  id,
  label,
  unit,
  value,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  describedBy,
}: BatchImportRowInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (number: number) => Math.min(max, Math.max(1, number));
  const commit = () => {
    if (draft !== null && draft.trim() !== '') {
      const parsed = Number(draft);
      if (Number.isFinite(parsed)) onChange(clamp(Math.trunc(parsed)));
    }
    setDraft(null);
  };

  return (
    <div className="import-setting-item">
      <label htmlFor={id}>{label}</label>
      <div className="import-number-input">
        <button
          type="button"
          aria-label={decreaseLabel}
          disabled={value <= 1}
          onClick={() => {
            setDraft(null);
            onChange(clamp(value - 1));
          }}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          value={draft ?? value}
          aria-describedby={describedBy}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const parsed = Number(text);
            if (
              text !== '' &&
              Number.isInteger(parsed) &&
              parsed >= 1 &&
              parsed <= max
            ) {
              onChange(parsed);
            }
          }}
          onBlur={commit}
          className="start-row-input"
        />
        <span aria-hidden="true">{unit}</span>
        <button
          type="button"
          aria-label={increaseLabel}
          disabled={value >= max}
          onClick={() => {
            setDraft(null);
            onChange(clamp(value + 1));
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
