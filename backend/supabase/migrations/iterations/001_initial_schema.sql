-- 001_initial_schema.sql
-- Creates all core tables for Pheme

-- profiles: linked to Supabase auth.users via id
CREATE TABLE profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    andrew_id   TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    banana_balance NUMERIC NOT NULL DEFAULT 1000,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_andrew_id ON profiles (andrew_id);

-- markets
CREATE TABLE markets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    creator_id          UUID NOT NULL REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    close_at            TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closed', 'resolved', 'disputed')),
    resolution_criteria TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'General',
    yes_pool_total      NUMERIC NOT NULL DEFAULT 0,
    no_pool_total       NUMERIC NOT NULL DEFAULT 0,
    resolved_outcome    TEXT CHECK (resolved_outcome IN ('YES', 'NO')),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_markets_status ON markets (status);
CREATE INDEX idx_markets_creator_id ON markets (creator_id);
CREATE INDEX idx_markets_close_at ON markets (close_at);

-- bets
CREATE TABLE bets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id),
    market_id   UUID NOT NULL REFERENCES markets(id),
    side        TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
    amount      NUMERIC NOT NULL CHECK (amount > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bets_user_id ON bets (user_id);
CREATE INDEX idx_bets_market_id ON bets (market_id);

-- resolution_votes
CREATE TABLE resolution_votes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id         UUID NOT NULL REFERENCES markets(id),
    voter_id          UUID NOT NULL REFERENCES profiles(id),
    selected_outcome  TEXT NOT NULL CHECK (selected_outcome IN ('YES', 'NO')),
    staked_amount     NUMERIC NOT NULL CHECK (staked_amount > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (market_id, voter_id)
);

CREATE INDEX idx_resolution_votes_market_id ON resolution_votes (market_id);

-- transactions: append-only audit log
CREATE TABLE transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES profiles(id),
    market_id         UUID REFERENCES markets(id),
    transaction_type  TEXT NOT NULL
                      CHECK (transaction_type IN (
                          'initial_grant', 'bet_placement', 'payout',
                          'voter_stake', 'voter_reward'
                      )),
    amount            NUMERIC NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user_id ON transactions (user_id);
CREATE INDEX idx_transactions_market_id ON transactions (market_id);

-- Trigger: auto-create a profile row when a new user signs up via Supabase Auth.
-- search_path must be set and table names must be schema-qualified per Supabase docs.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, andrew_id, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'andrew_id', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    );
    INSERT INTO public.transactions (user_id, transaction_type, amount)
    VALUES (NEW.id, 'initial_grant', 1000);
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, users can update their own
CREATE POLICY "Profiles are viewable by everyone"
    ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE USING (auth.uid() = id);

-- Markets: anyone can read, authenticated users can create
CREATE POLICY "Markets are viewable by everyone"
    ON markets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create markets"
    ON markets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creators can update own markets"
    ON markets FOR UPDATE USING (auth.uid() = creator_id);

-- Bets: anyone can read, authenticated users can create their own
CREATE POLICY "Bets are viewable by everyone"
    ON bets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can place bets"
    ON bets FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Resolution votes: anyone can read, authenticated users can create their own
CREATE POLICY "Resolution votes are viewable by everyone"
    ON resolution_votes FOR SELECT USING (true);
CREATE POLICY "Authenticated users can vote"
    ON resolution_votes FOR INSERT WITH CHECK (auth.uid() = voter_id);

-- Transactions: users can read their own
CREATE POLICY "Users can view own transactions"
    ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert transactions"
    ON transactions FOR INSERT WITH CHECK (true);
