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


# ── The model reported must be the model that can actually run ───────────────

def test_gemini_model_on_a_claude_only_agent_falls_back_and_is_reported(monkeypatch):
    """Selecting a Gemini model for a claude_llm-only agent cannot work, so
    the config must report the Claude model that will really run — not echo
    back the admin's pick."""
    _use(monkeypatch, _row(model_ids=[23]), models={23: "gemini-2.5-flash"})
    cfg = ac.get_agent_config("issue_spotter")
    assert cfg.runtime == ac.CLAUDE
    assert cfg.model_name.lower().startswith("claude")


def test_claude_model_on_a_gemini_only_agent_falls_back(monkeypatch):
    _use(monkeypatch, _row(model_ids=[33]), models={33: "claude-sonnet-5"})
    cfg = ac.get_agent_config("doc_classify")
    assert cfg.runtime == ac.GEMINI
    assert cfg.model_name.lower().startswith(("gemini", "gemma"))


def test_claude_model_is_kept_for_a_claude_agent(monkeypatch):
    _use(monkeypatch, _row(model_ids=[33]), models={33: "claude-sonnet-5"})
    assert ac.get_agent_config("query_generation").model_name == "claude-sonnet-5"


def test_dual_runtime_agent_accepts_either_model(monkeypatch):
    _use(monkeypatch, _row(model_ids=[33]), models={33: "claude-sonnet-5"})
    assert ac.get_agent_config("judgment_verifier").model_name == "claude-sonnet-5"
    ac.invalidate()
    _use(monkeypatch, _row(model_ids=[23]), models={23: "gemini-2.5-flash"})
    assert ac.get_agent_config("judgment_verifier").model_name == "gemini-2.5-flash"


# ── Generation parameters from the console ───────────────────────────────────

def test_unticked_thinking_toggle_is_not_a_zero_budget():
    """The console writes `false` for an unticked toggle. Reading that as a
    budget of 0 is what made gemini-2.5-pro fail with 'Budget 0 is invalid.
    This model only works in thinking mode.'"""
    import agents
    assert agents._thinking_config({"thinking_budget": False}, "gemini-2.5-flash") is None
    assert agents._thinking_config({"thinking_budget": False}, "gemini-2.5-pro") is None
    assert agents._thinking_config({}, "gemini-2.5-flash") is None


def test_a_real_budget_is_passed_through():
    import agents
    tc = agents._thinking_config({"thinking_budget": 512}, "gemini-2.5-flash")
    assert tc is not None and tc.thinking_budget == 512


def test_zero_budget_is_dropped_for_thinking_only_models():
    """An explicit 0 must not be sent to a model that always thinks — it
    would 400 and fail the whole run."""
    import agents
    assert agents._thinking_config({"thinking_budget": 0}, "gemini-2.5-pro") is None
    assert agents._thinking_config({"thinking_budget": 0}, "gemini-3-pro") is None
    tc = agents._thinking_config({"thinking_budget": 0}, "gemini-2.5-flash")
    assert tc is not None and tc.thinking_budget == 0


# ── Placeholders in admin prompts ────────────────────────────────────────────

def _db_cfg(prompt):
    return ac.AgentConfig(agent_name="context_extract", prompt=prompt,
                          model_name="gemini-2.5-pro", temperature=0.1,
                          source="db")


def test_unfilled_placeholder_is_made_optional_not_fatal():
    """ADK raises on a placeholder nothing fills; an admin typo must not 500
    the run."""
    import agents
    out = agents._safe_adk_prompt(_db_cfg("Use {mystery} here."), "Use {mystery} here.")
    assert out == "Use {mystery?} here."


def test_supplied_placeholder_is_left_alone():
    import agents
    text = "The document type is {doc_classification}."
    out = agents._safe_adk_prompt(_db_cfg(text), text, ("doc_classification",))
    assert out == text


def test_json_braces_in_a_prompt_are_untouched():
    """ADK ignores non-identifier braces, so JSON examples must survive."""
    import agents
    text = 'Answer as {"status": "ok"}'
    assert agents._safe_adk_prompt(_db_cfg(text), text) == text


def test_document_type_is_injected_into_the_admin_prompt(monkeypatch):
    """The standalone path substitutes the type into the prompt actually in
    use — substituting into the hardcoded text and then sending the admin's
    is what raised 'Context variable not found: doc_classification'."""
    import agents
    _use(monkeypatch, _row(name="judgement_context_extract_agent",
                           prompt="Doc type is {doc_classification}. Extract it."),
         models={27: "gemini-2.5-flash"})
    agent = agents.build_extract_agent("petition")
    assert "{doc_classification}" not in agent.instruction
    assert "Doc type is petition." in agent.instruction


# ── Model capabilities ───────────────────────────────────────────────────────
# Verified live on 2026-09-07; see MODEL_CAPABILITIES for the probe results.

def test_thinking_level_is_sent_only_to_models_that_accept_it():
    import agents
    for model in ("gemini-3.7-flash", "gemini-pro-latest", "gemini-flash-latest",
                  "gemini-flash-lite-latest", "gemini-3.1-pro-preview"):
        tc = agents._thinking_config({"thinking_level": "low"}, model)
        assert tc is not None and tc.thinking_level, f"{model} should take a level"
    for model in ("gemini-2.5-flash", "gemini-2.5-pro", "gemma-4-31b-it"):
        assert agents._thinking_config({"thinking_level": "low"}, model) is None, model


def test_zero_budget_only_where_the_model_allows_it():
    import agents
    for model in ("gemini-2.5-flash", "gemini-flash-latest", "gemini-3.7-flash"):
        tc = agents._thinking_config({"thinking_budget": 0}, model)
        assert tc is not None and tc.thinking_budget == 0, model
    for model in ("gemini-2.5-pro", "gemini-pro-latest", "gemini-flash-lite-latest",
                  "gemini-3.5-flash-lite"):
        assert agents._thinking_config({"thinking_budget": 0}, model) is None, model


def test_gemma_takes_no_thinking_parameters():
    import agents
    assert agents._thinking_config({"thinking_budget": 256}, "gemma-4-31b-it") is None


def test_unknown_model_is_sent_no_thinking_parameters():
    """A model Google ships tomorrow must run on its defaults, not fail."""
    import agents
    caps = ac.model_caps("gemini-9-superflash")
    assert caps.available and not caps.thinking_level and not caps.thinking_budget
    assert agents._thinking_config({"thinking_level": "low"}, "gemini-9-superflash") is None


def test_catalogue_entries_the_api_cannot_serve_are_flagged():
    for dead in ("gemini", "gemini-2.0-flash", "gemini-3-pro", "gemini-pro-2.5"):
        assert not ac.model_caps(dead).available, dead
    for live in ("gemini-2.5-flash", "gemini-pro-latest", "gemini-flash-latest"):
        assert ac.model_caps(live).available, live


def test_admin_model_switch_changes_the_agent_model(monkeypatch):
    """The whole point: change model_ids in the console, get that model."""
    import agents
    _use(monkeypatch, _row(name="judgement_case_summary_agent", model_ids=[38]),
         models={38: "gemini-flash-latest"})
    assert agents.build_case_summary_agent().model == "gemini-flash-latest"


# ── thinking_level vocabulary ────────────────────────────────────────────────
# The API defines MINIMAL / LOW / MEDIUM / HIGH. MINIMAL is newer and narrower:
# the Pro models and larger flash models reject it outright.

def test_all_four_levels_are_recognised_case_insensitively():
    import agents
    for level in ("MINIMAL", "minimal", "Low", "MEDIUM", "high"):
        tc = agents._thinking_config({"thinking_level": level}, "gemini-3.1-flash-lite")
        assert tc is not None, level
        assert tc.thinking_level.value == level.upper()


def test_default_and_blank_levels_mean_not_set():
    import agents
    for level in ("default", "", "THINKING_LEVEL_UNSPECIFIED", None):
        assert agents._thinking_config({"thinking_level": level}, "gemini-3.7-flash") is None


def test_minimal_falls_back_to_low_where_unsupported():
    """gemini-3.8-flash/flash-latest/pro-latest reject MINIMAL — dropping the
    setting entirely would lose the intent, so the closest level is used."""
    import agents
    for model in ("gemini-3.8-flash", "gemini-flash-latest", "gemini-pro-latest",
                  "gemini-3.7-flash", "gemini-3.1-pro-preview"):
        tc = agents._thinking_config({"thinking_level": "minimal"}, model)
        assert tc is not None and tc.thinking_level.value == "LOW", model


def test_minimal_is_passed_through_where_supported():
    import agents
    for model in ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite",
                  "gemini-flash-lite-latest", "gemini-3.6-flash"):
        tc = agents._thinking_config({"thinking_level": "minimal"}, model)
        assert tc is not None and tc.thinking_level.value == "MINIMAL", model


def test_levels_are_never_sent_to_a_model_without_level_support():
    import agents
    for model in ("gemini-2.5-flash", "gemini-2.5-pro", "gemma-4-31b-it"):
        for level in ("minimal", "low", "high"):
            assert agents._thinking_config({"thinking_level": level}, model) is None
