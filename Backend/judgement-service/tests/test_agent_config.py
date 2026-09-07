"""Admin-console agent configuration (public.agent_prompts).

The contract: when the admin has a row for an agent, its model, prompt and
parameters win; when it has none — or the DB is unreachable — the agent
keeps its hardcoded prompt and the model from settings, because the service
must never stop working on account of the admin DB.
"""

import datetime as dt

import agent_config as ac


def setup_function():
    ac.invalidate()


def teardown_function():
    ac.invalidate()


def _row(**over):
    row = {
        "id": 7,
        "name": "judgement_case_summary_agent",
        "prompt": "ADMIN PROMPT — summarise the judgment for an advocate.",
        "model_ids": [27],
        "temperature": 0.4,
        "agent_type": "summarization",
        "llm_parameters": {},
        "updated_at": dt.datetime(2026, 9, 7, 10, 0, 0),
    }
    row.update(over)
    return row


def _use(monkeypatch, row, models=None):
    monkeypatch.setattr(ac, "_fetch_row", lambda name: row)
    monkeypatch.setattr(ac, "_llm_models_map",
                        lambda: models if models is not None else {27: "gemma-4-31b-it"})


# ── model_ids parsing: the admin console stores it three different ways ──────

def test_model_ids_jsonb_array():
    assert ac._coerce_model_ids([27]) == [27]


def test_model_ids_postgres_array_literal():
    assert ac._coerce_model_ids("{27}") == [27]
    assert ac._coerce_model_ids("{27,13}") == [27, 13]


def test_model_ids_json_string_and_bare_int():
    assert ac._coerce_model_ids("[27, 13]") == [27, 13]
    assert ac._coerce_model_ids(27) == [27]


def test_model_ids_empty_forms():
    assert ac._coerce_model_ids(None) == []
    assert ac._coerce_model_ids("{}") == []
    assert ac._coerce_model_ids([]) == []


# ── DB row wins ──────────────────────────────────────────────────────────────

def test_db_row_supplies_model_prompt_and_temperature(monkeypatch):
    _use(monkeypatch, _row())
    cfg = ac.get_agent_config("case_summary", default_prompt="HARDCODED")
    assert cfg.source == "db"
    assert cfg.model_name == "gemma-4-31b-it"   # model_ids[0] via llm_models
    assert cfg.prompt.startswith("ADMIN PROMPT")
    assert cfg.temperature == 0.4
    assert cfg.db_id == 7


def test_llm_parameters_temperature_beats_the_column(monkeypatch):
    _use(monkeypatch, _row(temperature=0.4, llm_parameters={"temperature": 0.9}))
    assert ac.get_agent_config("case_summary").temperature == 0.9


def test_unknown_model_id_keeps_the_hardcoded_model(monkeypatch):
    """A model_ids entry with no llm_models row must not blank the model."""
    _use(monkeypatch, _row(model_ids=[9999]), models={27: "gemma-4-31b-it"})
    cfg = ac.get_agent_config("case_summary", default_model="gemini-2.5-flash")
    assert cfg.model_name == "gemini-2.5-flash"


def test_model_name_may_come_from_llm_parameters(monkeypatch):
    _use(monkeypatch, _row(model_ids=[], llm_parameters={"model": "gemini-3-pro"}))
    assert ac.get_agent_config("case_summary").model_name == "gemini-3-pro"


def test_blank_db_prompt_keeps_the_hardcoded_instruction(monkeypatch):
    """A row that only configures the model must not erase the prompt."""
    _use(monkeypatch, _row(prompt="   "))
    cfg = ac.get_agent_config("case_summary", default_prompt="HARDCODED INSTRUCTION")
    assert cfg.prompt == "HARDCODED INSTRUCTION"
    assert cfg.model_name == "gemma-4-31b-it"   # the model still comes from DB


def test_system_instructions_are_appended(monkeypatch):
    _use(monkeypatch, _row(llm_parameters={"system_instructions": "Answer in English."}))
    assert ac.get_agent_config("case_summary").prompt.endswith("Answer in English.")


# ── Fallback ─────────────────────────────────────────────────────────────────

def test_no_row_uses_hardcoded_prompt_and_settings_model(monkeypatch):
    monkeypatch.setattr(ac, "_fetch_row", lambda name: None)
    cfg = ac.get_agent_config("case_summary", default_prompt="HARDCODED")
    assert cfg.source == "default"
    assert cfg.prompt == "HARDCODED"
    assert cfg.model_name == ac.AGENT_DEFAULTS["case_summary"].model()
    assert cfg.temperature == ac.AGENT_DEFAULTS["case_summary"].temperature


def test_db_failure_falls_back_rather_than_raising(monkeypatch):
    def boom(name):
        raise RuntimeError("connection refused")
    monkeypatch.setattr(ac, "_fetch_row", boom)
    try:
        ac.get_agent_config("case_summary", default_prompt="HARDCODED")
    except RuntimeError:
        raise AssertionError("a DB outage must not propagate to the agent")
    except Exception:
        pass


def test_cached_default_still_honours_this_call_prompt(monkeypatch):
    """keyword_extract has two prompt variants; a cached DEFAULT must not
    pin the first caller's wording onto the second."""
    monkeypatch.setattr(ac, "_fetch_row", lambda name: None)
    first = ac.get_agent_config("keyword_extract", default_prompt="SIMPLE STYLE")
    second = ac.get_agent_config("keyword_extract", default_prompt="ADVANCED STYLE")
    assert first.prompt == "SIMPLE STYLE"
    assert second.prompt == "ADVANCED STYLE"


# ── Name matching ────────────────────────────────────────────────────────────

def test_accepted_names_prefer_the_service_scoped_form():
    names = ac.accepted_db_names("case_summary")
    assert names[0] == "judgement_case_summary_agent"
    assert "case_summary" in names


def test_every_registered_agent_has_defaults():
    for name, defaults in ac.AGENT_DEFAULTS.items():
        assert defaults.model(), f"{name} has no default model"
        assert 0.0 <= defaults.temperature <= 2.0


# ── good_law_check: the judgment under check is data, not instruction ────────

def test_good_law_prompt_substitutes_the_placeholder():
    from tools import good_law_prompt
    out = good_law_prompt("Status of {judgment}? Answer in JSON.", "A vs B (SC, 2019)")
    assert out == "Status of A vs B (SC, 2019)? Answer in JSON."


def test_good_law_prompt_appends_when_admin_omits_the_placeholder():
    """An admin prompt written without {judgment} must not send the check off
    without the case it is supposed to check."""
    from tools import good_law_prompt
    out = good_law_prompt("Check this judgment's status.", "A vs B (SC, 2019)")
    assert "A vs B (SC, 2019)" in out
