BEGIN;

SELECT plan(5);

INSERT INTO public.users (wallet_address, email, cpay_id)
VALUES ('test-cpay-id-wallet-1', 'Alice+tag@example.com', 'client-supplied@cpay000000');

SELECT matches(
  (SELECT cpay_id FROM public.users WHERE wallet_address = 'test-cpay-id-wallet-1'),
  '^alice@cpay[0-9a-f]{16}$',
  'new user IDs use the normalized email handle and a random 64-bit suffix'
);

CREATE TEMP TABLE cpay_id_before_update AS
SELECT cpay_id
FROM public.users
WHERE wallet_address = 'test-cpay-id-wallet-1';

UPDATE public.users
SET email = 'new-address@example.com',
    cpay_id = 'replacement@cpay000000'
WHERE wallet_address = 'test-cpay-id-wallet-1';

SELECT is(
  (SELECT cpay_id FROM public.users WHERE wallet_address = 'test-cpay-id-wallet-1'),
  (SELECT cpay_id FROM cpay_id_before_update),
  'email changes and client attempts cannot change an assigned ID'
);

SELECT isnt(
  public.allocate_cpay_id('alice@example.com'),
  public.allocate_cpay_id('alice@example.com'),
  'new random suffixes are reserved uniquely'
);

SELECT throws_ok(
  $$ UPDATE public.users
     SET wallet_address = 'test-cpay-id-wallet-2'
     WHERE wallet_address = 'test-cpay-id-wallet-1' $$,
  'P0001',
  'A user wallet address cannot be changed',
  'a persisted C-Pay ID cannot be moved to another wallet'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.cpay_id_reservations', 'SELECT, INSERT, UPDATE, DELETE'),
  'clients cannot read or modify ID reservations'
);

SELECT * FROM finish();

ROLLBACK;
