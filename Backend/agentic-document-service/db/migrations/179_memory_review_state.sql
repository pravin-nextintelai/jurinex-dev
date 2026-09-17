-- 179: How far each chat has been reviewed as a whole.
--
-- Every few turns, and when the advocate comes back to a case after a break, the turns
-- since the last review are read together (app/services/memory/synthesis.py): the case
-- summary's Stage, Last action and Open items are kept current, decisions reached over
-- several messages are recorded, and ways of working the advocate keeps asking for are
-- suggested. This table records where each chat's last review stopped, so the same turns
-- are never reviewed twice and a chat left with unreviewed turns can be found later.
--
--   reviewed_until  created_at of the last turn a review covered
--   reviewed_turns  turns covered so far
--   reviews         reviews run
--
-- Keyed by case, advocate and chat. Purged with the case. Also created on first use by
-- app/services/memory/repository.py.

CREATE TABLE IF NOT EXISTS memory_review_state (
    case_key        TEXT        NOT NULL,
    user_id         TEXT        NOT NULL,
    session_id      TEXT        NOT NULL,
    reviewed_until  TIMESTAMPTZ,
    reviewed_turns  INTEGER     NOT NULL DEFAULT 0,
    reviews         INTEGER     NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_key, user_id, session_id)
);

COMMENT ON TABLE memory_review_state IS
    'Where each chat''s last whole-conversation memory review stopped (app/services/memory/synthesis.py).';
