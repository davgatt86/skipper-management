/* ============================================================================
 * parse-core.js — canonical Don Fishing sales-note / auction-sheet parser
 * ----------------------------------------------------------------------------
 * Single source of truth for PDF parsing shared by:
 *   - Fish Sales Tracker  (fish-sales.netlify.app)
 *   - Sales Analyser      (sales-analyser.netlify.app)
 *
 * Formats handled (auto-detected):
 *   - Don Fishing Co "SALES NOTE"            (PD / Scrabster / Ullapool / private)
 *   - John S Duncan "Supplier Transactions"  (Scrabster, column-coordinate based)
 *   - P&J Johnstone "Registered Seller Sales Note"
 *   - Shetland Seafood Auctions "Supplier transactions"
 *   - fiskeauktion.dk "My sales"             (Hanstholm)
 *
 * Environment-agnostic: gets text via a pdf.js instance YOU supply
 * (browser window.pdfjsLib or node pdfjs-dist). No other dependencies.
 *
 * Usage (browser, classic script tag):
 *   <script src="https://<host>/parse-core.js"></script>
 *   const res = await ParseCore.parsePdf(arrayBuffer, window.pdfjsLib, "file.pdf");
 *
 * Usage (node / bundler):
 *   const ParseCore = require("./parse-core.js");
 *   const res = await ParseCore.parsePdf(data, require("pdfjs-dist/legacy/build/pdf.js"));
 *
 * Result shape:
 *   { market, filename, rows:[...], meta:{...}, reconcile:{...} }
 *   row: { buyer, species (raw note text), species_canon, presentation, grade,
 *          quality, boxes, box_weight, total_weight, price_per_box,
 *          price_per_kg, total_value, msc }
 *   reconcile: { found, ok, expected:{boxes,weight,value},
 *                actual:{boxes,weight,value}, diffs:{...} }   // vs printed TOTAL
 *
 * Every change to parsing logic goes HERE, never in the apps.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ParseCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "1.3.5";
  const round2 = n => Math.round(n * 100) / 100;
  // A leading '*' is a flag the office puts on a figure, not part of it.
  const num = s => parseFloat(String(s).replace(/,/g, "").replace(/^\s*\*+/, ""));

  /* ------------------------------------------------------------------ *
   * Text extraction: pdf.js textContent -> merged lines + word coords
   * ------------------------------------------------------------------ */
  function itemsToLines(tc) {
    const items = tc.items.map(it => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }));
    const byY = {};
    for (const it of items) { const key = Math.round(it.y / 2) * 2; (byY[key] = byY[key] || []).push(it); }
    return Object.keys(byY).map(Number).sort((a, b) => b - a)
      .map(y => byY[y].sort((a, b) => a.x - b.x).map(i => i.str).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  // Build the {allLines, pages, fullText} bundle the parsers consume.
  async function extractPages(pdfDoc) {
    const allLines = [], pages = []; let fullText = "";
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const tc = await (await pdfDoc.getPage(p)).getTextContent();
      const lines = itemsToLines(tc);
      allLines.push(...lines); fullText += lines.join(" ") + " ";
      // word-level coords for column-aware parsing (JSD buyer column).
      // pdf.js y is bottom-up; convert to top-down so larger y = lower on page.
      const words = []; let maxY = 0;
      for (const it of tc.items) { if (it.transform[5] > maxY) maxY = it.transform[5]; }
      for (const it of tc.items) { const s = it.str.trim(); if (!s) continue; words.push({ str: s, x: it.transform[4], y: maxY - it.transform[5] }); }
      pages.push({ words });
    }
    return { allLines, pages, fullText };
  }

  /* ------------------------------------------------------------------ *
   * Market detection
   * ------------------------------------------------------------------ */
  function detectMarket(t) {
    if (/L\.H\.D\.?\s*LIMITED/i.test(t)) return "LHD \u00b7 Lerwick";
    if (/FISKEAUKTION/i.test(t) && (/Beskrivelse/i.test(t) || /Omkostninger/i.test(t) || /Self-billing/i.test(t))) return "Hanstholm Afregning";
    if (/FISKEAUKTION/i.test(t) || /Indicative exchange rate/i.test(t)) return "Hanstholm";
    if (/SHETLAND SEAFOOD/i.test(t) || /Shetland Clock/i.test(t)) return "Shetland Auction";
    // John S Duncan (Don Fishing's Scrabster branch) issues both a "Supplier
    // Transactions" table and a standard Don Fishing "SALES NOTE".
    if (/Supplier Transactions/i.test(t)) return "John S Duncan · Scrabster";
    if (/John S\.?\s*Duncan/i.test(t)) return "John S Duncan · Scrabster";
    if (/PETER\s*&\s*J\.?\s*JOHNSTONE/i.test(t) || /Registered Seller Sales Note/i.test(t) || /pjj-peterhead/i.test(t)) return "P&J Johnstone · Peterhead";
    if (/Don Fishing/i.test(t) || /SALES NOTE/i.test(t)) {
      for (const p of ["Peterhead", "Scrabster", "Ullapool", "Kinlochbervie"]) if (new RegExp(p, "i").test(t)) return "Don Fishing · " + p;
      return "Don Fishing";
    }
    return "Unknown";
  }

  /* ------------------------------------------------------------------ *
   * Species canonicalisation
   * ------------------------------------------------------------------ */
  // Multi-word species on Don Fishing notes: the slash-token's first word is
  // the key; the value is the sequence of preceding words that belong to the
  // species (matched right-to-left against the words before the token).
  const SPECIES_PREFIX = {
    SCOT: ["CATFISH"], COLEY: ["SAITHE"], SQU: ["EUROPEAN"], SOLE: ["LEMON"],
    LYTH: ["POLLOCK"], LING: ["BLUE"], DORY: ["JOHN"], GURNARDS: ["RED"],
    DOGFI: ["PICKED"], SK: ["THORNBACK"], SCABBE: ["BLACK"], BLUEM: ["REDS", "-"]
  };
  // Raw note text -> canonical species name (shared vocabulary across markets).
  const SPECIES_CANON = {
    "CATFISH SCOT": "Catfish", "SAITHE COLEY": "Saithe", "EUROPEAN SQU": "Squid",
    "POLLOCK LYTH": "Lythe", "LEMON SOLE": "Lemon Sole", "BLUE LING": "Blue Ling",
    "JOHN DORY": "John Dory", "RED GURNARDS": "Gurnard", "PICKED DOGFI": "Dogfish",
    "THORNBACK SK": "Thornback Skate", "BLACK SCABBE": "Black Scabbardfish",
    "REDS - BLUEM": "Bluemouth Redfish", "REDFISHES": "Redfish", "ARGENTINES": "Argentine",
    "MONKFISH": "Monkfish", "COD": "Cod", "HADDOCK": "Haddock", "HAKE": "Hake",
    "WHITING": "Whiting", "WITCH": "Witch", "MEGRIM": "Megrim", "LING": "Ling",
    "PLAICE": "Plaice", "TURBOT": "Turbot", "BRILL": "Brill", "TUSK": "Tusk",
    "HALIBUT": "Halibut", "FORKBEARD": "Forkbeard", "SAITHE": "Saithe", "LYTHE": "Lythe",
    "SQUID": "Squid", "ATLANTIC HALIBUT": "Halibut", "WHITING U/R": "Whiting", "POLLACK": "Lythe"
  };
  function canonSpecies(raw) {
    const k = String(raw || "").toUpperCase().replace(/\s+/g, " ").trim();
    return SPECIES_CANON[k] || (raw ? String(raw).trim() : "");
  }
  // Abbreviated-code formats (JSD three-letter, Shetland four-letter)
  function mapSpeciesCode(code) {
    const C = (code || "").toUpperCase();
    if (/^RJ/.test(C)) return "Skate / Ray";
    const M = {
      ANF: "Monkfish", CAT: "Catfish", COD: "Cod", HAD: "Haddock", HKE: "Hake", HAL: "Halibut",
      LEM: "Lemon Sole", LEZ: "Megrim", LIN: "Ling", MUT: "Red Mullet", PLE: "Plaice", POK: "Saithe",
      TUR: "Turbot", WHG: "Whiting", WIT: "Witch", SQU: "Squid", SQR: "Squid", JOD: "John Dory", SRX: "Stingray",
      HADD: "Haddock", WHIT: "Whiting", WR: "Skate / Ray", SAI: "Saithe", MONK: "Monkfish", LING: "Ling",
      LYTH: "Lythe", MEG: "Megrim", WTS: "Witch", TUSK: "Tusk", HAKE: "Hake", CATS: "Catfish", SKS: "Skate / Ray",
      MIX: "Mixed", GUR: "Gurnard", JD: "John Dory", HAL2: "Halibut", LEM2: "Lemon Sole", PLE2: "Plaice"
    };
    return M[C] || code;
  }

  /* ------------------------------------------------------------------ *
   * Buyer canonicalisation (cross-note name variants)
   * ------------------------------------------------------------------ */
  const BUYER_CANON = {
    "WHITELINK SEAFOODS LTD": "Whitelink Seafoods",
    "GT SUSTAINABLE": "GT Sustainable Seafoods", // safety net if the wrapped "Seafoods" fragment is lost
    "TOPSAIL FISH PRODUCTS": "Topsail Fish Products Ltd",
    "TOP SAIL": "Top Sail",
    // One firm printed two ways on Don Fishing notes. Left split, it cost
    // about a third of their volume in any buyer analysis AND understated
    // their price, because the short-name rows were the strongest of the lot.
    // Merged in the database Aug 2026; this is what stops the next note
    // reintroducing it.
    "J SMITH": "Messrs J Smith Ltd",
    "J SMITH LTD": "Messrs J Smith Ltd",
    "MESSRS J SMITH": "Messrs J Smith Ltd"
  };
  function canonBuyer(raw) {
    const r = String(raw || "").replace(/\s+/g, " ").trim();
    return BUYER_CANON[r.toUpperCase()] || r;
  }

  /* Vessel labels. Same failure as buyers: the label is built from whatever
   * the note printed, so one boat can end up under two names and split its own
   * record. "BOYJOHN INS110" — the space dropped — held 6 landings and
   * £556,164 apart from "BOY JOHN INS110", which made a pair boat look like it
   * landed 25 trips against its partner's 31 when both ran 31.
   *
   * The convention is NAME REG ("AUDACIOUS BF83"). Notes that print only the
   * name are mapped up to the full label so they cannot drift apart later. */
  const VESSEL_CANON = {
    "BOYJOHN INS110": "BOY JOHN INS110",
    "BOY JOHN": "BOY JOHN INS110",
    "ROSEBLOOM": "ROSEBLOOM INS353",
    "FAITHLIE": "FAITHLIE FR220",
    "GUIDING LIGHT": "GUIDING LIGHT H90",
    "AUDACIOUS": "AUDACIOUS BF83"
  };
  function canonVessel(raw) {
    const r = String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
    return VESSEL_CANON[r] || r;
  }

  /* ------------------------------------------------------------------ *
   * Don Fishing "SALES NOTE" parser
   * ------------------------------------------------------------------ */
  // Slash-token: SPECIES/PRES/GRADE. Grade may contain "+" (A+1..A+5) — the
  // "+" in the class below is what keeps A+ grades from being silently dropped.
  const SLASH_TOKEN = /\/[A-Z]+\/[A-Z0-9+]+$/;

  // Header / layout words that can never be a wrapped-buyer fragment.
  const FRAG_STOP = new Set(["SALES", "NOTE", "COMPANY", "VESSEL", "REGISTRATION", "NUMBER", "NAME",
    "LANDED", "CONSIGNED", "PORT", "DATE", "SOLD", "BUYER", "SPECIES", "PRESENTATION", "GRADE",
    "UNITS", "TOTAL", "WT", "COST", "VALUE", "PAGE", "CARRIED", "FORWARD", "OF", "THE", "DON",
    "FISHING", "PETERHEAD", "SCRABSTER", "ULLAPOOL", "KINLOCHBERVIE", "LERWICK", "UNSOLD"]);

  // A wrapped-buyer continuation: 1-3 name words (no digits) under the data
  // row, optionally carrying that row's MSC code (e.g. "Seafoods MSC-F-31244").
  function buyerFragment(line) {
    if (!line) return null;
    const msc = /MSC-F-\d+/.test(line);
    const txt = line.replace(/MSC-F-\d+/g, "").replace(/\s+/g, " ").trim();
    if (!txt) return msc ? { frag: "", msc } : null;        // bare MSC code line
    if (/\d/.test(txt)) return null;                        // any digit -> not a name fragment
    const words = txt.split(" ");
    if (words.length > 3) return null;
    for (const w of words) {
      const W = w.replace(/[^A-Za-z]/g, "").toUpperCase();
      if (!W || FRAG_STOP.has(W)) return null;
      if (!/^[A-Za-z][A-Za-z&.'()-]*$/.test(w)) return null;
    }
    return { frag: txt, msc };
  }

  /* A row whose SPECIES cell wrapped onto the next line.
   *
   * The note is a fixed-width print and the species/grade cell is the widest
   * thing on the row, so a long buyer name plus a long token pushes the tail
   * of the token onto a second line. THE FIGURES STAY WITH THE FIRST LINE,
   * which is what makes this so quiet — the row looks complete except that
   * there is no slash-token to anchor on, so parseDonLine returns null and the
   * whole row is dropped without a trace:
   *
   *     GT Seafoods Saithe 1.00 40 56.40 40 56.40
   *     Coley/GUT/A+4
   *
   * An A+ grade is ONE CHARACTER wider than a plain A grade, which is enough
   * to trigger the wrap — so in practice this loses A+ rows and nothing else.
   * Measured on the real Audacious note of 13-08-2026: 13 boxes and £2,241.80
   * missing, every one an A+ row, on a note that otherwise reconciled to the
   * penny on 13 of its 15 species.
   *
   * The continuation may ALSO carry the tail of the buyer name, because both
   * cells wrap onto the same line:
   *
   *     Topsail Fish Products Pollock 1.00 40 299.20 40 299.20
   *     Ltd Lyth/GUT/A+2
   *
   * so the part before the slash-token is handed back separately and appended
   * to the BUYER. Leaving it in front of the species would break the
   * SPECIES_PREFIX match that rebuilds "Pollock Lyth", and the row would come
   * out as species "Lyth" with the buyer swallowing "Pollock".
   *
   * Note buyerFragment() cannot pick these up: it rejects anything containing
   * a digit, and "Coley/GUT/A+4" has one. That is why the row vanished rather
   * than corrupting the buyer above it. */
  const MONEY_TOKEN = /[\d,]+\.\d{2}/;
  function speciesWrap(line) {
    if (!line) return null;
    const txt = line.replace(/MSC-F-\d+/g, "").replace(/\s+/g, " ").trim();
    // Figures never wrap — they stay on the row itself. A line carrying money
    // is a real row, not a fragment of one.
    if (!txt || MONEY_TOKEN.test(txt)) return null;
    const words = txt.split(" ");
    let sp = -1;
    for (let i = 0; i < words.length; i++) { if (SLASH_TOKEN.test(words[i])) { sp = i; break; } }
    if (sp === -1) return null;
    return {
      frag: words.slice(0, sp).join(" "),      // tail of the buyer name, if any
      tail: words.slice(sp).join(" "),         // tail of the species token
      msc: /MSC-F-\d+/.test(line),
    };
  }

  /* THE CONTINUATION CAN BE ON THE NEXT PAGE — 1.3.5, Aug 2026.
   *
   * 1.3.3 rejoined a species cell that wrapped onto the next LINE. When the row
   * is the last one on a page, its tail wraps onto the next PAGE instead, and
   * lands seventeen lines away behind the page total, the carried-forward line,
   * the page number and the whole header block of the following page:
   *
   *     G&J Jack Seafoods Ltd Pollock 1.00 12 54.24 12 54.24   <- foot of p11
   *     PAGE TOTAL 166.00 5,944 9,479.95
   *     CARRIED FORWARD 1269.25 45,787 150,756.02
   *     PAGE 11 OF 13
   *     ... eleven lines of page-12 header ...
   *     Lyth/GUT/A+2                                           <- head of p12
   *
   * Looking only at i+1 finds "PAGE TOTAL" and gives up, so the row is dropped
   * exactly as before the 1.3.3 fix. Found on the Audacious note of 28-08-2026:
   * one box, 12 kg, £54.24, on a note otherwise out by nothing at all.
   *
   * THE SCAN STOPS AT ANYTHING THAT IS NOT PAGE FURNITURE, which is what makes
   * it safe. It cannot reach past another data row and steal that row's
   * continuation: the moment a line is not recognisably a header, a page total
   * or blank, the search is over. Reusing FRAG_STOP means the furniture list is
   * the one already proven against these notes rather than a second one that
   * can drift from it. */
  /* HOW FAR AHEAD THE TAIL MAY BE, and what stops the search.
   *
   * NOT a list of header words. My first attempt whitelisted page furniture and
   * it failed on "NAME OF FISH SALES COMPANY" and on the date "28-Aug-2026" —
   * FISH and AUG were not in the list. That kind of vocabulary rots: the next
   * vessel name or month breaks it silently, which is the very failure mode
   * this whole area keeps producing.
   *
   * The stop condition is structural instead. A continuation always follows its
   * own row, so anything between an unparsed row and the next PARSEABLE row
   * belongs to that unparsed row. Scan forward until either the tail turns up
   * or a real data row does — page totals, carried-forward lines and header
   * blocks all parse as nothing, so they are skipped without being enumerated.
   *
   * Bounded at 20 lines so a malformed note cannot walk the document. */
  function findSpeciesWrap(allLines, i) {
    for (let j = i + 1; j < allLines.length && j <= i + 20; j++) {
      const w = speciesWrap(allLines[j]);
      if (w) return { w, at: j };
      if (parseDonLine(allLines[j])) return null;   // the next real row: too far
    }
    return null;
  }

  // Put the wrapped token back on the end of the head, in front of the
  // figures, so parseDonLine sees the row exactly as it would unwrapped.
  function joinSpeciesWrap(line, w) {
    const m = line.match(/^(.*?)(\s+[\d,]+\.\d{2}\s+\d+\s+[\d,]+\.\d{2}\s+[\d,]+\s+[\d,]+\.\d{2})$/);
    return m ? m[1] + " " + w.tail + m[2] : null;
  }

  function parseDonLine(line) {
    // Defensive: pdf.js sometimes merges a row's MSC code into the start of
    // the NEXT row's line. Strip it and report so the caller can flag the
    // previous row as MSC.
    let mscLeading = false, body = line;
    const lm = body.match(/^((?:MSC-F-\d+\s+)+)(.*)$/);
    if (lm) { mscLeading = true; body = lm[2]; }

    /* A STARRED PRICE. The office flags a figure with a leading '*', and on a
     * fixed-width print the star costs a character — so a price that would
     * read 2343.75 comes out as "*2343." with the pence pushed off the end:
     *
     *   AG D Duff & Partners Halibut/GUT/U9 1.00 188 *2343. 188 2,343.75
     *
     * The old pattern wanted [\d,]+\.\d{2} in the cost column, got neither the
     * digits nor the star, and dropped the whole row. Found by Colin on the
     * Beryl note of 11-08-2026, where that one halibut row IS the entire
     * £2,343.75 the landing was short.
     *
     * So the cost column now tolerates a star and truncated pence, and the
     * value column tolerates a star too — the flag can land on either, and it
     * is a marker rather than part of the number (num() strips it).
     *
     * The TRUNCATION still loses real precision, so a starred or short price
     * is recomputed from the value below rather than trusted. */
    const m = body.match(/^(.*?)\s+([\d,]+\.\d{2})\s+(\d+)\s+(\*?[\d,]+\.\d{0,2})\s+([\d,]+)\s+(\*?[\d,]+\.\d{2})$/);
    if (!m) return null;
    const [, head, nbox, wt, cost, twt, val] = m;
    if (!SLASH_TOKEN.test(head)) return null;
    const words = head.split(" ");
    // Anchor on the slash-token (never on species words) so buyers that start
    // with a species word ("Blue Sea Products") aren't mistaken for species.
    let sp = -1;
    for (let i = 0; i < words.length; i++) { if (SLASH_TOKEN.test(words[i])) { sp = i; break; } }
    if (sp === -1) return null;
    // Absorb preceding word(s) only when they complete a known multi-word
    // species (right-to-left match against SPECIES_PREFIX sequence).
    const headWord = (words[sp].split("/")[0] || "").toUpperCase();
    const seq = SPECIES_PREFIX[headWord];
    if (seq) {
      let k = sp, ok = true;
      for (let j = seq.length - 1; j >= 0; j--) {
        const prev = words[k - 1];
        if (prev && prev.toUpperCase() === seq[j]) k--; else { ok = false; break; }
      }
      if (ok) sp = k;
    }
    const buyer = words.slice(0, sp).join(" ").trim();
    const parts = words.slice(sp).join(" ").split("/");
    const boxes = num(nbox), twt2 = num(twt), val2 = num(val);
    // A starred or truncated price has lost its pence on the print, so take it
    // from the value instead — that column is unstarred and exact. Everything
    // else keeps the figure the note actually shows.
    const costShort = /\*/.test(cost) || !/\.\d{2}$/.test(cost);
    const ppb = costShort && boxes ? round2(val2 / boxes) : num(cost);
    return {
      buyer, species: parts[0] || "", species_canon: canonSpecies(parts[0]),
      presentation: parts[1] || "", grade: parts[2] || "", quality: "",
      boxes, box_weight: num(wt), price_per_box: ppb,
      total_weight: twt2, total_value: val2,
      price_per_kg: twt2 ? round2(val2 / twt2) : 0, msc: false, _mscLeading: mscLeading
    };
  }

  function parseDon(allLines) {
    const rows = [];
    let lastRow = null;
    for (let i = 0; i < allLines.length; i++) {
      let r = parseDonLine(allLines[i]);
      let wrapFrag = "";
      // The species cell wrapped: rebuild the row from this line and the next,
      // and consume the continuation so it is not read again below.
      if (!r) {
        const found = findSpeciesWrap(allLines, i);
        if (found) {
          const joined = joinSpeciesWrap(allLines[i], found.w);
          const r2 = joined && parseDonLine(joined);
          /* Blank the continuation where it lies rather than stepping the
             cursor over it — across a page break the lines between are real
             header lines that must still be read for what they are, and i++
             would swallow them. */
          if (r2) {
            r = r2; wrapFrag = found.w.frag;
            if (found.w.msc) r.msc = true;
            allLines = allLines.slice();
            allLines[found.at] = "";
          }
        }
      }
      if (r) {
        if (r._mscLeading && lastRow) lastRow.msc = true;
        delete r._mscLeading;
        if (wrapFrag) r.buyer = (r.buyer + " " + wrapFrag).replace(/\s+/g, " ").trim();
        rows.push(r); lastRow = r;
        continue;
      }
      // Wrapped buyer / MSC continuation belongs to the row above — including
      // across a page break (header lines in between never match buyerFragment).
      const f = buyerFragment(allLines[i]);
      if (f && lastRow) {
        if (f.frag) lastRow.buyer = (lastRow.buyer + " " + f.frag).replace(/\s+/g, " ").trim();
        if (f.msc) lastRow.msc = true;
      }
    }
    for (const r of rows) r.buyer = canonBuyer(r.buyer);

    // ---- meta ----
    let saleNo = "", iso = "", port = "Peterhead";
    const M = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    for (const ln of allLines) {
      let m = ln.match(/\b(33\d{5})\b/); if (m && !saleNo) saleNo = m[1];
      m = ln.match(/(\d{1,2})[-/]([A-Za-z]{3})[A-Za-z]*[-/](\d{2,4})/);
      if (m && M[m[2].toLowerCase()] && !iso) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; iso = `${y}-${M[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`; }
      for (const p of ["Peterhead", "Scrabster", "Ullapool", "Kinlochbervie", "Lerwick"]) if (ln.includes(p)) port = p;
    }
    const consigned = /\bConsigned\b/i.test(allLines.join(" "));
    const headerText = allLines.slice(0, 18).join("  ");
    const vessel = detectVessel(headerText) || detectVessel(allLines.join("  "));
    return { rows, meta: { saleNo, isoDate: iso, port, vessel, consigned }, reconcile: reconcileDon(allLines, rows) };
  }

  // Printed control totals: last "TOTAL <boxes> <wt> <value>" line of the note.
  function reconcileDon(allLines, rows) {
    let exp = null;
    for (const ln of allLines) {
      const m = ln.match(/(?:^|\s)TOTAL\s+([\d,]+\.\d{2})\s+([\d,]+)\s+([\d,]+\.\d{2})\s*$/);
      if (m && !/CARRIED|PAGE/i.test(ln)) exp = { boxes: num(m[1]), weight: num(m[2]), value: num(m[3]) };
    }
    return buildReconcile(exp, rows);
  }
  // valueTol: Hanstholm converts each row DKK->GBP and rounds to 2dp, so its
  // printed grand total can drift from the row sum by up to ~0.005/row.
  function buildReconcile(exp, rows, valueTol) {
    const act = {
      boxes: round2(rows.reduce((s, r) => s + r.boxes, 0)),
      weight: round2(rows.reduce((s, r) => s + r.total_weight, 0)),
      value: round2(rows.reduce((s, r) => s + r.total_value, 0))
    };
    if (!exp) return { found: false, ok: false, expected: null, actual: act, diffs: null };
    const diffs = { boxes: round2(act.boxes - exp.boxes), weight: round2(act.weight - exp.weight), value: round2(act.value - exp.value) };
    const tol = valueTol || 0;
    return { found: true, ok: !diffs.boxes && !diffs.weight && Math.abs(diffs.value) <= tol, expected: exp, actual: act, diffs };
  }

  // P&J Johnstone prints a PHYSICAL box count (part-boxes rounded up to whole
  // boxes), whereas the summable "No Boxes" column is fractional, so the two
  // never tie out. Reconcile on weight + value (which match to the penny) and
  // report the box gap for information only.
  function reconcilePJJ(exp, rows) {
    const act = {
      boxes: round2(rows.reduce((s, r) => s + r.boxes, 0)),
      weight: round2(rows.reduce((s, r) => s + r.total_weight, 0)),
      value: round2(rows.reduce((s, r) => s + r.total_value, 0))
    };
    if (!exp) return { found: false, ok: false, expected: null, actual: act, diffs: null };
    const diffs = { boxes: round2(act.boxes - exp.boxes), weight: round2(act.weight - exp.weight), value: round2(act.value - exp.value) };
    return {
      found: true,
      ok: !diffs.weight && Math.abs(diffs.value) <= 0.01,
      expected: exp, actual: act, diffs, boxBasis: "physical"
    };
  }

  /* ------------------------------------------------------------------ *
   * Vessel detection ("<NAME> <REG>" anywhere in text)
   * ------------------------------------------------------------------ */
  const VESSEL_STOP = new Set(["DON", "FISHING", "COMPANY", "CO", "LTD", "LIMITED", "DUNCAN", "VESSEL", "REGISTRATION",
    "NUMBER", "NAME", "NAMES", "SALES", "SALE", "AND", "OF", "FISH", "THE", "PD", "SC", "ULL", "KLB", "KBV", "NOTE", "LANDED",
    "CONSIGNED", "PORT", "DATE", "SOLD", "BUYER", "SPECIES", "PRESENTATION", "GRADE", "UNITS", "TOTAL", "MSC", "GUT", "WHL",
    "WF", "ROE", "PETERHEAD", "SCRABSTER", "ULLAPOOL", "LERWICK", "KINLOCHBERVIE", "VALUE", "COST"]);
  function detectVessel(text) {
    if (!text) return "";
    const T = " " + text.toUpperCase().replace(/\s+/g, " ") + " ";
    const re = /\b([A-Z]{2,4})\s?(\d{1,4})\b/g;
    let m;
    while ((m = re.exec(T))) {
      const regLetters = m[1];
      if (VESSEL_STOP.has(regLetters)) continue;
      const before = T.slice(0, m.index).trim().split(" ");
      const name = [];
      for (let i = before.length - 1; i >= 0 && name.length < 3; i--) {
        const w = before[i].replace(/[^A-Z]/g, "");
        if (!w || VESSEL_STOP.has(w) || !/^[A-Z]+$/.test(w)) break;
        name.unshift(w);
      }
      if (name.length >= 1) return name.join(" ") + " " + regLetters + m[2];
    }
    return "";
  }

  /* ------------------------------------------------------------------ *
   * Hanstholm (fiskeauktion.dk "My sales")
   * ------------------------------------------------------------------ */
  function parseHanstholm(allLines) {
    const rows = []; const meta = { port: "Hanstholm" };
    let exp = null;
    const M = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
    for (const ln of allLines) {
      let m = ln.match(/My sales \w+,\s*(\w+)\s+(\d+),\s*(\d{4})/);
      if (m) meta.isoDate = `${m[3]}-${M[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
      // Vessel header e.g.  BF 83 "Audacious"  ->  AUDACIOUS BF83
      m = ln.match(/([A-Z]{1,4})\s?(\d{1,4})\s*"([^"]+)"/);
      if (m && !meta.vessel) meta.vessel = m[3].trim().toUpperCase() + " " + m[1] + m[2];
      m = ln.match(/"([^"]+)"/);
      if (m && !meta.vessel) meta.vessel = m[1].trim().toUpperCase();
      m = ln.match(/GBP:\s*([\d.]+)\s*\/\s*100 DKK/); if (m) meta.rate = m[1];
      m = ln.match(/Kilo:\s*([\d,]+\.?\d*)\s+Boxes:\s*(\d+)\s+Avg:\s*([\d.]+)\s*GBP\s+Price:\s*([\d,]+\.\d+)/);
      if (m) { meta.totKilo = m[1]; meta.totBoxes = m[2]; meta.totPrice = m[4]; exp = { boxes: num(m[2]), weight: num(m[1]), value: num(m[4]) }; }
      if (/^Hanstholm\s/.test(ln)) {
        const body = ln.replace(/\s+27\.\d\.[A-Z](\s+GBP)?\s*$/, "").trim();
        // Grade may arrive fully-spaced from pdf.js ("A 1 T M S", "A 2 T - S").
        const mm = body.match(/^Hanstholm\s+(.+?)\s+([AEB][\dA-Z\s-]*?)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+\.\d+)$/);
        if (mm) {
          const [, species, gradeRaw, boxes, boxWt, , totalKg, pricePerKg, totalVal] = mm;
          const code = gradeRaw.replace(/\s+/g, "");
          if (/^[AEB]\d[A-Z]/.test(code)) {
            rows.push({
              buyer: "Hanstholm Auction", species: species.trim(), species_canon: canonSpecies(species),
              presentation: "", grade: code[0] + code[1], fullCode: code, quality: code[0],
              boxes: num(boxes), box_weight: num(boxWt), price_per_box: 0,
              total_weight: num(totalKg), price_per_kg: num(pricePerKg),
              total_value: num(totalVal), msc: /MS$/.test(code)
            });
          }
        }
      }
    }
    return { rows, meta, reconcile: buildReconcile(exp, rows, 0.005 * rows.length + 0.01) };
  }

  /* ------------------------------------------------------------------ *
   * John S Duncan "Supplier Transactions" (coordinate-based)
   * ------------------------------------------------------------------ */
  function parseJSD(pages) {
    const rows = []; const meta = { port: "Scrabster" };
    const CANON = {
      "SCRABSTE": "Scrabster Seafoods", "R SEAFOODS": "Scrabster Seafoods", "SCRABSTER SEAFOODS": "Scrabster Seafoods",
      "CAMPBELL": "Campbells Prime Meat", "S PRIME MEAT": "Campbells Prime Meat", "CAMPBELLS PRIME MEAT": "Campbells Prime Meat",
      "BELLS SEAFOOD": "Bells Seafood", "GT SEAFOODS": "GT Seafoods", "H&D CALDER": "H&D Calder", "HOLBORN FISHING": "Holborn Fishing",
      "JPL SHELLFISH": "JPL Shellfish", "OCHIL FOODS LTD": "Ochil Foods Ltd", "PENTLAND SEAFOODS": "Pentland Seafoods",
      "PIEROWALL FISH": "Pierowall Fish", "THOMSON INT": "Thomson Int", "WHITELINK": "Whitelink"
    };
    function cleanBuyer(raw) {
      let r = (raw || "").toUpperCase().trim();
      for (const frag of ["CAMPBELL", "SCRABSTE"]) if (r.endsWith(" " + frag)) r = r.slice(0, -(frag.length + 1)).trim();
      for (const key of ["R SEAFOODS", "S PRIME MEAT"]) if (r.startsWith(key)) return CANON[key];
      for (const key in CANON) { if (r === key || r.startsWith(key + " ")) return CANON[key]; }
      return raw ? raw.replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, " ").trim() : "";
    }
    const dataRe = /^(\d+)\s+(\d{6})\s+([A-Z]{3})\s+(MSC\s+)?(GUT|WHL|WF|ROE)\s+([A-Z])\s+(\d+)\s+(?:[a-c]\s+)?(\d+)\s+([\d.]+)\s+([\d,]+\.\d{2}|[\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+\.\d{2})$/;
    let exp = null;
    for (const page of pages) {
      const dataWords = page.words.filter(w => w.x < 760);
      const buyerWords = page.words.filter(w => w.x >= 760);
      const byY = {}; for (const w of dataWords) { const k = Math.round(w.y / 2) * 2; (byY[k] = byY[k] || []).push(w); }
      const buyerY = {}; for (const w of buyerWords) { const k = Math.round(w.y / 2) * 2; (buyerY[k] = buyerY[k] || []).push(w); }
      const dataRows = [];
      for (const k of Object.keys(byY).map(Number).sort((a, b) => a - b)) {
        const line = byY[k].sort((a, b) => a.x - b.x).map(w => w.str).join(" ");
        let m = line.match(/Salesdate\s*:\s*(\d+)\/(\d+)\/(\d{4})/);
        if (m) meta.isoDate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        let vm = line.match(/^[A-Z]?\d+\s*-\s*([A-Z][A-Z .'&]+?)\s+([A-Z]{2,3}\d+)\s+(Seine|Trawl|Net|Gill|Pots|Dredge)/i);
        if (vm && !meta.vessel) meta.vessel = (vm[1].trim() + " " + vm[2]).toUpperCase();
        const tm = line.match(/Total\s*:?\s+([\d,]+)\s+([\d,]+\.?\d*)\s*Kg\s+([\d,]+\.\d{2})/i);
        if (tm) exp = { boxes: num(tm[1]), weight: num(tm[2]), value: num(tm[3]) };
        const dm = line.match(dataRe);
        if (dm) dataRows.push({ y: k, m: dm });
      }
      const ys = dataRows.map(d => d.y);
      dataRows.forEach((d, idx) => {
        const lo = d.y - 6, hi = idx + 1 < ys.length ? ys[idx + 1] - 6 : d.y + 40;
        let bt = [];
        for (const k of Object.keys(buyerY).map(Number).sort((a, b) => a - b)) {
          if (k >= lo && k < hi) bt = bt.concat(buyerY[k].sort((a, b) => a.x - b.x).map(w => w.str));
        }
        const g = d.m;
        const tv = num(g[13]);
        rows.push({
          buyer: cleanBuyer(bt.join(" ").trim()), species: mapSpeciesCode(g[3]), species_canon: canonSpecies(mapSpeciesCode(g[3])), spcode: g[3],
          presentation: g[5], grade: g[6] + g[7], quality: "", msc: !!g[4],
          boxes: num(g[8]), box_weight: num(g[9]),
          total_weight: num(g[10]), price_per_box: 0,
          price_per_kg: num(g[12]), total_value: tv
        });
      });
    }
    return { rows, meta, reconcile: buildReconcile(exp, rows) };
  }

  /* ------------------------------------------------------------------ *
   * P&J Johnstone "Registered Seller Sales Note"
   * ------------------------------------------------------------------ */
  // Coordinate-based buyer column (mirrors parseJSD). itemsToLines buckets
  // words by y, but on these notes the Buyers-Name text is vertically CENTRED
  // in each (often two-line) row, so on wrapped rows it lands ~1px off the
  // numeric baseline and drops out of the merged data line entirely -> blank
  // buyer. Here we anchor each row on the Withdrawn Y/N flag (exactly one per
  // row, x~467) and take the buyer from the Name column (x 500-634) by nearest
  // band, using only the primary (topmost) name line so the resulting string
  // matches the historic single-line extraction. Returns one raw buyer per
  // data row in reading order.
  function pjjBuyersByRow(pages) {
    const out = [];
    for (const page of (pages || [])) {
      const flags = page.words.filter(w => w.x >= 458 && w.x <= 478 && /^[NY]$/.test(w.str))
        .map(w => w.y).sort((a, b) => a - b);
      const names = page.words.filter(w => w.x >= 500 && w.x < 634);
      for (let i = 0; i < flags.length; i++) {
        const y = flags[i], yNext = i + 1 < flags.length ? flags[i + 1] : y + 40;
        const band = names.filter(w => w.y >= y - 6 && w.y < yNext - 6);
        if (!band.length) { out.push(""); continue; }
        const topY = Math.min(...band.map(w => w.y));                 // primary name line
        const line = band.filter(w => Math.abs(w.y - topY) <= 2).sort((a, b) => a.x - b.x);
        out.push(line.map(w => w.str).join(" ").trim());
      }
    }
    return out;
  }

  function parsePJJ(allLines, pages) {
    const rows = []; const meta = { port: "Peterhead" }; let exp = null;
    // Precompute the column-derived buyer for each data row. Only trust it when
    // its count matches the number of data rows the line-regex will find, so a
    // layout we haven't seen can never mis-shift buyers (falls back to mm[11]).
    const coordBuyers = pjjBuyersByRow(pages);
    let rxCount = 0; { const _rx = /^(.+?)\s+(GH|WF)\s+([A-Z]?\d|U9)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([BL])\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+(.+))?$/;
      for (const ln of allLines) if (_rx.test(ln)) rxCount++; }
    const useCoord = coordBuyers.length === rxCount && rxCount > 0;
    let ri = 0;
    const KNOWN = ["G T SEAFOODS", "A THOMPSON JNR LTD", "COLIN FRASER LTD", "A.G.D. DUFF & PARTNERS", "SUSTAINABLE SEAFOODS",
      "STEPHEN BUCHAN LTD", "WM MITCHELL", "SEAFOOD SOURCING", "DUTHIE AND SUMMERS", "WHITELINK", "SEAFOOD ECOSSE LTD",
      "FLATFISH LTD", "CALADERO SCOTLAND", "GEORGE DOWNIE", "SUPERDON LTD", "J S FISH", "SKATERAW FISHERIES", "JOHN H MILNE PD LTD",
      "LUNAR FREEZING AND COLD STORAGE", "K & A PIRIE", "G GRIEVE T/A GARFISH", "COUPERS S/F", "PINDARUS FISHING", "ATLANTIC SEAFISH",
      "M GEDDES LIMITED", "NOLAN SEAFOODS", "BLUE SEA PRODUCTS", "ROBERT W HENDERSON", "MCCONNELL SEAFOODS", "KEN CASSELLS LTD",
      "TOPSAIL FISH PRODUCTS", "G & J JACK SEAFOODS LTD", "J CHARLES SEAFOODS", "ROBERT W HENDERSON LTD", "SEAFOOD ECOSSE"];
    function matchBuyer(raw) {
      const r = (raw || "").toUpperCase();
      let best = null, bl = 0;
      for (const b of KNOWN) { if (r.startsWith(b) && b.length > bl) { best = b; bl = b.length; } }
      if (best) return best.replace(/\b\w+/g, w => w.length <= 3 && /^[A-Z.&]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
      // Address always follows the buyer name, so a leading number is part of
      // the name ("1ST CHOICE FISH") — only stop on a number/address word once
      // at least one name word has been taken.
      const words = (raw || "").split(" "); const out = [];
      for (const w of words) { if (out.length && (/^\d/.test(w) || ["UNIT", "HARBOUR", "RAIK", "STEAMBOAT", "CRAIGSHAW", "VOLLUM", "EAST", "BON", "OLD", "WILSON", "SEAGATE"].includes(w))) break; out.push(w); if (out.length >= 4) break; }
      return out.join(" ");
    }
    function classifyMsc(B) {
      B = (B || "").replace(/[()]/g, "").trim().toUpperCase();
      if (/\d/.test(B) || B === "UK" || B === "EU" || B.length < 3) return null;
      if (/RND HADD|RD HADD/.test(B)) return "Haddock (round)";
      if (/HADD/.test(B)) return "Haddock";
      if (/RND WHIT|RD WHIT/.test(B)) return "Whiting (round)";
      if (/WHIT/.test(B)) return "Whiting";
      if (/HAKE/.test(B)) return "Hake";
      if (/PLAICE/.test(B)) return "Plaice";
      if (/SANDA|SAND EEL/.test(B)) return "Sandeel";
      if (/MONK/.test(B)) return "Monkfish";
      if (/SAITHE|COLEY/.test(B)) return "Saithe";
      if (/LING/.test(B)) return "Ling";
      if (/LEMON/.test(B)) return "Lemon Sole";
      if (/COD/.test(B)) return "Cod";
      return B.replace(/\b\w+/g, w => w.charAt(0) + w.slice(1).toLowerCase());
    }
    function speciesMsc(lines, i) {
      let m = lines[i].match(/MSC-F-\d+\s*\(\s*([A-Z][A-Z ]*?)\s*\)/);
      let r = m ? classifyMsc(m[1]) : null;
      if (r) return r;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        if (/MSC-F-\d+.*\b(GH|WF)\b.*\d+\.\d{2}/.test(lines[j])) break;
        const bm = lines[j].match(/^\(?\s*(R?N?D?\s*(?:HADD|WHIT|HAKE|PLAICE|MONK|SAITHE|COD|LING|LEMON)[A-Z ]*?)\s*\)/i);
        if (bm) { const c = classifyMsc(bm[1]); if (c) return c; }
      }
      return "MSC species";
    }
    const PLAIN = {
      COD: "Cod", LING: "Ling", SAITHE: "Saithe", MONKS: "Monkfish", MONK: "Monkfish", MEGRIMS: "Megrim", MEGRIM: "Megrim",
      "LEMON SOLE": "Lemon Sole", HALIBUT: "Halibut", SQUID: "Squid", CATFISH: "Catfish", LYTHE: "Lythe", PLAICE: "Plaice", HAKE: "Hake", TURBOT: "Turbot"
    };
    const rx = /^(.+?)\s+(GH|WF)\s+([A-Z]?\d|U9)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([BL])\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+(.+))?$/;
    for (let i = 0; i < allLines.length; i++) {
      const ln = allLines[i];
      let m = ln.match(/Sales Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) meta.isoDate = `${m[3]}-${m[2]}-${m[1]}`;
      let vm = ln.match(/Vessel Name:\s*(.+?)\s*$/);
      if (vm && !meta.vessel) meta.vessel = vm[1].trim().toUpperCase();
      const tot = ln.match(/Totals:\s*([\d,]+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
      if (tot) exp = { boxes: num(tot[1]), weight: num(tot[2]), value: num(tot[3]) };
      const mm = ln.match(rx);
      if (!mm) continue;
      const sptok = mm[1], pres = mm[2], grade = mm[3], nbox = mm[4], boxwt = mm[6], totwt = mm[7], up = mm[9], actual = mm[10];
      const buyer = useCoord ? (coordBuyers[ri] || mm[11] || "") : (mm[11] || "");
      ri++;
      const isMsc = /MSC-F/.test(sptok);
      let species;
      if (isMsc) species = speciesMsc(allLines, i);
      else { const r = sptok.toUpperCase().trim(); species = PLAIN[r] || (sptok.charAt(0) + sptok.slice(1).toLowerCase()); }
      const tv = num(actual), tw = num(totwt);
      rows.push({
        species, species_canon: canonSpecies(species), msc: isMsc, presentation: pres, grade, quality: "",
        boxes: num(nbox), box_weight: num(boxwt),
        total_weight: tw, price_per_box: num(up), total_value: tv,
        price_per_kg: tw ? round2(tv / tw) : 0, buyer: matchBuyer((buyer || "").trim())
      });
    }
    return { rows, meta, reconcile: reconcilePJJ(exp, rows) };
  }

  /* ------------------------------------------------------------------ *
   * Shetland Seafood Auctions "Supplier transactions"
   * ------------------------------------------------------------------ */
  function parseShetland(allLines) {
    const rows = []; const meta = { port: "Shetland" };
    let exp = null;
    for (const ln of allLines) {
      const dm0 = ln.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (dm0) meta.isoDate = `${dm0[3]}-${dm0[2]}-${dm0[1]}`;
      // "Supplier: BF83 - AUDACIOUS" -> "AUDACIOUS BF83" (same label as Don notes)
      let vm = ln.match(/Supplier:\s*(?:([A-Z]+)\s?(\d+)\s*-\s*)?([A-Z][A-Z .'&]+?)\s*$/);
      if (vm && !meta.vessel) meta.vessel = (vm[3].trim() + (vm[1] ? " " + vm[1] + vm[2] : "")).toUpperCase();
      const tm = ln.match(/Total\s*:\s*(\d+)\s+([\d,]+\.?\d*)\s*Kg\s+([\d,]+\.\d{2})/i)
        || ln.match(/^\s*(\d+)\s+([\d,]+\.?\d*)\s*Kg\s+([\d,]+\.\d{2})\s+Total\s*$/i);
      if (tm) exp = { boxes: num(tm[1]), weight: num(tm[2]), value: num(tm[3]) };
      const dm = ln.match(/^(\d+)\s+(\d+)\s+([A-Z]{2,4})\s+(\d+)\s+(GH|WF)\s+(\d+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+(\D.*)$/);
      if (dm) {
        const [, , , spec, gr, pres, nbox, boxwgt, totkg, prbox, prkg, totprice, buyer] = dm;
        rows.push({
          species: mapSpeciesCode(spec), species_canon: canonSpecies(mapSpeciesCode(spec)), spcode: spec,
          grade: "G" + gr, presentation: pres, quality: "",
          boxes: num(nbox), box_weight: num(boxwgt), total_weight: num(totkg),
          price_per_box: num(prbox), price_per_kg: num(prkg), total_value: num(totprice),
          buyer: buyer.trim(), msc: false
        });
      }
    }
    return { rows, meta, reconcile: buildReconcile(exp, rows) };
  }

  /* ------------------------------------------------------------------ *
   * L.H.D. Limited (Lerwick) "Registered Seller Sale Note"
   * ------------------------------------------------------------------ */
  const LHD_SPECIES = { "HADD":"Haddock", "MEGRIMS":"Megrim", "MEGRIM":"Megrim", "MONKS":"Monkfish",
    "MONK":"Monkfish", "SOLE - LEMON":"Lemon Sole", "POLLACK":"Lythe" };
  function lhdSpecies(raw){
    const s = String(raw||"").replace(/-MSC\S*/i,"").replace(/\s+/g," ").trim();
    const up = s.toUpperCase();
    if (LHD_SPECIES[up]) return LHD_SPECIES[up];
    return canonSpecies(s);
  }
  function lhdBuyer(raw){
    return String(raw||"").replace(/^\d+\s+/,"").replace(/\s+\d+$/,"").replace(/\s+/g," ").trim();
  }
  function parseLHD(allLines){
    const rows=[]; const meta={ port:"Lerwick" };
    const RE=/^(.+?) ([A-Z]{2}) (\d) ([A-Z]) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d,]+\.\d{2}) (.+)$/;
    let exp=null;
    for(const ln of allLines){
      const m=ln.match(RE);
      if(m){
        const sp=m[1], pres=m[2], grad=m[3], fresh=m[4];
        const boxes=num(m[5]), tw=num(m[6]);
        rows.push({
          species: sp.trim(), species_canon: lhdSpecies(sp),
          presentation: pres, grade: grad, quality: fresh,
          boxes, box_weight: boxes? round2(tw/boxes):0, total_weight: tw,
          price_per_kg: num(m[7]), price_per_box: num(m[8]), total_value: num(m[9]),
          buyer: lhdBuyer(m[10]), msc: /-MSC/i.test(sp)
        });
        continue;
      }
      if(!meta.vessel){ const vm=ln.match(/Vessel\s+(.+?)\s+Port of Landing/i); if(vm) meta.vessel=detectVessel(vm[1])||vm[1].trim().toUpperCase(); }
      if(!meta.isoDate){ const dm=ln.match(/Date of Landing\s+(\d{2})\/(\d{2})\/(\d{4})/i); if(dm) meta.isoDate=`${dm[3]}-${dm[2]}-${dm[1]}`; }
      const tm=ln.match(/^(\d+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/); if(tm) exp={boxes:num(tm[1]),weight:num(tm[2]),value:num(tm[3])};
    }
    return { rows, meta, reconcile: buildReconcile(exp, rows) };
  }

  /* ------------------------------------------------------------------ *
   * Hanstholm "Afregning" self-billing settlement (printed, DKK)
   * ------------------------------------------------------------------ */
  function dkkNum(s){ return parseFloat(String(s).replace(/\./g,"").replace(",",".")); }
  function parseAfregning(allLines){
    const rows=[]; const meta={ port:"Hanstholm", currency:"DKK", needsRate:true };
    const M = { january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
                januar:"01",februar:"02",marts:"03",maj:"05",juni:"06",juli:"07",oktober:"10" };
    // pdf.js emits one row per line:
    //   <boxType> <boxes> <kg> <species[, MSC]> <E|A> <sort> <DKK/kg> <DKK amount> <buyer#>
    const RE=/^\d+\s+(\d+)\s+([\d.]+(?:,\d+)?)\s+(.+?)\s+([EA])\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s+\d+$/;
    let subtotal=null;
    for(const ln of allLines){
      const m=ln.match(RE);
      if(m){
        const b=parseInt(m[1],10), tw=dkkNum(m[2]);
        const rawSp=m[3].trim(), msc=/,?\s*MSC/i.test(rawSp), baseSp=rawSp.replace(/,?\s*MSC/ig,"").trim();
        rows.push({
          species: baseSp, species_canon: canonSpecies(baseSp),
          presentation:"", grade: m[5], quality: m[4],
          boxes: b, box_weight: b? round2(tw/b):0, total_weight: tw,
          price_per_kg: dkkNum(m[6]), price_per_box:0, total_value: dkkNum(m[7]),
          buyer:"Hanstholm Auction", msc, currency:"DKK"
        });
        continue;
      }
      // vessel: "<REG> "<NAME>""  — 1–4 letter port code so single-letter regs (e.g. H90) work
      if(!meta.vessel){ const vm=ln.match(/([A-Z]{1,4})\s?(\d{1,4})\s*"([^"]+)"/); if(vm) meta.vessel=vm[3].trim().toUpperCase()+" "+vm[1]+vm[2]; }
      if(!meta.isoDate){ const dm=ln.match(/(\d{1,2})\.\s+([A-Za-zæøå]+)\s+(\d{4})/i); if(dm && M[dm[2].toLowerCase()]) meta.isoDate=`${dm[3]}-${M[dm[2].toLowerCase()]}-${dm[1].padStart(2,"0")}`; }
      // The auction charges Salær on the gross fish value — our reconcile target.
      const sm=ln.match(/^Sal[æae]r\s+([\d.]+,\d{2})/i); if(sm) subtotal=dkkNum(sm[1]);
    }
    const actBoxes=rows.reduce((s,r)=>s+r.boxes,0);
    const actWt=round2(rows.reduce((s,r)=>s+r.total_weight,0));
    const exp = subtotal!=null ? { boxes:actBoxes, weight:actWt, value:subtotal } : null;
    meta.grossDkk = subtotal!=null ? subtotal : round2(rows.reduce((s,r)=>s+r.total_value,0));
    return { rows, meta, reconcile: buildReconcile(exp, rows, 0.01) };
  }

  // Convert a DKK-priced result (Afregning) to GBP using a user-entered day rate
  // (DKK per 1 GBP). Keeps the DKK originals on each row so the rate is editable.
  function applyFxRate(res, dkkPerGbp){
    const r = Number(dkkPerGbp);
    if(!r || !isFinite(r) || r<=0) return res;
    const conv = v => round2(v / r);
    const rows = res.rows.map(row => ({ ...row,
      value_dkk: row.value_dkk != null ? row.value_dkk : row.total_value,
      ppk_dkk: row.ppk_dkk != null ? row.ppk_dkk : row.price_per_kg,
      total_value: conv(row.value_dkk != null ? row.value_dkk : row.total_value),
      price_per_kg: conv(row.ppk_dkk != null ? row.ppk_dkk : row.price_per_kg),
      currency: "GBP"
    }));
    const ex = res.reconcile && res.reconcile.expected;
    const meta = { ...res.meta, currency:"GBP", fxRate:r };
    return { ...res, rows, meta,
      reconcile: buildReconcile(ex ? { boxes:ex.boxes, weight:ex.weight, value:conv(res.meta.grossDkk != null ? res.meta.grossDkk : ex.value) } : null, rows, 0.05) };
  }

  /* ------------------------------------------------------------------ *
   * Entry points
   * ------------------------------------------------------------------ */
  function parseExtracted({ allLines, pages, fullText }, filename) {
    if ((fullText || "").trim().length < 20) return { market: "Unscannable", rows: [], meta: {}, reconcile: buildReconcile(null, []), filename };
    const market = detectMarket(fullText);
    let parsed;
    if (market === "LHD \u00b7 Lerwick") parsed = parseLHD(allLines);
    else if (market === "Hanstholm Afregning") parsed = parseAfregning(allLines);
    else if (market === "Hanstholm") parsed = parseHanstholm(allLines);
    else if (market === "Shetland Auction") parsed = parseShetland(allLines);
    else if (market.startsWith("John S Duncan")) parsed = /Supplier Transactions/i.test(fullText) ? parseJSD(pages) : parseDon(allLines);
    else if (market.startsWith("P&J Johnstone")) parsed = parsePJJ(allLines, pages);
    else if (market.startsWith("Don Fishing")) parsed = parseDon(allLines);
    else return { market, rows: [], meta: {}, reconcile: buildReconcile(null, []), filename };
    // Seven places set meta.vessel across the parsers and several bypass
    // detectVessel, so the label is canonicalised HERE — the one point every
    // parser's result passes through — rather than at each of them.
    const meta = { ...parsed.meta, vessel: canonVessel(parsed.meta && parsed.meta.vessel) };
    return { market, rows: parsed.rows, meta, reconcile: parsed.reconcile, filename };
  }

  // data: ArrayBuffer | Uint8Array;  pdfjsLib: a pdf.js module (browser or node)
  async function parsePdf(data, pdfjsLib, filename) {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const extracted = await extractPages(pdf);
    return parseExtracted(extracted, filename);
  }

  return {
    VERSION, parsePdf, parseExtracted, extractPages, itemsToLines,
    detectMarket, detectVessel, canonSpecies, canonBuyer, canonVessel, mapSpeciesCode,
    parseDon, parseHanstholm, parseJSD, parsePJJ, parseShetland, parseLHD, parseAfregning, applyFxRate
  };
});
