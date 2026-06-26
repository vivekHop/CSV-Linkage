/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        workspace: {
          950: 'var(--color-workspace-950)',
          900: 'var(--color-workspace-900)',
          850: 'var(--color-workspace-850)',
          800: 'var(--color-workspace-800)',
          750: 'var(--color-workspace-750)',
          700: 'var(--color-workspace-700)',
          600: 'var(--color-workspace-600)',
          400: 'var(--color-workspace-400)',
          200: 'var(--color-workspace-200)',
          50: 'var(--color-workspace-50)',
        },
        brand: {
          teal: {
            DEFAULT: '#00f2fe',
            dark: '#4facfe',
          },
          violet: {
            DEFAULT: '#8a2be2',
            light: '#b57edc',
          },
          coral: {
            DEFAULT: '#ff5e62',
            dark: '#ff9966',
          },
          emerald: {
            DEFAULT: '#2bcbba',
            dark: '#0be881',
          }
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-teal': '0 0 15px rgba(0, 242, 254, 0.25)',
        'glow-violet': '0 0 15px rgba(138, 43, 226, 0.25)',
        'glow-coral': '0 0 15px rgba(255, 94, 98, 0.25)',
      }
    },
  },
  plugins: [],
}
