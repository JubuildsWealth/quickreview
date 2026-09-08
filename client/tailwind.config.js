/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fef7ec',
          500: '#f5a623',
          600: '#e0940f',
          700: '#b8770c',
        },
        accent: {
          50:  '#fef7ec',
          500: '#f5a623',
          600: '#e0940f',
          700: '#b8770c',
        },
      },
    },
  },
  plugins: [],
}
