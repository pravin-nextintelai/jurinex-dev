"""
Repair the chatbot_config row: apply db/migrations/012_pin_gemini_25_flash.sql and
replace placeholder / blank system prompts with the code defaults.

Run from Backend/ai-chatbot:
    python scripts/fix_chatbot_config.py                  # only replaces blank/stub prompts
    python scripts/fix_chatbot_config.py --force-prompts  # overwrite all prompts with code defaults
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.services import chatbot  # noqa: E402

PROMPT_COLUMNS = {
    "system_prompt": chatbot._DEFAULT_SYSTEM_PROMPT,
    "audio_system_prompt": chatbot._DEFAULT_AUDIO_SYSTEM_PROMPT,
    "in_app_system_prompt": chatbot._IN_APP_SYSTEM_PROMPT,
    "in_app_audio_override": chatbot.ChatbotConfig().in_app_audio_override,
}


def _summary(row: dict) -> str:
    parts = [f"model_text={row['model_text']!r}", f"model_audio={row['model_audio']!r}",
             f"max_tokens={row['max_tokens']}"]
    for col in PROMPT_COLUMNS:
        val = row.get(col)
        parts.append(f"{col}={'<null>' if val is None else str(len(val)) + ' chars'}")
    return "  ".join(parts)


def main() -> None:
    settings = get_settings()
    if not settings.database_url:
        sys.exit("DATABASE_URL is not set")

    force_prompts = "--force-prompts" in sys.argv[1:]
    migration = (ROOT / "db" / "migrations" / "012_pin_gemini_25_flash.sql").read_text(encoding="utf-8")

    with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=20) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO chatbot_config (config_key) VALUES ('default') ON CONFLICT (config_key) DO NOTHING")
            cur.execute("SELECT * FROM chatbot_config WHERE config_key = 'default'")
            before = cur.fetchone()
            print("BEFORE:", _summary(before))

            cur.execute(migration)

            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'chatbot_config'"
            )
            existing = {r["column_name"] for r in cur.fetchall()}
            for col, default in PROMPT_COLUMNS.items():
                if col not in existing:
                    continue
                if force_prompts or chatbot._prompt_from_db(before.get(col), default) is default:
                    cur.execute(
                        f"UPDATE chatbot_config SET {col} = %s, updated_at = NOW() WHERE config_key = 'default'",
                        (default,),
                    )
                    print(f"reset {col} -> code default ({len(default)} chars)")

            cur.execute("SELECT * FROM chatbot_config WHERE config_key = 'default'")
            after = cur.fetchone()
        conn.commit()
    print("AFTER: ", _summary(after))


if __name__ == "__main__":
    main()
