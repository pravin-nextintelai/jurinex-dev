"""Case isolation against a real database.

Opt-in, because it writes to whichever database the service is configured for.
It never runs in a normal test pass. To run it:

    set MEMORY_DB_TESTS=1
    .venv\\Scripts\\python.exe -m unittest tests.test_memory_isolation_db

Every row it writes sits under a random test-* or temp-* case key and is purged
in tearDown, including when a test fails.
"""
from __future__ import annotations

import os
import unittest
import uuid

from app.services.db import get_db_connection, is_db_available
from app.services.memory import repository
from app.services.memory.schemas import SETTINGS_FLAGS

ENABLED = os.getenv("MEMORY_DB_TESTS") == "1"


@unittest.skipUnless(ENABLED, "set MEMORY_DB_TESTS=1 to run the database isolation tests")
class CaseIsolationDbTests(unittest.TestCase):
    def setUp(self) -> None:
        if not is_db_available():
            self.skipTest("DATABASE_URL is not configured for this service")
        tag = uuid.uuid4().hex[:10]
        self.key_a = f"test-iso-a-{tag}"
        self.key_b = f"test-iso-b-{tag}"
        self.temp = f"temp-iso-{tag}"
        self.rebound = f"test-iso-r-{tag}"
        self.token_a = f"ALPHA{tag}"
        self.token_b = f"BRAVO{tag}"
        self.addCleanup(self._purge)

        for key, token in ((self.key_a, self.token_a), (self.key_b, self.token_b)):
            repository.append_lines(
                key, "facts", [{"tag": "stated", "text": f"Fact {token}", "source_ref": {"kind": "test"}}], actor="test"
            )
            repository.put_instructions(key, f"Instruction {token}", None, updated_by="test")
            repository.add_proposal(key, "0", "instruction", f"Proposal {token}", {"kind": "test"})
            repository.write_assembly_log({"case_key": key, "user_id": "0", "mode": f"test {token}"})
            repository.put_settings("case", key, {flag: True for flag in SETTINGS_FLAGS}, updated_by=f"test {token}")

    def _purge(self) -> None:
        with get_db_connection() as conn, conn.cursor() as cur:
            repository.purge_case_keys(cur, [self.key_a, self.key_b, self.temp, self.rebound])
            conn.commit()

    def _everything_for(self, key: str) -> str:
        return "\n".join(
            [
                repr(repository.get_sections(key)),
                repr(repository.get_instructions(key)),
                repr(repository.list_proposals(key, None)),
                repr(repository.list_assembly_log(key, 50)),
                repr(repository.get_settings("case", key)),
            ]
        )

    def test_reads_for_one_case_never_contain_another(self) -> None:
        case_a = self._everything_for(self.key_a)
        case_b = self._everything_for(self.key_b)
        self.assertIn(self.token_a, case_a)
        self.assertNotIn(self.token_b, case_a)
        self.assertIn(self.token_b, case_b)
        self.assertNotIn(self.token_a, case_b)

    def test_purging_one_case_leaves_the_other_intact(self) -> None:
        with get_db_connection() as conn, conn.cursor() as cur:
            repository.purge_case_keys(cur, [self.key_a])
            conn.commit()
        self.assertNotIn(self.token_a, self._everything_for(self.key_a))
        self.assertIn(self.token_b, self._everything_for(self.key_b))

    def test_rebinding_moves_intake_memory_onto_the_real_case(self) -> None:
        token = f"TEMP{uuid.uuid4().hex[:8]}"
        repository.append_lines(
            self.temp, "facts", [{"tag": "stated", "text": f"Intake {token}", "source_ref": {}}], actor="test"
        )
        repository.rebind_case_key(self.temp, self.rebound, "Test_Folder")
        self.assertIsNone(repository.get_section(self.temp, "facts"))
        self.assertIn(token, repr(repository.get_section(self.rebound, "facts")))


if __name__ == "__main__":
    unittest.main()
