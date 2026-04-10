CREATE TABLE IF NOT EXISTS offboarding_return_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) NOT NULL UNIQUE,
  queue_item_id VARCHAR NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS offboarding_return_tokens_token_idx ON offboarding_return_tokens (token);
CREATE INDEX IF NOT EXISTS offboarding_return_tokens_queue_item_id_idx ON offboarding_return_tokens (queue_item_id);
