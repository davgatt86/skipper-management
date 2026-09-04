/**
 * PULL EVERY INVOICE OUT OF GMAIL AND INTO A DRIVE FOLDER.
 *
 * David, Sep 2026: "go into gmail, extract all attachments into a desktop folder
 * for uploading. we used a program previously for this job but it's not on this
 * computer."
 *
 * WHY A SCRIPT RATHER THAN A PROGRAM. Nothing needs installing, nothing needs a
 * password, and it runs inside the Google account that already holds the mail —
 * so there is no third-party tool holding a key to the boat's email.
 *
 * HOW TO RUN IT
 *   1. Go to script.google.com and click New project.
 *   2. Delete what is there, paste this in, Save.
 *   3. Pick `saveInvoiceBundles` from the function dropdown and press Run.
 *      Google asks for permission the first time — it is your own script asking
 *      to read your mail and write to your Drive.
 *   4. When it finishes, open Drive, find the folder, and download it.
 *      Right-click the folder -> Download gives a zip. Unzip to the Desktop.
 *   5. Drop the PDFs onto the Invoices page in Skipper Management.
 *
 * IT IS SAFE TO RUN AGAIN. Anything already saved is skipped, so if it stops on
 * the six-minute limit you just press Run once more and it carries on. It only
 * ever reads mail and writes files; it never sends, deletes or labels anything.
 *
 * ============================================================================
 * VERSION 2, Sep 2026 — THE FIRST VERSION MISSED A WHOLE CLASS OF INVOICE.
 * ============================================================================
 *
 * It searched `from:denise.nicolson@donfishing.com subject:"invoices for
 * approval"`, which is the Monday bundle and nothing else. Three faults:
 *
 * 1. THE SUBJECT HAD TO MATCH THAT PHRASE EXACTLY. The office also sends single
 *    invoices as they come up, and calls them what they are — "PBP Invoice for
 *    approval", "Diving Invoice", "Audacious VCU Invoice", "Bremner Fishing -
 *    Quota invoice", "Audacious invoice for approval" in the SINGULAR. None
 *    matched. Worse, a heavy week gets split — "Audacious invoices - 3 of 3" —
 *    and only the parts whose subject happened to fit came through.
 *
 * 2. ONLY DENISE. Morna Grieve sends invoices too, and did before Denise.
 *
 * 3. IT DEDUPED ON THE NAME IT INVENTED, not on the attachment. The name it
 *    saves under starts with the email's date, so the SAME pdf arriving twice —
 *    in a re-send, or forwarded on — got saved twice under two names. That is
 *    exactly what happened: `20221213090636545.pdf` went into the record twice,
 *    eight invoices and £25,931.95 double counted, and it was only caught nine
 *    months later by a duplicate sweep. It now keys on the attachment's OWN
 *    name and byte size, which is the thing that is actually the same.
 *
 * WHAT WENT MISSING BECAUSE OF IT: a quarterly fee that is charged like
 * clockwork — the £969 Superintendent Engineer's Fee — is on the record for
 * only 20 of its 30 quarters. The money is nothing; what it says is that the
 * record has holes, and this is where they came from.
 *
 * THE FILTER NOW FAILS TOWARDS INCLUDING. A market price sheet saved by mistake
 * is deleted in a second; an invoice never saved is a cost nobody ever sees.
 *
 * MEASURED ON THE FIRST REAL RUN: in the last fourteen months alone it found 32
 * pdfs that had never been saved, against 66 that had. A THIRD OF THE INVOICE
 * MAIL IN THAT WINDOW WAS MISSING, and that is the most recent stretch — the
 * part of the record most likely to be right.
 *
 * TWO THINGS THAT RUN SHOWED, both fixed here:
 *
 *   - IT SPENT THREE QUARTERS OF ITS TIME FETCHING MAIL TO THROW AWAY. 725 of
 *     the 966 messages it read were market price sheets discarded on the
 *     subject. The subject test is in the Gmail QUERY now as well as in code, so
 *     they are never fetched. The code test stays, because it is the one that is
 *     tested and Gmail's own matching is not something to bet the record on.
 *   - IT STARTED AT THE NEWEST MAIL EVERY TIME. Six minutes is not enough for a
 *     decade, so each run re-trod the same ground before reaching anything new —
 *     meaning the older a gap was, the less likely any run would ever reach it,
 *     and 2017 might never have been read at all. It remembers its place now,
 *     and forgets it once it has read to the end.
 */

/** Anything from the office that looks like an invoice. */
function saveInvoiceBundles() {
  savePdfAttachments_(
    'from:donfishing.com has:attachment filename:pdf subject:(invoice OR invoices'
      + ' OR approval OR receipt OR receipts OR statement OR card)',
    'Audacious Invoice Bundles',
    /invoice|approval|receipt|statement|credit\s*card/i,
    /settling|market\s*(price|landing)|prices|fish\s*prices|weather/i);
}

/** The settling sheets. Same job, different search — these never reached the
 *  app by email either, because they are over the forwarding size limit too. */
function saveSettlingSheets() {
  savePdfAttachments_(
    'from:donfishing.com subject:settling has:attachment',
    'Audacious Settling Sheets', null, null);
}

/**
 * EVERYTHING ELSE THE OFFICE HAS SENT WITH A PDF ON IT.
 *
 * Run this one only if you want to be sure nothing is being missed. It saves
 * what the two above deliberately skip, so it is mostly market price sheets —
 * but it is the only way to see whether an invoice is hiding under a subject
 * nobody would guess. Look through it and delete the rest.
 */
function saveEverythingElse() {
  savePdfAttachments_(
    'from:donfishing.com has:attachment filename:pdf',
    'Audacious Office PDFs - everything else',
    /settling|market\s*(price|landing)|prices|fish\s*prices|weather/i, null);
}

/* --------------------------------------------------------------------------
 * The worker. All three of the above are one call to this.
 *   keep  — save only when the subject matches this (null = anything)
 *   skip  — never save when the subject matches this (null = nothing skipped)
 * -------------------------------------------------------------------------- */
function savePdfAttachments_(query, folderName, keep, skip) {
  var folder = getOrCreateFolder_(folderName);

  /* WHAT IS ALREADY THERE, read once. Checking per file would be one Drive
     query per attachment, which is what makes a script like this time out.

     KEYED ON THE ATTACHMENT, NOT ON THE NAME THIS SCRIPT INVENTS. Version 1
     keyed on "<email date> <attachment name>", so one pdf arriving on two days
     was two different keys and got saved twice — which is how eight invoices
     and £25,931.95 ended up in the record twice. The scanner's own name plus
     the byte size is the thing that is genuinely the same document. */
  var have = {};
  noteFilesIn_(folder, have);
  var subs = folder.getFolders();      // including anything sorted out of it
  while (subs.hasNext()) noteFilesIn_(subs.next(), have);

  var saved = 0, skipped = 0, dropped = 0, scanned = 0;
  var dates = [];
  var start = new Date().getTime();

  /* WHERE THE LAST RUN GOT TO. Without this every run starts at the newest mail
     again and spends its six minutes re-treading ground before reaching anything
     new — so the older a gap is, the less likely a run ever reaches it. Backed
     off a page, because new mail arriving shifts everything down, and the dedupe
     makes re-reading harmless. Cleared when a run reaches the end, so the next
     one sweeps from the newest again for whatever has come in since. */
  var props = PropertiesService.getScriptProperties();
  var cursorKey = 'from:' + folderName;
  var first = Math.max(0, (Number(props.getProperty(cursorKey)) || 0) - 1);
  if (first) Logger.log('Carrying on from page %s of the search.', first + 1);

  /* Paged, because a year of weekly mail is more threads than one search
     returns, and because the six-minute limit means this may not finish in one
     go. Everything already saved is skipped on the next run, so stopping early
     costs nothing but a second press of Run. */
  var page = first, finished = true, outOfTime = false;
  for (; page < first + 60 && !outOfTime; page++) {
    var threads = GmailApp.search(query, page * 50, 50);
    if (!threads.length) break;

    for (var t = 0; t < threads.length; t++) {
      /* THE CLOCK IS CHECKED HERE, PER THREAD, NOT PER PAGE. Checked between
         pages it was useless: fifty threads of multi-megabyte scans take well
         over the minute of headroom, so the run was killed at six minutes with
         its place never written down — and the next run began at the same page
         and died in the same spot. Stopping mid-page is free, because the
         dedupe means re-reading what was already saved costs nothing. */
      if (new Date().getTime() - start > 4.5 * 60 * 1000) {
        outOfTime = true;
        break;
      }
      var messages = threads[t].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];

        /* ONLY WHAT THE OFFICE SENT. A thread carries your replies and their
           replies too, and a forward of your own would save the same bundle a
           second time under a different date. */
        if (msg.getFrom().indexOf('donfishing.com') === -1) continue;

        var subject = msg.getSubject() || '';
        if (skip && skip.test(subject)) { dropped++; continue; }
        if (keep && !keep.test(subject)) { dropped++; continue; }

        scanned++;
        var atts = msg.getAttachments({ includeInlineImages: false });
        for (var a = 0; a < atts.length; a++) {
          var att = atts[a];
          if (att.getContentType().indexOf('pdf') === -1) continue;

          var key = att.getName() + '|' + att.getSize();
          if (have[key]) { skipped++; continue; }

          /* NAMED BY THE DATE OF THE EMAIL, so the folder sorts into the order
             the invoices arrived, and so the app can recover a real arrival
             date from the file name. The original name is kept on the end —
             that is what identifies the document, and what the dedupe above
             reads back out. */
          var name = Utilities.formatDate(msg.getDate(),
                       Session.getScriptTimeZone(), 'yyyy-MM-dd')
                   + ' ' + att.getName();

          /* THE NAME GOES ON THE BLOB, NOT ON THE FILE AFTERWARDS. As
             createFile(...).setName(...) it is two operations, and the run that
             was killed at six minutes died between them — leaving
             SKM_C3350170728085100.pdf in the folder under the scanner's own
             name with no date on it, which is the one thing the prefix exists to
             carry. Named first, the file cannot exist without its date. */
          folder.createFile(att.copyBlob().setName(name));
          have[key] = true;
          dates.push(name.substring(0, 10));
          saved++;
        }
      }
    }

    /* Out of time: write down the page being read — not the one after it, since
       it was left half finished — so the next run picks it up. */
    if (outOfTime) {
      props.setProperty(cursorKey, String(page));
      finished = false;
      Logger.log('Stopped on the time limit — press Run again and it carries on '
                 + 'from here rather than starting over.');
    }
  }

  /* Read to the end: forget the cursor, so the next run starts at the newest
     mail and picks up whatever has arrived since. */
  if (finished) {
    props.deleteProperty(cursorKey);
    Logger.log('Read right back to the beginning — nothing left to carry on to.');
  }

  Logger.log('%s: %s saved, %s already there, %s office emails read, %s skipped by subject.',
             folderName, saved, skipped, scanned, dropped);
  if (dates.length) {
    dates.sort();
    Logger.log('New files are dated %s to %s.', dates[0], dates[dates.length - 1]);
  }
  Logger.log('Open Drive, right-click the "%s" folder and choose Download.', folderName);
}

/* The name as the office's scanner wrote it, with any date prefix this script
   added on an earlier run taken back off — so a file saved by version 1 is
   still recognised and not fetched a second time. */
function origName_(name) {
  return /^\d{4}-\d{2}-\d{2} /.test(name) ? name.substring(11) : name;
}

function noteFilesIn_(folder, have) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    have[origName_(f.getName()) + '|' + f.getSize()] = true;
  }
}

/**
 * SORT OUT THE ONES THE APP HAS NOT SEEN.
 *
 * The folder now holds both the bundles loaded into Skipper Management back in
 * September and everything this corrected search has since turned up, and there
 * is no telling them apart by eye. Uploading the lot would put hundreds of
 * bundles through the reader a second time.
 *
 * The two are told apart by WHEN THEY WERE WRITTEN, which is a fact about the
 * folder rather than a guess about the mail: the backlog went in on the 1st and
 * 2nd of September, and everything the corrected search found was written after
 * it. Run this, then download the "New - to upload" folder alone.
 */
function collectWhatIsNew() {
  var folder = getOrCreateFolder_('Audacious Invoice Bundles');
  var target = folder.getFoldersByName(NEW_FOLDER).hasNext()
             ? folder.getFoldersByName(NEW_FOLDER).next()
             : folder.createFolder(NEW_FOLDER);

  var moved = 0, dates = [], undated = [];
  var it = folder.searchFiles('createdDate > "' + LOADED_BEFORE + '"');
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();

    /* A file with no date on the front is one the six-minute kill caught
       between being created and being named. Say so rather than moving it
       quietly — its arrival date is the one thing that cannot be read back off
       the pdf, and the app files a bundle by it. */
    if (!/^d{4}-d{2}-d{2} /.test(name)) undated.push(name);
    else dates.push(name.substring(0, 10));

    f.moveTo(target);
    moved++;
  }

  dates.sort();
  Logger.log('%s files the app has not seen, moved into "%s".', moved, NEW_FOLDER);
  if (dates.length) Logger.log('They are dated %s to %s.', dates[0], dates[dates.length - 1]);
  if (undated.length) {
    Logger.log('%s carry no date and need one adding by hand before uploading: %s',
               undated.length, undated.join(', '));
  }
  Logger.log('Right-click "%s" in Drive and choose Download.', NEW_FOLDER);
}

/* The backlog was loaded into the app on 1-2 September 2026. Anything written
   into the folder after that is something the first search never found. */
var LOADED_BEFORE = '2026-09-03T00:00:00';
var NEW_FOLDER = 'New - to upload';

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
