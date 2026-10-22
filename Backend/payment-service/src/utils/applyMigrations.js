/**
 * Applies pending schema migrations on service startup.
 * Each migration is idempotent (uses IF NOT EXISTS / IF EXISTS guards).
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

/** Load a .sql file from db/migrations so the file stays the single source of truth. */
function sqlFile(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

const MIGRATIONS = [
  {
    name: 'create_monthly_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS monthly_plans (
        id                      SERIAL PRIMARY KEY,
        name                    VARCHAR(100)              NOT NULL,
        description             TEXT,
        price                   NUMERIC(10, 2)            NOT NULL DEFAULT 0,
        currency                VARCHAR(10)               NOT NULL DEFAULT 'INR',
        monthly_tokens          INTEGER                   NOT NULL DEFAULT 0,
        daily_token_limit       INTEGER                   NOT NULL DEFAULT 0,
        is_active               BOOLEAN                   NOT NULL DEFAULT true,
        sort_order              INTEGER                   NOT NULL DEFAULT 0,
        razorpay_plan_id        VARCHAR(100),
        billing_interval_months INTEGER                   NOT NULL DEFAULT 1,
        created_at              TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_monthly_plans_active ON monthly_plans (is_active, sort_order);
    `,
  },
  {
    name: 'create_topup_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS topup_plans (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(100)              NOT NULL,
        description      TEXT,
        price            NUMERIC(10, 2)            NOT NULL DEFAULT 0,
        currency         VARCHAR(10)               NOT NULL DEFAULT 'INR',
        tokens           INTEGER                   NOT NULL DEFAULT 0,
        validity_days    INTEGER                   NOT NULL DEFAULT 30,
        is_active        BOOLEAN                   NOT NULL DEFAULT true,
        sort_order       INTEGER                   NOT NULL DEFAULT 0,
        razorpay_plan_id VARCHAR(100),
        created_at       TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_topup_plans_active ON topup_plans (is_active, sort_order);
    `,
  },
  {
    name: 'create_user_token_topup_purchases_v2',
    sql: `
      CREATE TABLE IF NOT EXISTS user_token_topup_purchases (
        id                   SERIAL PRIMARY KEY,
        user_id              INTEGER               NOT NULL,
        topup_plan_id        INTEGER               NOT NULL,
        tokens_credited      INTEGER               NOT NULL DEFAULT 0,
        razorpay_order_id    VARCHAR(100),
        razorpay_payment_id  VARCHAR(100),
        razorpay_signature   VARCHAR(256),
        amount               NUMERIC(10, 2),
        currency             VARCHAR(10)           DEFAULT 'INR',
        status               VARCHAR(20)           NOT NULL DEFAULT 'pending',
        expires_at           TIMESTAMP WITH TIME ZONE,
        created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_token_topup_user
        ON user_token_topup_purchases (user_id, status, expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_token_topup_payment
        ON user_token_topup_purchases (razorpay_payment_id)
        WHERE razorpay_payment_id IS NOT NULL;
    `,
  },
  {
    name: 'add_monthly_plan_topup_to_user_subscriptions',
    sql: `
      ALTER TABLE user_subscriptions
        ADD COLUMN IF NOT EXISTS monthly_plan_id    INTEGER REFERENCES monthly_plans(id),
        ADD COLUMN IF NOT EXISTS topup_token_balance INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS topup_expires_at   TIMESTAMP WITH TIME ZONE;
      CREATE INDEX IF NOT EXISTS idx_user_subs_monthly_plan
        ON user_subscriptions (monthly_plan_id)
        WHERE monthly_plan_id IS NOT NULL;
    `,
  },
  {
    name: 'make_plan_id_nullable_for_monthly_plans_flow',
    sql: `ALTER TABLE user_subscriptions ALTER COLUMN plan_id DROP NOT NULL;`,
  },
  {
    name: 'ensure_user_subscriptions_unique_user_id',
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_unique
        ON user_subscriptions (user_id);
    `,
  },
  {
    name: 'fix_topup_purchases_fk_to_topup_plans',
    sql: `
      ALTER TABLE user_token_topup_purchases
        DROP CONSTRAINT IF EXISTS user_token_topup_purchases_topup_plan_id_fkey;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'user_token_topup_purchases_topup_plan_id_fkey'
            AND conrelid = 'user_token_topup_purchases'::regclass
        ) THEN
          ALTER TABLE user_token_topup_purchases
            ADD CONSTRAINT user_token_topup_purchases_topup_plan_id_fkey
            FOREIGN KEY (topup_plan_id) REFERENCES topup_plans(id);
        END IF;
      EXCEPTION
        WHEN foreign_key_violation THEN
          RAISE NOTICE 'Skipping topup_plans FK — orphan purchase rows exist';
      END $$;
    `,
  },
  {
    name: 'add_plan_tokens_used_to_subscriptions',
    sql: `
      ALTER TABLE user_subscriptions
        ADD COLUMN IF NOT EXISTS plan_tokens_used INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: 'add_storage_limit_gb_to_monthly_plans',
    sql: `
      ALTER TABLE monthly_plans
        ADD COLUMN IF NOT EXISTS storage_limit_gb NUMERIC(10, 3) NOT NULL DEFAULT 0;
    `,
  },
  {
    name: 'create_user_storage_stats',
    sql: `
      CREATE TABLE IF NOT EXISTS user_storage_stats (
        user_id         VARCHAR(100)              NOT NULL,
        file_count      INTEGER                   NOT NULL DEFAULT 0,
        chat_count      INTEGER                   NOT NULL DEFAULT 0,
        embedding_count INTEGER                   NOT NULL DEFAULT 0,
        files_bytes     BIGINT                    NOT NULL DEFAULT 0,
        chat_bytes      BIGINT                    NOT NULL DEFAULT 0,
        question_bytes  BIGINT                    NOT NULL DEFAULT 0,
        embedding_bytes BIGINT                    NOT NULL DEFAULT 0,
        total_bytes     BIGINT                    NOT NULL DEFAULT 0,
        updated_at      TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT user_storage_stats_pkey PRIMARY KEY (user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_storage_stats_total
        ON user_storage_stats (total_bytes DESC);
    `,
  },
  {
    name: 'drop_storage_addon_plans_use_addon_plans',
    sql: `DROP TABLE IF EXISTS storage_addon_plans;`,
  },
  {
    name: 'create_user_storage_addon_purchases_v2',
    sql: `
      CREATE TABLE IF NOT EXISTS user_storage_addon_purchases (
        id                    SERIAL PRIMARY KEY,
        user_id               INTEGER               NOT NULL,
        addon_plan_id         INTEGER               NOT NULL,
        storage_bytes_granted BIGINT                NOT NULL DEFAULT 0,
        razorpay_order_id     VARCHAR(100),
        razorpay_payment_id   VARCHAR(100),
        razorpay_signature    VARCHAR(256),
        amount                NUMERIC(10, 2),
        currency              VARCHAR(10)           DEFAULT 'INR',
        status                VARCHAR(20)           NOT NULL DEFAULT 'pending',
        expires_at            TIMESTAMP WITH TIME ZONE,
        created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_storage_addon_purchases_user
        ON user_storage_addon_purchases (user_id, status, expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_storage_addon_payment
        ON user_storage_addon_purchases (razorpay_payment_id)
        WHERE razorpay_payment_id IS NOT NULL;

      -- Rename column if the table was created with the old name
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user_storage_addon_purchases'
            AND column_name = 'storage_addon_plan_id'
        ) THEN
          ALTER TABLE user_storage_addon_purchases
            RENAME COLUMN storage_addon_plan_id TO addon_plan_id;
        END IF;
      END $$;
    `,
  },
  {
    name: 'add_extra_storage_bytes_to_user_subscriptions',
    sql: `
      ALTER TABLE user_subscriptions
        ADD COLUMN IF NOT EXISTS extra_storage_bytes BIGINT NOT NULL DEFAULT 0;
    `,
  },
  {
    // payments GST/invoice columns, payment_orders, payment_webhook_events, payment_refunds,
    // app_invoices (+ sequences) and the guarded backfill of existing payment rows.
    name: 'payment_tax_invoice_webhooks_2026_10_15',
    sql: sqlFile('2026-10-15_payment_tax_invoice_webhooks.sql'),
  },
  {
    name: 'invoice_number_sources_2026_10_17',
    sql: sqlFile('2026-10-17_invoice_number_sources.sql'),
  },
];

async function applyMigrations() {
  for (const migration of MIGRATIONS) {
    try {
      await db.query(migration.sql);
      console.log(`[Migration] ✅ ${migration.name}`);
    } catch (err) {
      console.error(`[Migration] ❌ ${migration.name}:`, err.message);
    }
  }
}

module.exports = { applyMigrations };
