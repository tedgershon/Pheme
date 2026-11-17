-- Proposed/denied content is private even when queried directly via PostgREST.
DROP POLICY "Markets are viewable by everyone" ON public.markets;
CREATE POLICY "Markets visible to public or creator or admin"
    ON public.markets FOR SELECT USING (
        status NOT IN ('pending_review', 'denied')
        OR creator_id = (SELECT auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'super_admin')
        )
    );

-- Option labels can disclose the proposal, so inherit the parent visibility.
DROP POLICY "Market options are viewable by everyone" ON public.market_options;
CREATE POLICY "Market options follow market visibility"
    ON public.market_options FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.markets WHERE id = market_options.market_id)
    );
