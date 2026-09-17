"""Repairing fragmented chunks in the background, once each, so retrieval never waits for it."""
from __future__ import annotations

import time
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import chunk_autoheal as heal_mod
from app.services.chunk_autoheal import Target

FRAGMENTED = "frag: Ltd . p .a . 18 % 202 5"
CLEAN = "A clean paragraph of legal prose."
ID0, ID1, ID2 = (str(uuid.UUID(int=n + 1)) for n in range(3))


def looks_fragmented(text: str) -> bool:
    return text.startswith("frag:")


def rows(*contents: str, ids=True):
    return [
        {"chunk_id": str(uuid.UUID(int=n + 1)) if ids else None, "content": content}
        for n, content in enumerate(contents)
    ]


def fake_connection(cur):
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cur
    return conn


class Case(unittest.TestCase):
    def setUp(self) -> None:
        heal_mod._in_flight.clear()
        heal_mod._healed_in_process.clear()
        saved_column = heal_mod._healed_column
        self.addCleanup(heal_mod._in_flight.clear)
        self.addCleanup(heal_mod._healed_in_process.clear)
        self.addCleanup(setattr, heal_mod, "_healed_column", saved_column)
        self.mocks = {}
        for target, kwargs in (
            ("_looks_fragmented", {"side_effect": looks_fragmented}),
            ("get_settings", {"return_value": SimpleNamespace(chunk_autoheal_enabled=True)}),
        ):
            patcher = patch.object(heal_mod, target, **kwargs)
            self.mocks[target] = patcher.start()
            self.addCleanup(patcher.stop)


class ScheduleTests(Case):
    def submit(self):
        """Capture what would run in the background instead of running it."""
        executor = MagicMock()
        executor.submit.side_effect = lambda fn, targets: SimpleNamespace(fn=fn, targets=targets)
        return patch.object(heal_mod, "_EXECUTOR", executor), executor

    def test_only_fragmented_saved_chunks_are_queued(self) -> None:
        patcher, executor = self.submit()
        with patcher:
            job = heal_mod.schedule(rows(FRAGMENTED, CLEAN, "frag: another one"))
        self.assertEqual([t.chunk_id for t in job.targets], [ID0, ID2])
        executor.submit.assert_called_once()

    def test_the_callers_rows_are_never_changed(self) -> None:
        retrieved = rows(FRAGMENTED, CLEAN)
        before = [dict(row) for row in retrieved]
        patcher, _ = self.submit()
        with patcher:
            heal_mod.schedule(retrieved)
        self.assertEqual(retrieved, before)

    def test_nothing_fragmented_queues_nothing(self) -> None:
        patcher, executor = self.submit()
        with patcher:
            self.assertIsNone(heal_mod.schedule(rows(CLEAN, CLEAN)))
        executor.submit.assert_not_called()

    def test_a_chunk_without_an_id_cannot_be_saved_so_is_not_queued(self) -> None:
        patcher, executor = self.submit()
        with patcher:
            self.assertIsNone(heal_mod.schedule(rows(FRAGMENTED, ids=False)))
        executor.submit.assert_not_called()

    def test_a_chunk_already_being_repaired_is_not_queued_twice(self) -> None:
        patcher, executor = self.submit()
        with patcher:
            heal_mod.schedule(rows(FRAGMENTED))
            self.assertIsNone(heal_mod.schedule(rows(FRAGMENTED)))
        self.assertEqual(executor.submit.call_count, 1)

    def test_a_chunk_repaired_earlier_in_this_process_is_not_queued(self) -> None:
        heal_mod._remember_in_process([ID0])
        patcher, executor = self.submit()
        with patcher:
            self.assertIsNone(heal_mod.schedule(rows(FRAGMENTED)))
        executor.submit.assert_not_called()

    def test_one_retrieval_queues_a_bounded_number(self) -> None:
        many = rows(*[f"frag: chunk {n}" for n in range(20)])
        patcher, _ = self.submit()
        with patcher:
            job = heal_mod.schedule(many)
        self.assertEqual(len(job.targets), heal_mod.MAX_CHUNKS_PER_RETRIEVAL)

    def test_switched_off_queues_nothing(self) -> None:
        self.mocks["get_settings"].return_value = SimpleNamespace(chunk_autoheal_enabled=False)
        patcher, executor = self.submit()
        with patcher:
            self.assertIsNone(heal_mod.schedule(rows(FRAGMENTED)))
        executor.submit.assert_not_called()

    def test_a_queue_failure_releases_the_chunks_and_never_raises(self) -> None:
        executor = MagicMock()
        executor.submit.side_effect = RuntimeError("shutting down")
        with patch.object(heal_mod, "_EXECUTOR", executor):
            self.assertIsNone(heal_mod.schedule(rows(FRAGMENTED)))
        self.assertEqual(heal_mod._in_flight, set())


class HealTests(Case):
    TARGETS = [Target(ID0, FRAGMENTED), Target(ID1, "frag: second")]

    def setUp(self) -> None:
        super().setUp()
        for target, kwargs in (
            ("unhealed", {"side_effect": lambda targets: list(targets)}),
            ("mark_healed", {"return_value": 0}),
        ):
            patcher = patch.object(heal_mod, target, **kwargs)
            self.mocks[target] = patcher.start()
            self.addCleanup(patcher.stop)

    def test_repaired_text_is_saved(self) -> None:
        save = MagicMock(return_value=True)
        report = heal_mod.heal(self.TARGETS, reconstruct=str.upper, save=save)
        self.assertEqual((report.repaired, report.saved), (2, 2))
        self.assertEqual(save.call_args_list[0].args, (self.TARGETS[0], FRAGMENTED.upper()))

    def test_a_chunk_already_repaired_never_reaches_the_model(self) -> None:
        self.mocks["unhealed"].side_effect = lambda targets: [targets[1]]
        rebuild = MagicMock(side_effect=str.upper)
        report = heal_mod.heal(self.TARGETS, reconstruct=rebuild, save=MagicMock(return_value=True))
        rebuild.assert_called_once_with("frag: second")
        self.assertEqual((report.already_healed, report.saved), (1, 1))

    def test_a_false_alarm_is_marked_so_it_is_not_paid_for_again(self) -> None:
        save = MagicMock()
        report = heal_mod.heal(self.TARGETS, reconstruct=lambda text: text, save=save)
        self.assertEqual(report.unchanged, 2)
        save.assert_not_called()
        self.mocks["mark_healed"].assert_called_once_with([ID0, ID1])

    def test_a_failed_repair_is_left_unmarked_to_try_again(self) -> None:
        def rebuild(text: str) -> str:
            raise RuntimeError("quota")

        report = heal_mod.heal(self.TARGETS, reconstruct=rebuild, save=MagicMock())
        self.assertEqual(report.failed, 2)
        self.mocks["mark_healed"].assert_not_called()

    def test_a_chunk_changed_meanwhile_is_left_alone(self) -> None:
        report = heal_mod.heal(self.TARGETS, reconstruct=str.upper, save=MagicMock(return_value=False))
        self.assertEqual((report.saved, report.skipped_stale), (0, 2))

    def test_one_failure_does_not_stop_the_rest(self) -> None:
        def rebuild(text: str) -> str:
            if text == FRAGMENTED:
                raise RuntimeError("quota")
            return text.upper()

        report = heal_mod.heal(self.TARGETS, reconstruct=rebuild, save=MagicMock(return_value=True))
        self.assertEqual((report.failed, report.saved), (1, 1))

    def test_an_unreadable_healed_check_means_try_not_skip(self) -> None:
        self.mocks["unhealed"].side_effect = RuntimeError("db down")
        report = heal_mod.heal(self.TARGETS, reconstruct=str.upper, save=MagicMock(return_value=True))
        self.assertEqual(report.saved, 2)

    def test_chunks_are_released_however_it_ends(self) -> None:
        heal_mod._in_flight.update({ID0, ID1})
        heal_mod.heal(self.TARGETS, reconstruct=MagicMock(side_effect=RuntimeError("x")), save=MagicMock())
        self.assertEqual(heal_mod._in_flight, set())


class StorageTests(Case):
    """What reaches the database: overwrite only what was read, and mark once."""

    def test_saving_marks_the_chunk_and_only_overwrites_what_was_read(self) -> None:
        heal_mod._healed_column = True
        cur = MagicMock(rowcount=1)
        with patch.object(heal_mod, "get_db_connection", return_value=fake_connection(cur)):
            self.assertTrue(heal_mod._save(Target(ID0, FRAGMENTED), "fixed"))
        sql, params = cur.execute.call_args.args
        self.assertIn("healed_at = NOW()", sql)
        self.assertIn("AND content = %s", sql)
        self.assertEqual(params, ("fixed", ID0, FRAGMENTED))
        self.assertIn(ID0, heal_mod._healed_in_process)

    def test_without_the_column_saving_still_works(self) -> None:
        heal_mod._healed_column = False
        cur = MagicMock(rowcount=1)
        with patch.object(heal_mod, "get_db_connection", return_value=fake_connection(cur)):
            self.assertTrue(heal_mod._save(Target(ID0, FRAGMENTED), "fixed"))
        self.assertNotIn("healed_at", cur.execute.call_args.args[0])

    def test_already_healed_chunks_are_found_by_their_mark(self) -> None:
        heal_mod._healed_column = True
        cur = MagicMock()
        cur.fetchall.return_value = [{"id": ID0}]
        targets = [Target(ID0, FRAGMENTED), Target(ID1, "frag: two")]
        with patch.object(heal_mod, "get_db_connection", return_value=fake_connection(cur)), \
                patch.object(heal_mod, "is_db_available", return_value=True):
            left = heal_mod.unhealed(targets)
        self.assertEqual([t.chunk_id for t in left], [ID1])
        sql, params = cur.execute.call_args.args
        self.assertIn("healed_at IS NOT NULL", sql)
        self.assertIn("ANY(%s::uuid[])", sql)
        self.assertEqual(params, ([ID0, ID1],))

    def test_without_the_column_this_process_remembers_instead(self) -> None:
        heal_mod._healed_column = False
        heal_mod._remember_in_process([ID0])
        with patch.object(heal_mod, "is_db_available", return_value=True):
            left = heal_mod.unhealed([Target(ID0, FRAGMENTED), Target(ID1, "frag: two")])
        self.assertEqual([t.chunk_id for t in left], [ID1])

    def test_marking_inside_a_callers_transaction_uses_a_savepoint(self) -> None:
        heal_mod._healed_column = True
        cur = MagicMock(rowcount=2)
        self.assertEqual(heal_mod.mark_healed([ID0, ID1], cur=cur), 2)
        statements = [call.args[0] for call in cur.execute.call_args_list]
        self.assertEqual(statements[0], "SAVEPOINT chunk_autoheal_mark")
        self.assertIn("SET healed_at = NOW()", statements[1])
        self.assertEqual(statements[2], "RELEASE SAVEPOINT chunk_autoheal_mark")

    def test_a_failed_mark_rolls_back_to_the_savepoint_and_never_raises(self) -> None:
        heal_mod._healed_column = True
        cur = MagicMock()

        def execute(sql, params=None):
            if sql.startswith("UPDATE"):
                raise RuntimeError("lock timeout")

        cur.execute.side_effect = execute
        self.assertEqual(heal_mod.mark_healed([ID0], cur=cur), 0)
        self.assertIn("ROLLBACK TO SAVEPOINT chunk_autoheal_mark", [c.args[0] for c in cur.execute.call_args_list])

    def test_marking_in_a_transaction_never_adds_the_column_mid_way(self) -> None:
        heal_mod._healed_column = None
        cur = MagicMock()
        self.assertEqual(heal_mod.mark_healed([ID0], cur=cur), 0)
        cur.execute.assert_not_called()
        self.assertIn(ID0, heal_mod._healed_in_process)

    def test_ids_that_are_not_uuids_are_never_sent_to_the_database(self) -> None:
        self.assertEqual(heal_mod._uuid_ids([ID0, "chunk-7", None, ""]), [ID0])

    def test_the_process_memory_is_bounded(self) -> None:
        with patch.object(heal_mod, "_FALLBACK_LIMIT", 3):
            heal_mod._remember_in_process(["a", "b", "c", "d", "e"])
        self.assertEqual(list(heal_mod._healed_in_process), ["c", "d", "e"])


class RetrievalDoesNotWaitTests(Case):
    """The whole point: a slow repair no longer holds up the search."""

    def test_retrieval_returns_before_a_slow_repair_finishes(self) -> None:
        from app.services.pipeline_service import LegalCasePipelineService as PipelineService

        def slow(text: str) -> str:
            time.sleep(1.0)
            return text.upper()

        futures = []
        real_schedule = heal_mod.schedule
        retrieved = rows(FRAGMENTED, "frag: two")
        with patch.object(heal_mod, "_reconstruct", side_effect=slow), \
                patch.object(heal_mod, "_save", return_value=True), \
                patch.object(heal_mod, "unhealed", side_effect=lambda targets: list(targets)), \
                patch.object(heal_mod, "mark_healed", return_value=0), \
                patch.object(heal_mod, "is_db_available", return_value=True), \
                patch.object(heal_mod, "schedule", side_effect=lambda r: futures.append(real_schedule(r))):
            started = time.monotonic()
            returned = PipelineService._autoheal_fragmented_rows(MagicMock(), retrieved)
            elapsed = time.monotonic() - started
            report = futures[0].result(timeout=10)  # let the background job finish inside the patches
        self.assertLess(elapsed, 0.5)
        self.assertIs(returned, retrieved)
        self.assertEqual(returned[0]["content"], FRAGMENTED)
        self.assertEqual(report.saved, 2)


if __name__ == "__main__":
    unittest.main()
