const PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * While true there is no sign-in: every visitor is an anonymous guest, and can switch to
 * "admin mode" with one click. Development only, with AUTH_DISABLED=true: a production
 * build always asks people to sign in, whatever the environment says.
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true' && !PRODUCTION;

/**
 * The AI assistant in the editor. In development it runs on the Claude Code login of this
 * machine; set ANTHROPIC_API_KEY to bill the API instead. That login is not for production,
 * so a production build without a key hides the assistant. AGENT_ENABLED=false always hides it.
 */
export const AGENT_ENABLED = process.env.AGENT_ENABLED !== 'false' && (!PRODUCTION || !!process.env.ANTHROPIC_API_KEY);
