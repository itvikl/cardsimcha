/**
 * While true there is no sign-in: every visitor is an anonymous guest, and can switch to
 * "admin mode" with one click. Set the environment variable AUTH_DISABLED=false to bring
 * back registration and login (all of that code is still in place).
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED !== 'false';
