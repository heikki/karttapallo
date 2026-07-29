import love from 'eslint-config-love';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/build/**']
  },
  {
    ...love,
    files: ['**/*.js', '**/*.ts', '**/*.tsx'],
    rules: {
      ...love.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      // Named functions are declarations. `allowTypeAnnotation` keeps the one
      // case a declaration can't express: `const f: SomeFnType = (a, b) => …`,
      // where the variable's type is what gives the parameters their types.
      'func-style': [
        'error',
        'declaration',
        { allowArrowFunctions: false, allowTypeAnnotation: true }
      ],
      'no-console': 'off',
      'no-plusplus': 'off',
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true }
      ],
      'require-unicode-regexp': 'off'
    }
  }
];
