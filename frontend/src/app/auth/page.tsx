"use client";

import { useEffect, useState } from "react";
import { PhemeMark } from "@/components/pheme-logo";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export default function AuthPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError(err);
  }, []);

  if (!supabase) {
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold">Auth Not Configured</h1>
        <p className="text-muted-foreground">
          Supabase environment variables are missing. The app is running in
          demo-user mode. Set{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
            NEXT_PUBLIC_SUPABASE_URL
          </code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>{" "}
          in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
            .env.local
          </code>{" "}
          to enable authentication.
        </p>
      </div>
    );
  }

  async function handleGoogleSignIn() {
    if (!supabase) return;
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signInError) throw signInError;
    } catch (err: unknown) {
      setError(parseApiError(err, "Something went wrong.").message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="mb-8 text-center">
        <PhemeMark size={40} className="mx-auto" />
        <h1 className="mt-3 text-2xl font-bold">Welcome to Pheme</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with your CMU Google account to start predicting
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          size="lg"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full"
        >
          {loading ? <Spinner /> : "Continue with Google"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Only @andrew.cmu.edu Google accounts are allowed.
        </p>
      </div>
    </div>
  );
}
