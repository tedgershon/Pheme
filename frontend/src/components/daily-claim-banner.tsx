"use client";

import Link from "next/link";
import { useState } from "react";
import { TartanCoin } from "@/components/tartan-coin";
import { useMe } from "@/lib/query/queries/auth";
import { useSession } from "@/lib/SessionProvider";

export function DailyClaimBanner() {
  const { isDemo, isLoading } = useSession();
  const { user } = useMe();
  const [dismissed, setDismissed] = useState(false);

  if (
    isLoading ||
    isDemo ||
    user.claimed_today ||
    dismissed ||
    !user.claim_eligible ||
    user.claim_amount <= 0
  ) {
    return null;
  }

  const claimMessage =
    user.claim_amount === 1000
      ? "Your daily 1,000 Tartan Coins are ready to claim!"
      : "Your daily Tartan Coins are ready to claim!";

  return (
    <div className="bg-primary/10 border-b border-primary/20">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2">
        <Link
          href="/portfolio"
          className="flex items-center gap-2 text-sm hover:underline"
        >
          <TartanCoin size={18} />
          <span className="font-medium">{claimMessage}</span>
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-muted-foreground hover:text-foreground text-sm px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
