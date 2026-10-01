
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Read the local Sentry token without exposing it
  // to the browser or committing it to Git.
  const sentryEnvPath = resolve(
    process.cwd(),
    '.env.sentry-build-plugin'
  )

  let localSentryToken = ''

  if (existsSync(sentryEnvPath)) {
    const content = readFileSync(sentryEnvPath, 'utf8')

    const match = content.match(
      /^SENTRY_AUTH_TOKEN\s*=\s*["']?(.+?)["']?\s*$/m
    )

    localSentryToken = match?.[1] || ''
  }

  // Vercel environment variable takes priority.
  const sentryAuthToken =
    process.env.SENTRY_AUTH_TOKEN ||
    localSentryToken

  return {
    plugins: [
      react(),

      ...(sentryAuthToken
        ? [
            sentryVitePlugin({
              org: 'b2p-internationa',
              project: 'javascript-react',
              authToken: sentryAuthToken,
              telemetry: false
            })
          ]
        : [])
    ],

    base: '/billing/',

    build: {
      outDir: 'dist/billing',
      sourcemap: true
    },

    define: {
      'process.env.SUPABASE_URL': JSON.stringify(
        env.SUPABASE_URL || ''
      ),

      'process.env.SUPABASE_ANON_KEY': JSON.stringify(
        env.SUPABASE_ANON_KEY || ''
      )
    }
  }
})
