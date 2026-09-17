import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Two Yjs copies in one bundle is the classic way to break a CRDT app: the
 * types from copy A fail `instanceof` checks in copy B and updates silently
 * stop applying. The alias pins every import to a single resolved module.
 */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      yjs$: require.resolve('yjs'),
    }
    return config
  },
}

export default nextConfig
