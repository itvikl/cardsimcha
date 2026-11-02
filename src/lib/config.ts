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

/**
 * Billing is off until BILLING_PROVIDER names a provider (see billing.ts): downloads stay free and prices are only shown.
 * The sandbox provider takes no money, so a production build refuses it; BILLING_ALLOW_SANDBOX is for testing a local build.
 */
export const BILLING_PROVIDER = process.env.BILLING_PROVIDER ?? '';
export const BILLING_ENABLED = !!BILLING_PROVIDER && (BILLING_PROVIDER !== 'sandbox' || !PRODUCTION || process.env.BILLING_ALLOW_SANDBOX === 'true');
/** the monthly plan, in shekels; a starting guess to test with the first businesses */
export const SUBSCRIPTION_PRICE = Number(process.env.SUBSCRIPTION_PRICE) || 149;
