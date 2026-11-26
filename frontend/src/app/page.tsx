import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query/client";
import { marketsQuery } from "@/lib/query/queries/markets";
import MarketsClient from "./markets/markets-client";

export default async function HomePage() {
  const qc = getQueryClient();
  await Promise.allSettled([qc.prefetchQuery(marketsQuery())]);
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <MarketsClient />
    </HydrationBoundary>
  );
}
