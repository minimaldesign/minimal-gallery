#!/usr/bin/env node
import { Exit, main } from './cli.ts';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Exit) {
    if (e.message) console.error(e.message);
    process.exitCode = e.code;
  } else {
    console.error(`Error: ${(e as Error).message}`);
    if (process.env.MG_DEBUG) console.error((e as Error).stack);
    process.exitCode = 1;
  }
}
