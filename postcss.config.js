module.exports = {
  plugins: [
    require('@tailwindcss/postcss')(),
    require('autoprefixer')(),
    require('./scripts/workflow-css-scope.cjs')(),
  ],
};
