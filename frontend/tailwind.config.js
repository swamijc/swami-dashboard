/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          500: '#0072ce',
          600: '#005eb8',
          700: '#004b93',
          900: '#06121f'
        }
      }
    }
  },
  plugins: []
}
