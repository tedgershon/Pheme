import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query/client";
import { hotMarketsQuery, marketsQuery } from "@/lib/query/queries/markets";
import HomeClient from "./home-client";

// Prefetch the shared market list so / and /markets can reuse the same
// TanStack Query cache during client-side navigation. The hot-market ranking
// picks the featured market; prefetching it keeps the hero from swapping
// markets after hydration.
export default async function HomePage() {
  const queryClient = getQueryClient();
  await Promise.allSettled([
    queryClient.prefetchQuery(marketsQuery()),
    queryClient.prefetchQuery(hotMarketsQuery()),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomeClient />
    </HydrationBoundary>
  );
}
