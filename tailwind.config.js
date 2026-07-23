/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4: scan all component & screen source files
  content: [
    './src/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Primary brand palette
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        surface: {
          DEFAULT: '#0f172a',  // dark navy background
          card:    '#1e293b',  // slightly lighter card
          border:  '#334155',  // subtle border
        },
        hazard: '#ef4444',     // red for hazard alerts
        success: '#22c55e',    // green for confirmations
      },
      fontFamily: {
        sans: ['System'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
