import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

function getSupabaseHostname() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return undefined;

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

const supabaseHostname = getSupabaseHostname();

const nextConfig: NextConfig = {
  // The browser suite's dev server uses its own directory so it can run beside
  // `pnpm dev`, which locks the default one.
  distDir: process.env.NEXT_DIST_DIR || undefined,
  turbopack: {
    root: process.cwd(),
  },
  // Old bookmarks: the resolution queue was renamed from "Admin Review".
  // Redirects run before proxy.ts, so the admin gate still applies.
  async redirects() {
    return [
      {
        source: "/admin/admin-review",
        destination: "/admin/resolve",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      // silicon valley character avatars (seed data)
      {
        protocol: "https",
        hostname: "static.wikia.nocookie.net",
      },
      // google image thumbnails (seed data, e.g. gavin belson)
      {
        protocol: "https",
        hostname: "encrypted-tbn0.gstatic.com",
      },
      ...(supabaseHostname
        ? [
            {
              protocol: "https" as const,
              hostname: supabaseHostname,
            },
          ]
        : []),
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Source-map upload target. Override with SENTRY_ORG / SENTRY_PROJECT when
  // the Sentry slugs differ; uploads also need SENTRY_AUTH_TOKEN at build time.
  org: process.env.SENTRY_ORG ?? "bananagains",
  project: process.env.SENTRY_PROJECT ?? "bananagains-frontend",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
