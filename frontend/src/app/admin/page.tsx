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
          Manage markets, users, and view platform statistics.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/review">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Review Markets</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Review and approve or reject user-submitted markets.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/admin-review">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Admin Review</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Resolve escalated disputes and tied community votes.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/stats">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle>Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                View cumulative platform statistics and analytics.
              </p>
            </CardContent>
          </Card>
        </Link>

        {isSuperAdmin && (
          <Link href="/admin/users">
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>Manage Users</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Search users and manage role assignments.
                </p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
