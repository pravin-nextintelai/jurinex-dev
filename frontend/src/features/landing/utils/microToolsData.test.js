import assert from "node:assert/strict"
import test from "node:test"

import {
  SAMPLE_PLEADING,
  checkCitation,
  emptyHint,
  filingDeadline,
  rewritePleadings,
  searchSections,
} from "./microToolsData.js"

const ids = (rows) => rows.map((row) => row.id)

test("search maps the pleaded sections and keeps lookalike numbers apart", () => {
  assert.deepEqual(ids(searchSections("420")), ["ipc-420"])
  assert.deepEqual(ids(searchSections("420 IPC")), ["ipc-420"])
  assert.deepEqual(ids(searchSections("318(4) BNS")), ["ipc-420"])
  assert.deepEqual(ids(searchSections("318 IPC")), ["ipc-318"])
  assert.ok(ids(searchSections("318 BNS")).includes("ipc-420"))
  assert.equal(ids(searchSections("318 BNS")).includes("ipc-318"), false)

  const fourEightTwo = ids(searchSections("482"))
  assert.deepEqual(fourEightTwo, ["crpc-438", "crpc-482"])

  const sixtyThree = ids(searchSections("63"))
  assert.ok(sixtyThree.includes("ipc-63"))
  assert.ok(sixtyThree.includes("ipc-375"))
  assert.ok(sixtyThree.includes("iea-65b"))
  assert.deepEqual(ids(searchSections("63 BSA")), ["iea-65b"])

  assert.deepEqual(ids(searchSections("304B")), ["ipc-304b"])
  assert.equal(ids(searchSections("murder"))[0], "ipc-302")
  const oneSevenThree = ids(searchSections("173"))
  assert.ok(oneSevenThree.includes("crpc-154"))
  assert.ok(oneSevenThree.includes("crpc-173"))
  assert.deepEqual(ids(searchSections("138")), [])
  assert.match(emptyHint("138"), /Negotiable Instruments Act/)
})

test("rewrite updates a mixed pleading and refuses an ambiguous number", () => {
  const result = rewritePleadings(SAMPLE_PLEADING)
  assert.equal(result.replacements.length, 5)
  assert.match(result.text, /Anticipatory Bail application under Section 482 of the Bharatiya Nagarik Suraksha Sanhita/)
  assert.match(result.text, /erstwhile Section 438 CrPC/)
  assert.match(result.text, /Section 318\(4\) of the Bharatiya Nyaya Sanhita, 2023 \(erstwhile Section 420 IPC\)/)
  assert.match(result.text, /erstwhile Section 406 IPC/)
  assert.match(result.text, /erstwhile Section 120B IPC/)
  assert.match(result.text, /Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 \(erstwhile Section 65B IEA\)/)
  assert.equal(result.text.includes("of CrPC"), false)

  const quash = rewritePleadings("Petition under Section 482 CrPC.")
  assert.match(quash.text, /Section 528 of the Bharatiya Nagarik Suraksha Sanhita/)

  const bail = rewritePleadings("Application under Section 482 BNSS.")
  assert.equal(bail.text, "Application under Section 482 BNSS.")
  assert.equal(bail.replacements.length, 0)

  const ambiguous = rewritePleadings("See Section 482.")
  assert.equal(ambiguous.text, "See Section 482.")
  assert.equal(ambiguous.missed.length, 1)

  const hindi = rewritePleadings("धारा 420 आईपीसी")
  assert.match(hindi.text, /Section 318\(4\)/)
})

test("citation check accepts the common reporter shapes", () => {
  assert.equal(checkCitation("(2024) 5 SCC 1").ok, true)
  assert.equal(checkCitation("2024 SCC OnLine Del 123").label, "SCC OnLine")
  assert.equal(checkCitation("AIR 2023 SC 100").ok, true)
  assert.equal(checkCitation("2024 INSC 88").ok, true)
  assert.equal(checkCitation("2024:DHC:1234").parts[1].value, "DHC")
  assert.equal(checkCitation("somewhere in a judgment").ok, false)
  assert.equal(checkCitation("  "), null)
})

test("limitation counts the start day out and adds Section 12(2) copy time only for appeals and reviews", () => {
  const appeal = filingDeadline({ articleId: "116a", start: "2024-01-01", copyDays: 0 })
  assert.equal(appeal.iso, "2024-03-31")

  const withCopy = filingDeadline({ articleId: "116a", start: "2024-01-01", copyDays: 4 })
  assert.equal(withCopy.iso, "2024-04-04")

  const suit = filingDeadline({ articleId: "113", start: "2023-10-24", copyDays: 10 })
  assert.equal(suit.iso, "2026-10-24")
  assert.equal(suit.useCopy, false)

  const nonLeap = filingDeadline({ articleId: "116a", start: "2025-01-01", copyDays: 0 })
  assert.equal(nonLeap.iso, "2025-04-01")
})
