"""Court filters on the LOCAL library search: a selected court must narrow
the result set to that court. The failure this guards against is silent —
a token with no docsource mapping used to contribute no clause at all, so
picking a tribunal quietly searched every court in the library."""

from tools import es_court_clauses

# Every doctype token the Advanced Search popup can send.
UI_TOKENS = """
supremecourt scorders allahabad andhra amravati bombay kolkata kolkata_app
chattisgarh delhi delhiorders gauhati gujarat himachal_pradesh jammu srinagar
jharkhand karnataka kerala madhyapradesh manipur meghalaya chennai orissa patna
patna_orders punjab jaipur jodhpur sikkim uttaranchal tripura telangana delhidc
bangaloredc aptel authority cat cegat cerc cic clb consumer copyrightboard drat
greentribunal cci ipab itat mrtp sebisat stt tdsat trademark cestat nclat
treaties unitednations eci fssai irdai rbi sebi trai bis cbfc lawcommission
debates loksabha rajyasabha
""".split()


def test_every_selectable_token_restricts():
    """No token may produce an empty clause list — an empty list means the
    filter is dropped and judgments from every court come back."""
    unfiltered = [t for t in UI_TOKENS if not es_court_clauses(t)]
    assert unfiltered == [], f"tokens that silently disable the court filter: {unfiltered}"


def test_no_selection_means_no_filter():
    assert es_court_clauses("") == []
    assert es_court_clauses("  ,  ") == []


def test_each_token_contributes_one_clause():
    assert len(es_court_clauses("delhi,itat,supremecourt")) == 3


def test_supreme_court_matches_its_docsource():
    clauses = es_court_clauses("supremecourt")
    assert clauses == [{"match_phrase": {"docsource": "Supreme Court"}}]


def test_tribunal_token_targets_that_tribunal():
    phrases = str(es_court_clauses("itat"))
    assert "Income Tax Appellate Tribunal" in phrases


def test_tribunals_aggregate_is_not_empty():
    """IK_DOCTYPES ships 'tribunals' by default — it must resolve to the
    tribunal docsources, not to a dropped filter."""
    assert es_court_clauses("tribunals")


def test_high_court_token_accepts_ik_abbreviated_docsource():
    """IK writes some benches as 'Andhra HC (Pre-Telangana)' — the state's
    judgments must not be missed because the words 'High Court' are absent."""
    assert "HC" in str(es_court_clauses("andhra"))


def test_unknown_token_restricts_rather_than_widens():
    """A document category the library holds nothing for (RBI circulars)
    must return nothing, never everything."""
    clauses = es_court_clauses("rbi")
    assert clauses and clauses[0]["match"]["docsource"]["query"] == "rbi"
