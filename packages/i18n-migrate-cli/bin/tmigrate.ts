#!/usr/bin/env node
import process from 'node:process'
import { version } from '../package.json'
import { createCli } from '../src/cli'
import { formatErrorWithCauses } from '../src/error-utils'

createCli({ version }).parseAsync().catch((error: unknown) => {
  console.error(formatErrorWithCauses(error))
  process.exitCode = 1
})
