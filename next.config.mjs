/** @type {import('next').NextConfig} */
const nextConfig = {
  // a self-contained server for the Docker image (see Dockerfile)
  output: 'standalone',
  turbopack: {},
  // lets phones on the home network use the dev server (http://<this PC's LAN IP>:3100)
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  // the Agent SDK starts the bundled Claude Code binary, so it must load from node_modules as-is
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', 'firebase-admin', '@hebcal/core'],
};

export default nextConfig;
