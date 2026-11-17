"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { parseApiError } from "@/lib/api";
import { useUpdateUserRole } from "@/lib/query/mutations/admin";
import { searchUsersQuery } from "@/lib/query/queries/admin";
import { useMe } from "@/lib/query/queries/auth";

export default function AdminUsersPage() {
  const router = useRouter();
  const { user } = useMe();
  const [input, setInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // enabled only when a query has been submitted so typing doesn't fetch
  const { data: results = [], isFetching } = useQuery(
    searchUsersQuery(submittedQuery),
  );
  const updateRole = useUpdateUserRole();

  useEffect(() => {
    if (user.role !== "super_admin") {
      router.replace("/admin");
    }
  }, [user.role, router]);

  if (user.role !== "super_admin") return null;

  function handleSearch() {
    const q = input.trim();
    if (!q) return;
    setMessage(null);
    setSubmittedQuery(q);
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setMessage(null);
    try {
      const updated = await updateRole.mutateAsync({ userId, role: newRole });
      setMessage(`Role updated to ${updated.role} successfully.`);
    } catch (err) {
      setMessage(parseApiError(err, "Failed to update role.").message);
    }
  }

  const searched = submittedQuery.length > 0 && !isFetching;

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Manage Users</h1>
        <p className="text-sm text-muted-foreground">
          Search users by Andrew ID and manage their roles.
        </p>
      </section>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="Search by Andrew ID..."
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <Button onClick={handleSearch} disabled={isFetching || !input.trim()}>
          {isFetching ? <Spinner /> : "Search"}
        </Button>
      </div>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No user found with that Andrew ID.
        </p>
      )}

      {results.length > 0 && (
        <Card size="sm" className="!gap-0 !py-0">
          <CardContent className="!p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Andrew ID</th>
                  <th className="px-4 py-2 font-medium">Display Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((u) => {
                  const pending =
                    updateRole.isPending &&
                    updateRole.variables?.userId === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-mono text-xs">
                        {u.andrew_id}
                      </td>
                      <td className="px-4 py-2">{u.display_name}</td>
                      <td className="px-4 py-2 capitalize">
                        {u.role.replace("_", " ")}
                      </td>
                      <td className="px-4 py-2">
                        {u.role === "super_admin" ? (
                          <span className="text-xs text-muted-foreground">
                            Super Admin
                          </span>
                        ) : u.role === "user" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => handleRoleChange(u.id, "admin")}
                          >
                            {pending ? <Spinner /> : "Promote to Admin"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => handleRoleChange(u.id, "user")}
                          >
                            {pending ? <Spinner /> : "Demote to User"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
