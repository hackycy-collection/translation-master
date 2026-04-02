// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    ignores: [
      'packages/**/*.js',
    ],
    rules: {
      'no-console': 'off',
    },
  },
)
