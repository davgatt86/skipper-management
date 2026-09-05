/* THE AI READER — deployed as the `su-parse-document` Supabase edge function.
 *
 * THIS FILE HAD NEVER BEEN IN THE REPO. It was written in the Supabase console
 * and lived only there, so the prompts that decide how every settling sheet and
 * every invoice is read could not be diffed, reviewed or rolled back — the same
 * failure as the second parse-core copy, which ran 1.2.1 against this repo's
 * 1.3.2 for months because the version that mattered was on a server nobody
 * looked at. It is committed now; deploy with the Supabase MCP or the CLI, and
 * change it HERE first.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SETTLEMENT_PROMPT = `You are reading a fishing vessel "square up" / settling posting report (and possibly a crew wages posting report). Extract the data as JSON with this exact shape (numbers only, no currency symbols; income figures shown in brackets/negative on the sheet should be returned as POSITIVE):
{
  "reference": string|null,
  "settling_date": "YYYY-MM-DD"|null,
  "period": string|null,
  "boat_name": string|null,
  "total_income": number,
  "total_expenses": number,
  "total_recoveries": number,
  "crew_owners_share": number,
  "crew_wages_total": number,
  "owners_share": number,
  "difference": number,
  "cash_generated": number,
  "settling_vat": number,
  "trips": number|null,
  "days_at_sea": number|null,
  "fuel_used": number|null,
  "weight_landed": number|null,
  "lines": [ { "section": "income"|"expense"|"recovery", "label": string, "amount": number } ],
  "crew_payments": [ { "crew_code": string|null, "crew_name": string, "adv": number, "bond": number, "gear": number, "sundries": number, "add_tax": number, "tax": number, "gross": number, "net": number, "method": string|null } ]
}
Rules: the main Cash Generated figure is the one in the Owners Section (recoveries + owners share), not the VAT one. Deductions on crew wages reports are shown negative - return them as POSITIVE amounts. gross = TOTAL GROSS for that crew member, net = NET WAGE. crew_name: give the FULL name exactly as printed including any company prefix and the person's name (e.g. "FIRTHBRAE LTD, DAVID GATT"). crew_code: read carefully - it is usually a letter followed by 3 digits (e.g. G035, H033). Include every income/expense/recovery line that has a non-zero Amount of Settling; skip all-zero lines. amount = the "Amount of Settling" column as a positive number. If a crew wages report is not included, return crew_payments as []. Respond ONLY with the JSON object, no markdown fences, no commentary.`;

const BERYL_PROMPT = `You are reading a "BERYL BF440" fishing vessel settlement sheet (title "SETTLEMENT - M.F.V"). It is a single landing/settlement on one page: a GROSS SALES header, an EXPENSES block (labels on the left, a running detail column, and a right-hand column of £ totals), summary totals (TOTAL EXPENSES, NETT SALES, BOAT SHARE, CREW SHARE), and a WAGES table at the bottom. Extract as JSON with this EXACT shape (numbers only - strip £ signs and commas; never return null for a number, use 0):
{
  "settling_date": "YYYY-MM-DD"|null,
  "total_income": number,
  "total_expenses": number,
  "boat_share": number,
  "boat_share_pct": number,
  "fuel_pct": number,
  "commission": number,
  "days_at_sea": number|null,
  "expenses": [ { "label": string, "amount": number } ],
  "crew": [ { "crew_name": string, "gross": number, "bond": number, "net": number } ]
}
Rules:
- settling_date: the posting/settling date, usually handwritten or stamped near BOAT SHARE / signature (e.g. "SK 22/07/2026" -> 2026-07-22). It is NOT the trip date range at the top (e.g. "08/07/26-13/07/26") - ignore that range for the date.
- total_income = the TOTAL GROSS SALES figure (the large £ total, e.g. 136421).
- expenses: one entry per expense row that has a non-zero £ total in the right-hand totals column. Read the £ total for the row (not the little sub-notes like "VAN: £500 PET: £300" - those add up into the row total). Use these clean labels where they appear: Fuel, Ice, Food, Gas, Stores, Labour, Insurance / Rentals, Cartage, Travel, Commission, Boxes, Landing Dues, Misc Dues, P.O, National Insurance, Fares, Foreign Bond, Fish Lease, Acc Gear, Crew Pro. Skip rows that are blank or zero.
- total_expenses = the TOTAL EXPENSES figure.
- boat_share = the £ figure on the BOAT SHARE line. IMPORTANT: BOAT SHARE and CREW SHARE are two SEPARATE lines with different figures - take the BOAT SHARE one, never the CREW SHARE one. boat_share_pct = the percentage beside BOAT SHARE (e.g. 31; if shown as 0.31 convert to 31). Sanity check: boat_share should be approximately boat_share_pct% of total_income, so if unsure between two candidate figures pick the one that matches (e.g. at 31% of 136421 the boat share is about 42300, NOT 38300).
- fuel_pct = the percentage shown beside the Fuel Oil row (e.g. 19). If none, 0.
- commission = the Commission expense £ amount (0 if none).
- crew: from the WAGES table, one entry per named crew line that has figures. crew_name = the name WITHOUT any trailing bracket note - strip annotations like "(2%)", "(1/2)", "(3/4)", "(2 WKS)". Normalise the eight standard names to EXACTLY: "EJCM", "JON WM", "RPW Fish", "GF Fish", "Salvis", "Tomass", "Hillhead", "Laurie" (EJCM LTD->EJCM, JON WM LTD->JON WM, RPW FISH->RPW Fish, GF FISH->GF Fish, SALVIS->Salvis, TOMASS->Tomass, HILLHEAD->Hillhead, LAURIE->Laurie); title-case any other name. For each crew member: gross = their total earnings = the Bonus column PLUS the Wages column added together; if the line shows only a single wage figure with no separate bonus, gross = that single figure. bond = ONLY the value in the Bond column, or 0 if the Bond column is blank for them - NEVER put a wage or net figure into bond, and bond is always SMALLER than gross. net = the value in the final £ (Bacs/Cash) column that is actually paid out; if that column is blank, net = gross minus bond. Many crew have bond = 0 and net = gross. Skip the totals row at the very bottom.
Respond ONLY with the JSON object, no markdown fences, no commentary.`;

/* THE PAGE NUMBERS ARE THE READER'S ONE IRREPLACEABLE OUTPUT.
 *
 * Everything else it returns can be checked against the invoice itself — the
 * net, the VAT, the total, the supplier. The PAGE cannot: once the bundle is
 * filed, "which of these five scanned pages was the Jackson Trawls one" is a
 * question only the reader was ever in a position to answer, and asking it
 * again costs another read of the whole document.
 *
 * So they are asked for, and a page it is not sure of comes back NULL. A wrong
 * page number is worse than none: it opens the scan at the wrong invoice and
 * looks authoritative doing it, where a missing one just says the bundle has to
 * be read through. Same rule as `confidence` on the figures.
 *
 * THE WORK DATES ARE THE SAME BARGAIN. An engine or yard invoice normally
 * prints when the job was actually done, and that is the only thing that can
 * put a cost in the year it was incurred rather than the year it was billed —
 * seven Trevor McDonald invoices dated one October day are 30% of that year.
 * The failure mode is not a wrong date but a COPIED one, so the prompt spends
 * most of its words forbidding that and `fixWorkDates` enforces it below. */
const INVOICE_PROMPT = `You are reading one or more supplier invoices addressed to a fishing vessel (there may be several invoices in one document; skip any pages that are emails or letters rather than invoices). Extract as JSON:
{ "invoices": [ { "supplier": string, "invoice_no": string|null, "invoice_date": "YYYY-MM-DD"|null, "description": string|null, "net": number, "vat": number, "total": number, "currency": "GBP"|"EUR"|"DKK"|"NOK"|"SEK"|"USD"|null, "account_code": string|null, "boat_name": string|null, "page_from": number|null, "page_to": number|null, "work_from": "YYYY-MM-DD"|null, "work_to": "YYYY-MM-DD"|null } ] }
Rules: one entry per invoice. description should be a short summary of what was supplied (max ~90 chars). account_code is any handwritten/stamped account code box if visible (e.g. 6850), else null. total = invoice total including VAT.
currency is the currency THE INVOICE IS DENOMINATED IN, and it is not always sterling: this boat is billed by Danish, Norwegian, Dutch and French suppliers. Read it off the document - a currency code printed beside the total ("DKK 48.084,02", "64 750,00 EUR"), a "Current currency" field, a "kr" or a euro sign, an IBAN beginning DK/NO/NL/FR, or a VAT line reading "moms" or "TVA". Return the code, or null if the document genuinely does not say. DO NOT ASSUME GBP BECAUSE THE BOAT IS BRITISH - a foreign invoice taken at face value overstates the cost several times over, and 48,084 Danish kroner is about 5,800 pounds.
Give net, vat and total AS PRINTED, in that currency. Do not convert anything to sterling yourself: converting needs the rate on the day, which is not on the invoice, and a converted figure that looks like a printed one cannot be checked afterwards.
Watch the number format too. Continental invoices write 92 500,00 or 48.084,02 - a space or full stop for thousands and a COMMA for the decimal. 48.084,02 is forty-eight thousand, not forty-eight.
page_from and page_to are the pages this invoice occupies in the document AS SUPPLIED: count from 1 at the very first page and count EVERY page, including any cover notes, emails or blank pages you are skipping over. An invoice that sits on one page has page_from equal to page_to; one that runs over two pages has page_from 3 and page_to 4. Work through the document in order, so the invoices you return are in page order and their page ranges do not overlap. If you are not certain which page an invoice is on, return null for both rather than guessing - a wrong page number sends the reader to the wrong invoice, which is worse than no page number at all.
work_from and work_to are WHEN THE WORK WAS DONE, and they are almost always different from the invoice date: an engine or yard invoice normally prints a service period, a job date, dated worksheet lines, or an attendance date. Give the first and last of those dates. If the invoice states only one date for the work, put it in work_from and leave work_to null.
THE MOST IMPORTANT RULE HERE IS A NEGATIVE ONE. If the only date on the document is the invoice date, the order date or the due date, return null for BOTH - never copy the invoice date into work_from. A work date that is really just the invoice date repeated is worse than no work date at all, because it looks like something was read off the page when nothing was. The same goes for a date you are inferring rather than reading: if the invoice does not say when the work was done, say so by returning null.
Respond ONLY with the JSON object, no markdown fences, no commentary.`;

/* WHAT IS ACTUALLY ON AN INVOICE — the lines, not a ninety-character summary.
 *
 * The ordinary invoice read stores a description, which is enough to file a
 * cost and useless the moment two invoices need telling apart. Trevor McDonald
 * 3098 and 3098b are the case: same date, same four pages each, same work
 * dates, same account code, byte-identical description, VAT nil on both, and
 * £147,985.99 against £142,795.99 — exactly £5,190.00 apart. Two engines, or
 * one invoice and a revision of it? Nothing stored could say.
 *
 * `only` keeps the answer small and the read cheap: a 22-page bundle detailed
 * in full would not fit in one reply, and the question is almost always about
 * one or two invoices rather than all thirteen.
 *
 * NOTHING IS SAVED FROM THIS. It is a reading mode, not an ingest — there is
 * no line table and none is wanted yet. It answers a question and stops. */
const LINES_PROMPT = (only: string[]) => `You are reading a document containing one or more supplier invoices. Extract their LINE DETAIL as JSON:
{ "invoices": [ { "invoice_no": string|null, "supplier": string, "invoice_date": "YYYY-MM-DD"|null, "page_from": number|null, "page_to": number|null, "net": number|null, "vat": number|null, "total": number|null, "lines": [ { "description": string, "qty": number|null, "unit_price": number|null, "amount": number|null } ] } ] }
Rules:
- ${only.length ? "Detail ONLY the invoices whose invoice number is one of: " + only.join(", ") + ". Ignore every other invoice in the document completely - do not return an entry for it." : "Detail every invoice in the document."}
- Give EVERY line exactly as printed, in the order printed, including zero-value and no-charge lines. Do NOT summarise, merge, reword or skip lines - the whole point of this read is to compare two invoices line by line, and a tidied list cannot be compared.
- description is the line text as printed. amount is the line total in the money column. Where a line shows no figure use null rather than 0 - a line printed with no price is not a line worth nothing.
- Include any subtotal, discount, carriage or credit line as its own entry, worded as printed.
- If a page carries a heading such as REVISED, COPY, DUPLICATE, CREDIT NOTE or PROFORMA, put that word in as the FIRST line of that invoice, exactly as printed. It is the one thing on the page that says an invoice is not what it appears to be.
Respond ONLY with the JSON object, no markdown fences, no commentary.`;

// Canonicalise a crew name to one stable identity, merging company/spelling variants.
function canonCrew(nm: string): string {
  const s = (nm || "").toUpperCase();
  const has = (...w: string[]) => w.some((x) => s.includes(x));
  if (has("HENDERSON")) return "HENDERSON, DAVID";
  if (has("NAPIER", "JKH SERV")) return "JKH SERV SCOTLAND LTD, JAMES NAPIER";
  if (has("BEAGRIE", "RBJ FISHING", "RONALD SERVICES")) return "RBJ FISHING SERVICES LTD, RONALD BEAGRIE";
  if (has("NORMAN WOOD", "NAMRON")) return "NAMRON ENGINEERING LTD, NORMAN WOOD";
  if (has("BARRY REID", "GREEN HAUL")) return "GREEN HAUL FISHING LTD, BARRY REID";
  if (has("ALFIE REID", "AR FISHING")) return "AR FISHING LTD, ALFIE REID";
  if (has("DAVID GATT", "FIRTHBRAE")) return "FIRTHBRAE LTD, DAVID GATT";
  if (has("WILLIAM GATT", "DORANGLEN")) return "DORANGLEN LIMITED, WILLIAM GATT";
  if (has("JACKSON GATT", "J GATT FISHING")) return "J GATT FISHING LTD, JACKSON GATT";
  if (has("CRUICKSHANK")) return "CRUICKSHANK, DUNCAN";
  if (has("PAUL CRAIB", "CRAIB, PAUL", "GLENGAIRN")) return "GLENGAIRN LTD, PAUL CRAIB";
  if (has("ANDREW SMITH")) return "SMITH FISHING LTD, ANDREW SMITH";
  if ((s.includes("GREGOR") && s.includes("SMITH")) || s.includes("SMITH, GREGOR")) return "GREGOR SMITH LIMITED, GREGOR ALEXANDER SMITH";
  if (has("IAN ANDERSON", "CULAG", "ULLATAXIS")) return "CULAG LTD T/A ULLATAXIS, IAN ANDERSON";
  if (has("GUNDAROVS", "ANDREJS")) return "GUNDAROVS, ANDREJS";
  if (has("ZANDER WATSON", "COWORKER MARINE")) return "COWORKER MARINE LTD, ZANDER WATSON";
  return nm;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function mediaTypeFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

// Beryl crew figures can suffer column-misreads (a single wage figure landing in the Bond column).
// Guard: bond is always smaller than gross; if it isn't, it was a misread wage. Fill net from gross when blank.
function fixBerylCrew(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((c) => {
    let gross = Number(c.gross) || 0;
    let bond = Number(c.bond) || 0;
    let net = Number(c.net) || 0;
    if (bond >= gross && gross > 0) bond = 0; // misread: wage figure placed in bond column
    if (net === 0 && gross > 0) net = gross - bond;
    return { crew_name: String(c.crew_name || ""), gross, bond, net };
  });
}

/* A PAGE NUMBER IS ONLY WORTH KEEPING IF IT COULD BE TRUE.
 *
 * The reader is a model reading a photograph and these are the one field
 * nothing downstream can check — so they are checked here, against the only
 * thing that is certain about them: the document has a known number of pages,
 * and an invoice cannot start after it ends. Anything that fails drops to null
 * rather than being clamped into range, because a page number bent until it
 * fits is a guess wearing the clothes of a reading. */
function fixPages(rows: Record<string, unknown>[], pageCount: number | null): Record<string, unknown>[] {
  return rows.map((r) => {
    const whole = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 ? n : null;
    };
    let from = whole(r.page_from);
    let to = whole(r.page_to) ?? from;
    if (from === null) to = null;
    else if (to !== null && to < from) { from = null; to = null; }
    if (pageCount && ((from && from > pageCount) || (to && to > pageCount))) { from = null; to = null; }
    return { ...r, page_from: from, page_to: to };
  });
}

/* THE WORK DATES, CHECKED AGAINST THE ONE THING THAT WOULD MAKE THEM USELESS.
 *
 * The failure mode is not a wrong date, it is a COPIED one: a model handed an
 * invoice with only an invoice date on it will happily put that date in
 * work_from, and the result looks exactly like a reading. Every invoice would
 * then carry a work date, the "dated by work" grid would be identical to the
 * billed one, and nothing on the page would say why. So a work date equal to
 * the invoice date is dropped: where it is genuinely true it changes no year
 * and costs nothing, and where it is the model repeating itself it is removed.
 *
 * A span that ends before it starts is refused whole rather than reversed —
 * which of the two dates is wrong is not knowable — and a span whose ends are
 * the same day is stored as one date, because a single date is a reading and a
 * span is a thing that gets divided between years. */
function fixWorkDates(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const day = (v: unknown) => {
    const t = String(v ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  };
  return rows.map((r) => {
    let from = day(r.work_from);
    let to = day(r.work_to);
    const billed = day(r.invoice_date);
    if (from && to && to < from) { from = null; to = null; }
    if (from && to && to === from) to = null;
    if (from && !to && billed && from === billed) from = null;
    if (!from) to = null;
    return { ...r, work_from: from, work_to: to };
  });
}

async function runParse(admin: ReturnType<typeof createClient>, jobId: string, paths: string[], docType: string, apiKey: string, pageCount: number | null, only: string[] = []) {
  try {
    const content: unknown[] = [];
    for (const path of paths) {
      const { data: blob, error } = await admin.storage.from("su-documents").download(path);
      if (error || !blob) {
        await admin.from("su_parse_jobs").update({ status: "error", error: `Could not read the uploaded file (${path}): ${error?.message ?? "not found"}` }).eq("id", jobId);
        return;
      }
      const media = mediaTypeFor(path);
      const b64 = toBase64(await blob.arrayBuffer());
      if (media === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
      else content.push({ type: "image", source: { type: "base64", media_type: media, data: b64 } });
    }
    const prompt = docType === "invoice_lines" ? LINES_PROMPT(only)
      : docType === "invoice" ? INVOICE_PROMPT
      : docType === "settlement_beryl" ? BERYL_PROMPT : SETTLEMENT_PROMPT;
    content.push({ type: "text", text: prompt });

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(300000),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      await admin.from("su_parse_jobs").update({ status: "error", error: `AI request failed: ${errText.slice(0, 300)}` }).eq("id", jobId);
      return;
    }
    const data = await resp.json();
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(clean);
    } catch {
      await admin.from("su_parse_jobs").update({ status: "error", error: "Couldn't read the document clearly. Try a sharper photo or clearer scan, or enter the figures manually." }).eq("id", jobId);
      return;
    }
    if (docType === "settlement_beryl") {
      if (Array.isArray(parsed.crew)) parsed.crew = fixBerylCrew(parsed.crew as Record<string, unknown>[]);
    } else if (docType === "invoice") {
      /* The page count comes from the CALLER, which read it off the PDF itself
       * with pdf.js — the one fact about this document that is not the model's
       * opinion. Absent, the sanity check simply does less. */
      if (Array.isArray(parsed.invoices)) {
        parsed.invoices = fixWorkDates(fixPages(parsed.invoices as Record<string, unknown>[], pageCount));
      }
    } else if (Array.isArray(parsed.crew_payments)) {
      // normalise crew names on the way out (Audacious settlements only)
      parsed.crew_payments = (parsed.crew_payments as Record<string, unknown>[]).map((c) => ({ ...c, crew_name: canonCrew(String(c.crew_name || "")) }));
    }
    await admin.from("su_parse_jobs").update({ status: "done", result: parsed }).eq("id", jobId);
  } catch (e) {
    const msg = String(e).includes("Timeout") || String(e).includes("timed out")
      ? "Reading took too long - try fewer pages at a time or clearer photos."
      : String(e).slice(0, 300);
    await admin.from("su_parse_jobs").update({ status: "error", error: msg }).eq("id", jobId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "AI reading isn't switched on yet - the ANTHROPIC_API_KEY secret is missing in Supabase (Edge Functions > Secrets). You can still enter figures manually." }, 501);
    const { paths, doc_type, page_count, only } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) return json({ error: "No files provided" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("su_parse_jobs").delete().lt("created_at", new Date(Date.now() - 86400000).toISOString());
    const { data: job, error } = await admin.from("su_parse_jobs").insert({ doc_type: doc_type || "settlement" }).select().single();
    if (error || !job) return json({ error: `Could not start the read: ${error?.message}` }, 500);
    EdgeRuntime.waitUntil(runParse(admin, job.id, paths, doc_type || "settlement", apiKey, Number.isInteger(page_count) ? page_count : null,
      Array.isArray(only) ? only.map(String).slice(0, 20) : []));
    return json({ job_id: job.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
