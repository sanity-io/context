import config from '@repo/eslint-config'

export default [
  ...config,
  {ignores: ['captures/']},
  // A CLI: printing is its output.
  {rules: {'no-console': 'off'}},
]
