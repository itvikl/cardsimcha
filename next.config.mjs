/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  // the Agent SDK starts the bundled Claude Code binary, so it must load from node_modules as-is
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
};

export default nextConfig;
