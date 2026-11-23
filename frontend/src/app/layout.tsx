import type { Metadata } from "next";
import "./globals.css";
import { DailyClaimBanner } from "@/components/daily-claim-banner";
import { Navbar } from "@/components/navbar";
import { RolePreviewBar } from "@/components/role-preview-bar";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { SessionProvider } from "@/lib/SessionProvider";
import { createServerSupabase } from "@/lib/supabase-server";
import type { UserProfile } from "@/lib/types";

export const metadata: Metadata = {
  title: "Pheme | CMU's Prediction Market",
  description: "A campus prediction market for the CMU community",
};

async function getInitialUser(): Promise<UserProfile | null> {
  try {
    const supabase = await createServerSupabase();
    if (!supabase) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return null;

    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await getInitialUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <QueryProvider>
          <SessionProvider initialUser={initialUser}>
            <RolePreviewBar />
            <DailyClaimBanner />
            <Navbar />
            <main className="mx-auto max-w-7xl px-4 pt-6 mb-6">{children}</main>
          </SessionProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
