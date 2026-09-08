/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f2f2f4',
          100: '#e4e4e7',
          200: '#d4d4d8',
          500: '#3a3a3c',
          600: '#1d1d1f',
          700: '#000000',
        },
        accent: {
          50:  '#f2f2f4',
          100: '#e4e4e7',
          200: '#d4d4d8',
          500: '#3a3a3c',
          600: '#1d1d1f',
          700: '#000000',
        },
      },
    },
  },
  plugins: [],
}
