import { useId } from 'react';

interface OrbitMarkProps {
  size?: number;
  /** Render in monochrome (both rings the same color) for places where
   *  a tinted ring would clash. */
  mono?: boolean;
}

/**
 * Orbit brand mark — two interlocking elliptical rings tilted ±30°,
 * one fading from light to dark, the other from dark to light, with a
 * small satellite dot at one crossing. Pure SVG so it scales cleanly
 * at every size.
 *
 * Sourced from the V1 Ledger design bundle's `src/orbit-mark.jsx`.
 */
export function OrbitMark({ size = 20, mono = false }: OrbitMarkProps): JSX.Element {
  const reactId = useId();
  // useId returns a string with colons in some envs; strip for SVG-id safety.
  const id = `om-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const ringA = '#e8e8e8';
  const ringB = mono ? '#a0a0a0' : '#7ec891';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={ringA} stopOpacity="0.95" />
          <stop offset="55%" stopColor={ringA} stopOpacity="0.55" />
          <stop offset="100%" stopColor={ringA} stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ringB} stopOpacity="0.05" />
          <stop offset="45%" stopColor={ringB} stopOpacity="0.55" />
          <stop offset="100%" stopColor={ringB} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <g transform="translate(16 16) rotate(30)">
        <ellipse
          cx="0"
          cy="0"
          rx="12"
          ry="6.5"
          fill="none"
          stroke={`url(#${id}-a)`}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(16 16) rotate(-30)">
        <ellipse
          cx="0"
          cy="0"
          rx="12"
          ry="6.5"
          fill="none"
          stroke={`url(#${id}-b)`}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <circle cx="22" cy="11" r="1.4" fill={ringB} />
    </svg>
  );
}

interface OrbitWordmarkProps {
  /** Wordmark font size; mark scales proportionally. */
  size?: number;
}

export function OrbitWordmark({ size = 14 }: OrbitWordmarkProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-[7px] text-text-primary">
      <OrbitMark size={Math.round(size * 1.25)} />
      <span style={{ fontSize: size, fontWeight: 600, letterSpacing: -0.2 }}>orbit</span>
    </span>
  );
}
