\ir governance_fixture.sql
-- Users: 1 creator; 2 active bettor; 3 refunded bettor; 4 admin (creates market 2); 5, 6 neutral.
SELECT place_bet('90000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','YES',10);
SELECT place_bet('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','NO',20);
DELETE FROM bets WHERE user_id='90000000-0000-0000-0000-000000000003'; -- refunded: ledger entry only
UPDATE markets SET status='pending_resolution', proposed_outcome='YES', dispute_deadline=now()+interval '1 day'
WHERE id='91000000-0000-0000-0000-000000000001';

-- Rejections before a case exists leave no case behind.
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Mine')$q$,'creator cannot');
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','   ')$q$,'Explanation must be');
SELECT pg_temp.reject_sql(format('SELECT file_dispute(%L,%L,%L)','91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005',repeat('x',1001)),'Explanation must be');
SELECT pg_temp.check_true((SELECT count(*)=0 FROM disputes WHERE market_id::text LIKE '91000000-%') AND (SELECT count(*)=0 FROM dispute_submissions WHERE market_id::text LIKE '91000000-%'),'rejections create nothing');
-- A client cannot file as another user.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000005"}',true);
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','Spoofed')$q$,'signed-in user');
SELECT set_config('request.jwt.claims','',true);

-- The first submission (an active bettor) opens the case and the voting window.
SELECT pg_temp.check_true((file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','  First concern.  ')->>'opened_case')::boolean,'first submission opens the case');
SELECT pg_temp.check_true((SELECT status='disputed' FROM markets WHERE id='91000000-0000-0000-0000-000000000001'),'market is disputed');
SELECT pg_temp.check_true((SELECT submitter_id='90000000-0000-0000-0000-000000000002' AND explanation='First concern.' FROM dispute_submissions WHERE market_id::text LIKE '91000000-%'),'explanation trimmed and attributed');
CREATE TEMP TABLE case_before AS SELECT id, voting_deadline FROM disputes WHERE market_id='91000000-0000-0000-0000-000000000001';

-- Refunded bettor and neutral user join the same case.
SELECT pg_temp.check_true(NOT (file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003','Second concern.')->>'opened_case')::boolean,'later submission joins the case');
SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000005','Third concern.');
SELECT pg_temp.check_true((SELECT count(*)=1 FROM disputes WHERE market_id::text LIKE '91000000-%') AND (SELECT count(*)=3 FROM dispute_submissions WHERE dispute_id=(SELECT id FROM case_before)),'one case holds every submission');
SELECT pg_temp.check_true((SELECT d.voting_deadline=b.voting_deadline AND d.id=b.id FROM disputes d JOIN case_before b ON b.id=d.id),'additional filings never move the voting deadline');
SELECT pg_temp.check_true((SELECT status='disputed' FROM markets WHERE id='91000000-0000-0000-0000-000000000001'),'market status unchanged by joining');

-- Duplicates and creators are refused while the case is open.
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','Again')$q$,'already submitted');
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Mine')$q$,'creator cannot');
SELECT pg_temp.check_true((SELECT count(*)=3 FROM dispute_submissions WHERE market_id::text LIKE '91000000-%'),'refusals add no submissions');

-- Filing never grants a vote: bettors (active or refunded) stay excluded.
SELECT pg_temp.reject_sql(format('SELECT cast_dispute_vote(%L,%L,%L)',(SELECT id FROM case_before),'90000000-0000-0000-0000-000000000002','YES'),'placed bets cannot');
SELECT pg_temp.reject_sql(format('SELECT cast_dispute_vote(%L,%L,%L)',(SELECT id FROM case_before),'90000000-0000-0000-0000-000000000003','NO'),'placed bets cannot');
SELECT cast_dispute_vote((SELECT id FROM case_before),'90000000-0000-0000-0000-000000000006','NO');

-- Public listing: explanations visible, submitters anonymous, own rows flagged.
SELECT pg_temp.check_true((SELECT (r->>'total')::int=3 AND NOT (r->>'has_submitted')::boolean AND jsonb_array_length(r->'items')=3
  AND NOT (r::text LIKE '%submitter%') AND NOT (r::text LIKE '%90000000-0000-0000-0000-000000000002%')
  FROM (SELECT list_dispute_submissions('91000000-0000-0000-0000-000000000001') r) x),'public list is anonymous');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000003"}',true);
SELECT pg_temp.check_true((SELECT (r->>'has_submitted')::boolean AND (SELECT count(*)=1 FROM jsonb_array_elements(r->'items') i WHERE (i->>'is_mine')::boolean)
  FROM (SELECT list_dispute_submissions('91000000-0000-0000-0000-000000000001') r) x),'caller sees only their own row flagged');
SELECT pg_temp.check_true((SELECT jsonb_array_length(list_dispute_submissions('91000000-0000-0000-0000-000000000001',2,0)->'items')=2
  AND jsonb_array_length(list_dispute_submissions('91000000-0000-0000-0000-000000000001',2,2)->'items')=1),'public list paginates');
-- Admin listing: refused for non-admins, complete with bettor context for admins.
SELECT pg_temp.reject_sql($q$SELECT * FROM admin_dispute_submissions(ARRAY['91000000-0000-0000-0000-000000000001']::uuid[])$q$,'Only admins');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"90000000-0000-0000-0000-000000000004"}',true);
SELECT pg_temp.check_true((SELECT count(*)=3
  AND max(bettor_context) FILTER (WHERE submitter_id='90000000-0000-0000-0000-000000000002')='active'
  AND max(bettor_context) FILTER (WHERE submitter_id='90000000-0000-0000-0000-000000000003')='refunded'
  AND max(bettor_context) FILTER (WHERE submitter_id='90000000-0000-0000-0000-000000000005')='none'
  AND max(andrew_id) FILTER (WHERE submitter_id='90000000-0000-0000-0000-000000000005') IS NOT NULL
  FROM admin_dispute_submissions(ARRAY['91000000-0000-0000-0000-000000000001']::uuid[])),'admins see submitters and bettor context');
SELECT set_config('request.jwt.claims','',true);
-- The table itself is closed to API roles; the admin function is closed to anon.
SELECT pg_temp.check_true(NOT has_table_privilege('authenticated','public.dispute_submissions','SELECT')
  AND NOT has_table_privilege('anon','public.dispute_submissions','SELECT')
  AND NOT has_table_privilege('authenticated','public.dispute_submissions','INSERT')
  AND NOT has_table_privilege('authenticated','public.disputes','INSERT')
  AND NOT has_table_privilege('anon','public.disputes','INSERT'),'cases and submissions are not directly writable');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public.admin_dispute_submissions(uuid[])','EXECUTE')
  AND has_function_privilege('anon','public.list_dispute_submissions(uuid,integer,integer)','EXECUTE'),'function grants match the visibility policy');

-- The submission window ends with the voting deadline and joins only an open case.
UPDATE disputes SET voting_deadline=now()-interval '1 second' WHERE market_id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004','Late')$q$,'submission window has expired');
UPDATE markets SET status='admin_review' WHERE id='91000000-0000-0000-0000-000000000001';
SELECT pg_temp.reject_sql($q$SELECT file_dispute('91000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004','Escalated')$q$,'pending_resolution or disputed');
SELECT pg_temp.check_true((SELECT count(*)=3 FROM dispute_submissions WHERE market_id::text LIKE '91000000-%'),'closed windows add no submissions');
ROLLBACK;
