/**
 * While true there is no sign-in: every visitor is an anonymous guest, and can switch to
 * "admin mode" with one click. Set the environment variable AUTH_DISABLED=false to bring
 * back registration and login (all of that code is still in place).
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED !== 'false';

/**
 * The AI assistant in the editor. In development it runs on the Claude Code login of this
 * machine; set ANTHROPIC_API_KEY to bill the API instead. AGENT_ENABLED=false hides it.
 */
export const AGENT_ENABLED = process.env.AGENT_ENABLED !== 'false';
