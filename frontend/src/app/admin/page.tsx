"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/lib/query/queries/auth";

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading } = useMe();

  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isSuperAdmin = user.role === "super_admin";

  useEffect(() => {
    if (!isLoading && user.role === "user") {
      router.replace("/");
    }
  }, [isLoading, user.role, router]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Approve markets, follow disputes, make final calls and manage users.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* ordered the way a market moves: approve, watch disputes, resolve */}
        <Link href="/admin/review">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Approve New Markets</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Approve, edit or deny markets users have submitted. Also lists
                every market already approved or denied.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/disputes">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Monitor Disputes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View-only. Read the concerns filed against proposed outcomes and
                follow each dispute vote.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/resolve">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Resolve Markets</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Make the final YES, NO or Ambiguous call on markets whose vote
                ended without a result.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/stats">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Platform Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Totals for users, markets by status, bananas traded and active
                bets.
              </p>
            </CardContent>
          </Card>
        </Link>

        {isSuperAdmin && (
          <Link href="/admin/users">
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Manage User Roles</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Search users by Andrew ID and change their roles.
                </p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
