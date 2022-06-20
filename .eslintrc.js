module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ['@typescript-eslint'],
  extends: ['airbnb-base', 'plugin:prettier/recommended', 'plugin:node/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'node/no-unsupported-features/es-syntax': ['error', {ignores: ['modules']}],
    'import/prefer-default-export': 'off',
    'import/no-extraneous-dependencies': 'off',
    'node/no-extraneous-import': 'off',
    'no-console': 'off',
  },
};
