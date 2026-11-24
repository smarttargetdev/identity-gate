/**
 * File: eslint.config.mjs
 * Kind: JavaScript (ES Module)
 * Container: /
 * Summary: Configuração ESLint com plugin oficial de segurança para validação das regras Firestore.
 * Version: 1.0.0
 * Created: 2026-11-24
 * Modified: 2026-11-24
 * Developer: Osvandir Júnior
 */

import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
