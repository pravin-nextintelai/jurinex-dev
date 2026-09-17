"""Repairing fragmented chunks in the background, so retrieval never waits for it."""
from __future__ import annotations

import time
import unittest
from concurrent.futures import Future
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import chunk_autoheal as heal_mod
from app.services.chunk_autoheal import Target

FRAGMENTED = "frag: Ltd . p .a . 18 % 202 5"
CLEAN = "A clean paragraph of legal prose."


def looks_fragmented(text: str) -> bool:
    return text.startswith("frag:")


def rows(*contents: str, ids=True):
    return [
        {"chunk_id": f"c{n}" if ids else None, "content": content}
        for n, content in enumerate(contents)
    ]


class Case(unittest.TestCase):
    def setUp(self) -> None:
        heal_mod._in_flight.clear()
        self.addCleanup(heal_mod._in_flight.clear)
        for target, kwargs in (
            ("_looks_fragmented", {"side_effect": looks_fragmented}),
            ("get_settings", {"return_value": SimpleNamespace(chunk_autoheal_enabled=True)}),
        ):
            patcher = patch.object(heal_mod, target, **kwargs)
            self.mocks = getattr(self, "mocks", {})
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
        self.assertEqual([t.chunk_id for t in job.targets], ["c0", "c2"])
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
    TARGETS = [Target("c0", FRAGMENTED), Target("c1", "frag: second")]

    def test_repaired_text_is_saved(self) -> None:
        save = MagicMock(return_value=True)
        report = heal_mod.heal(self.TARGETS, reconstruct=lambda text: text.upper(), save=save)
        self.assertEqual((report.repaired, report.saved), (2, 2))
        self.assertEqual(save.call_args_list[0].args, (self.TARGETS[0], FRAGMENTED.upper()))

    def test_text_the_model_could_not_improve_is_not_written(self) -> None:
        save = MagicMock()
        report = heal_mod.heal(self.TARGETS, reconstruct=lambda text: text, save=save)
        self.assertEqual(report.unchanged, 2)
        save.assert_not_called()

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

    def test_chunks_are_released_however_it_ends(self) -> None:
        heal_mod._in_flight.update({"c0", "c1"})
        heal_mod.heal(self.TARGETS, reconstruct=lambda text: (_ for _ in ()).throw(RuntimeError("x")), save=MagicMock())
        self.assertEqual(heal_mod._in_flight, set())

    def test_the_save_only_overwrites_what_was_read(self) -> None:
        cur = MagicMock(rowcount=1)
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.cursor.return_value.__enter__.return_value = cur
        with patch.object(heal_mod, "get_db_connection", return_value=conn):
            self.assertTrue(heal_mod._save(Target("c0", FRAGMENTED), "fixed"))
        sql, params = cur.execute.call_args.args
        self.assertIn("AND content = %s", sql)
        self.assertEqual(params, ("fixed", "c0", FRAGMENTED))


class RetrievalDoesNotWaitTests(Case):
    """The whole point: a slow repair no longer holds up the search."""

    def test_retrieval_returns_before_a_slow_repair_finishes(self) -> None:
        from app.services.pipeline_service import LegalCasePipelineService as PipelineService

        def slow(text: str) -> str:
            time.sleep(2.0)
            return text.upper()

        retrieved = rows(FRAGMENTED, "frag: two", "frag: three")
        with patch.object(heal_mod, "_reconstruct", side_effect=slow), \
                patch.object(heal_mod, "_save", return_value=True), \
                patch.object(heal_mod, "is_db_available", return_value=True):
            started = time.monotonic()
            returned = PipelineService._autoheal_fragmented_rows(MagicMock(), retrieved)
            elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.5)
        self.assertIs(returned, retrieved)
        self.assertEqual(returned[0]["content"], FRAGMENTED)


if __name__ == "__main__":
    unittest.main()
