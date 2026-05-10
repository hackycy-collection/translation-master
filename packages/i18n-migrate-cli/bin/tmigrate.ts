#!/usr/bin/env node
import process from 'node:process'
import { version } from '../package.json'
import { createCli } from '../src/cli'

createCli({ version }).parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
