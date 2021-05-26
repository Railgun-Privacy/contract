module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: [
    'airbnb-base',
    'plugin:jsdoc/recommended',
  ],
  plugins: [
    'jsdoc',
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  rules: {
    'import/no-extraneous-dependencies': 'off',
    'jsdoc/check-indentation': 1,
    'jsdoc/require-description': 1,
    'jsdoc/require-jsdoc': ['warn', {
      require: {
        ArrowFunctionExpression: true,
        ClassExpression: true,
        FunctionDeclaration: true,
        FunctionExpression: true,
        MethodDefinition: true,
      },
    }],
    'jsdoc/require-hyphen-before-param-description': 'warn',
  },
};
