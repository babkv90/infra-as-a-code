/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        glow: '0 0 0 1px rgba(37, 99, 235, 0.22), 0 14px 40px rgba(37, 99, 235, 0.22)',
      },
    },
  },
  plugins: [],
};
