/** @type {import('next').NextConfig} */
const nextConfig = {
  // a self-contained server for the Docker image (see Dockerfile)
  output: 'standalone',
  turbopack: {},
  // the Agent SDK starts the bundled Claude Code binary, so it must load from node_modules as-is
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', 'firebase-admin'],
};

export default nextConfig;
