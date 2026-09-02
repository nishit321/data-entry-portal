/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identity. Drives primary actions, active nav, emphasis.
        brand: {
          DEFAULT: '#1F3A5F',
          light: '#2E5A88',
          50: '#f1f5f9',
          100: '#e2e8f0',
          200: '#c3d3e6',
          300: '#9bb4d1',
          400: '#6f90b4',
          500: '#4c6f98',
          600: '#2E5A88',
          700: '#274d75',
          800: '#1F3A5F',
          900: '#162a44',
        },
        // Semantic tokens — status and feedback only (FRONTEND_STANDARDS §3.2/§3.3).
        // Values mirror Tailwind's green/amber/red/blue so a redesign stays presentation-only.
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
        info: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
