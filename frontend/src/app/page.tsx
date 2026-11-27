import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query/client";
import { marketsQuery } from "@/lib/query/queries/markets";
import HomeClient from "./home-client";

// Prefetch the shared market list so / and /markets can reuse the same
// TanStack Query cache during client-side navigation.
export default async function HomePage() {
  const queryClient = getQueryClient();
  await Promise.allSettled([queryClient.prefetchQuery(marketsQuery())]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomeClient />
    </HydrationBoundary>
  );
}
