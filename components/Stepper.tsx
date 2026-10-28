'use client';

const STEP_LABELS = ['Brief', 'Platform', 'Generate'];

interface StepperProps {
  step: number;
  canGoto: (target: number) => boolean;
  onGoto: (target: number) => void;
}

export default function Stepper({ step, canGoto, onGoto }: StepperProps) {
  return (
    <nav className="stepper aurora-enter" aria-label="Wizard steps">
      {STEP_LABELS.map((label, i) => {
        const num = i + 1;
        const locked = !canGoto(num);
        const done = num < step;
        return (
          <button
            key={label}
            type="button"
            className={`step${step === num ? ' active' : ''}${locked ? ' locked' : ''}`}
            aria-current={step === num ? 'step' : undefined}
            disabled={locked}
            onClick={() => {
              if (!locked) onGoto(num);
            }}
          >
            <span className="num" aria-hidden="true">
              {done ? (
                <svg viewBox="0 0 24 24" width="11" height="11" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 3 }}>
                  <path d="m5 12 5 5L20 7" />
                </svg>
              ) : (
                num
              )}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
