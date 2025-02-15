// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            'no-throw-literal': 'warn',
            'no-unused-expressions': 'warn',
            'no-redeclare': 'warn',
            'curly': 'warn',
            'camelcase': 'warn',
            'semi': ['warn', 'always'],
            'eqeqeq': 'warn'
        }
    }
);