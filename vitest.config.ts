import { defineConfig } from 'vitest/config'

// Unit tests of the code the mod and server share, run under Node.
// plugin/test/ is for `claude plugin test`; server/test/ for the Workers pool.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
