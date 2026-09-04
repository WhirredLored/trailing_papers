/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // Workaround for WasmHash TypeError in Next.js fallback compiler on ARM64 Windows
    config.output.hashFunction = 'sha256'
    return config
  }
}

export default nextConfig
