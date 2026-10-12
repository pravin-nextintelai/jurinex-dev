-- Sales Referrals: referral attribution for SOLO self-signups (users without a firm).
-- tenant_referrals (admin-owned) can only reference firms(id), so solo lawyers need their own row.
-- Same shape as tenant_referrals, keyed on users.id. code_id NULL = Direct signup.
CREATE TABLE IF NOT EXISTS user_referrals (
  user_id      integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_id      uuid NULL REFERENCES referral_codes(id),
  source       varchar(10) NOT NULL DEFAULT 'SIGNUP' CHECK (source IN ('SIGNUP', 'ADMIN')),
  signed_up_at timestamptz NOT NULL DEFAULT now(),
  set_by       integer NULL,
  set_at       timestamptz NULL,
  reason       varchar(500) NULL
);

CREATE INDEX IF NOT EXISTS idx_user_referrals_code_id ON user_referrals (code_id);
