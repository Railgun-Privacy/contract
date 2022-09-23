module.exports = {
  env: {
    browser: false,
    es2021: true,
    mocha: true,
    node: true,
  },
  plugins: ['@typescript-eslint', 'jsdoc', 'eslint-plugin-tsdoc'],
  extends: [
    'airbnb-typescript/base',
    'plugin:jsdoc/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:@typescript-eslint/strict',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12,
    project: './tsconfig.json',
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    'import/prefer-default-export': 'off',
    'import/extensions': 'off',
    'import/no-extraneous-dependencies': 'off',
    'node/no-extraneous-import': 'off',
    'no-console': 'off',
    'no-process-exit': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/indent': 'off',
    '@typescript-eslint/no-unused-vars': 'error',
    'jsdoc/require-property-description': 'warn',
    'jsdoc/require-description': 'warn',
    'jsdoc/require-returns': [
      'warn',
      {
        forceRequireReturn: true,
        forceReturnsWithAsync: true,
      },
    ],
    'jsdoc/require-param-type': 'off',
    'jsdoc/require-returns-type': 'off',
    'jsdoc/require-jsdoc': [
      'warn',
      {
        publicOnly: false,
        exemptEmptyFunctions: true,
        require: {
          FunctionDeclaration: true,
          FunctionExpression: true,
          MethodDefinition: true,
          ClassExpression: false,
          ClassDeclaration: false,
        },
      },
    ],
    'tsdoc/syntax': 'warn',
  },
};
