import type { Config } from 'tailwindcss';

/**
 * Orbit design tokens — see docs/architecture.md and CLAUDE.md for rules of use.
 *
 * Colors are exposed as CSS variables in `src/styles/globals.css` so we can swap
 * themes later without rebuilding. Dark mode is the default and only theme for
 * Phase 0.
 *
 * Allowed spacing values (px): 4, 8, 12, 16, 20, 24, 32, 48. These all map to
 * Tailwind's default scale (1, 2, 3, 4, 5, 6, 8, 12). Do not use other values.
 *
 * Radius tokens: 6 (inputs), 8 (buttons/cards), 12 (panels/modals).
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: 'var(--color-bg-app)',
        panel: 'var(--color-bg-panel)',
        elevated: 'var(--color-bg-elevated)',
        hover: 'var(--color-bg-hover)',
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
        },
        accent: 'var(--color-accent)',
        status: {
          active: 'var(--color-status-active)',
          waiting: 'var(--color-status-waiting)',
          error: 'var(--color-status-error)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '11': ['11px', { lineHeight: '16px' }],
        '12': ['12px', { lineHeight: '16px' }],
        '13': ['13px', { lineHeight: '20px' }],
        '14': ['14px', { lineHeight: '20px' }],
        '16': ['16px', { lineHeight: '24px' }],
        '20': ['20px', { lineHeight: '28px' }],
        '28': ['28px', { lineHeight: '36px' }],
      },
      borderRadius: {
        input: '6px',
        button: '8px',
        card: '8px',
        panel: '12px',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '260ms',
      },
      backgroundImage: {
        'dot-grid': 'radial-gradient(circle, var(--color-border-subtle) 1px, transparent 1px)',
      },
      backgroundSize: {
        'dot-grid': '20px 20px',
      },
    },
  },
  plugins: [],
};

export default config;
