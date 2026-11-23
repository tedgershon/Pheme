-- Representative persisted data, created using the historical engine.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('50000000-0000-0000-0000-000000000001', 'legacycreator@andrew.cmu.edu', now()),
    ('50000000-0000-0000-0000-000000000002', 'legacybettor@andrew.cmu.edu', now());
UPDATE profiles SET role = 'super_admin', avatar_url = 'https://example.com/existing.png'
WHERE id = '50000000-0000-0000-0000-000000000001';
UPDATE profiles SET equipped_badge_id = (SELECT id FROM badge_definitions WHERE track = 'oracle' AND tier = 1),
    equipped_badges = jsonb_build_object('oracle', (SELECT id::text FROM badge_definitions WHERE track = 'oracle' AND tier = 1))
WHERE id = '50000000-0000-0000-0000-000000000002';
INSERT INTO markets (id, title, description, creator_id, close_at, resolution_criteria, status)
VALUES ('60000000-0000-0000-0000-000000000001', 'Existing market', 'Preserve me',
    '50000000-0000-0000-0000-000000000001', now() + interval '1 day', 'Fixture', 'open');
SELECT place_bet('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'YES', 100);
SELECT claim_daily_bananas('50000000-0000-0000-0000-000000000002');
-- A previously earned balance badge stays equipped even after the balance falls.
INSERT INTO user_badges (user_id, badge_id, track, tier)
SELECT '50000000-0000-0000-0000-000000000002', id, track, tier
FROM badge_definitions WHERE track = 'banana_baron' AND tier = 2;
UPDATE profiles SET equipped_badge_id = b.id,
    equipped_badges = equipped_badges || jsonb_build_object(b.track, b.id)
FROM badge_definitions b
WHERE profiles.id = '50000000-0000-0000-0000-000000000002' AND b.track = 'banana_baron' AND b.tier = 2;
INSERT INTO notifications (user_id, type, title, body, metadata) VALUES
    ('50000000-0000-0000-0000-000000000002', 'market_approved', 'Existing', 'Preserve me',
    '{"market_id": "60000000-0000-0000-0000-000000000001"}');
-- A dispute filed before submissions existed; its untrimmed explanation must be preserved.
INSERT INTO markets (id, title, description, creator_id, close_at, resolution_criteria, status)
VALUES ('60000000-0000-0000-0000-000000000002', 'Existing dispute', 'Preserve me',
    '50000000-0000-0000-0000-000000000001', now() + interval '1 day', 'Fixture', 'disputed');
INSERT INTO disputes (id, market_id, disputer_id, explanation, voting_deadline, created_at)
VALUES ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000002', '  Legacy concern.  ', now() + interval '1 day', now() - interval '1 hour');
