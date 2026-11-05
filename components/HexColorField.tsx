'use client';

import { useEffect, useState } from 'react';

function parseHex(value: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** Swatch + hex text field — hex is the editable source of truth for brand colors. */
export default function HexColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hexDraft, setHexDraft] = useState(value);
  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  return (
    <div className="color-field">
      <span className="color-field-label">{label}</span>
      <input
        id={id}
        type="color"
        value={parseHex(value) ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      <input
        type="text"
        className="color-hex"
        value={hexDraft}
        spellCheck={false}
        aria-label={`${label} hex`}
        onChange={(e) => {
          const next = e.target.value;
          setHexDraft(next);
          const parsed = parseHex(next);
          if (parsed) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = parseHex(hexDraft);
          setHexDraft(parsed ?? value);
        }}
      />
    </div>
  );
}
