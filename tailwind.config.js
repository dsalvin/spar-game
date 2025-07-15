/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html", // If you have an index.html in your root
    "./src/**/*.{js,jsx,ts,tsx}", // This tells Tailwind to scan all JS, JSX, TS, TSX files in your src folder
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'], // Keep this if you want to use the Inter font
      },
    },
  },
  plugins: [],
};