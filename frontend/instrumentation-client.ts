// Browser Sentry setup. Next.js loads this file in the browser; Turbopack
// (the default bundler) ignores the older sentry.client.config.ts name.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  // strip andrew_id off event.user — only the Supabase UUID is allowed to
  // leave the browser (see docs/OBSERVABILITY.md).
  beforeSend(event) {
    if (event.user && "andrew_id" in event.user) {
      const { andrew_id: _omit, ...rest } = event.user as Record<
        string,
        unknown
      >;
      event.user = rest;
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
