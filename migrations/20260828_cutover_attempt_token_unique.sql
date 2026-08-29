-- replit-migration-mode: psql-on-error-stop
-- Rental-request token uniqueness is deliberately deployed outside startup.
-- Run with a migration tool that does NOT wrap this file in a transaction:
-- CREATE INDEX CONCURRENTLY is prohibited inside transaction blocks.
--
-- This artifact makes no data changes. Any duplicate is an operator decision:
-- a duplicate may be the source of an in-flight or ambiguous external booking.
--
-- A failed CREATE INDEX CONCURRENTLY can leave an invalid index with the target
-- name. Remove only that invalid remnant so IF NOT EXISTS cannot false-green a
-- retry. \gexec is psql-specific, which is why this file opts into the psql
-- migration mode above.
SELECT format('DROP INDEX CONCURRENTLY %I.%I', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname = 'vrm_rental_request_token_uniq'
  AND n.nspname = current_schema()
  AND i.indisvalid = false
\gexec

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vrm_rental_request
    WHERE token_id IS NOT NULL
    GROUP BY token_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create vrm_rental_request_token_uniq: duplicate token-backed rental requests exist. Review booking evidence manually; do not delete sources during startup.';
  END IF;
END $$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vrm_rental_request_token_uniq
  ON vrm_rental_request (token_id)
  WHERE token_id IS NOT NULL;