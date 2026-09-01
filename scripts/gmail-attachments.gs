/**
 * PULL EVERY INVOICE BUNDLE OUT OF GMAIL AND INTO A DRIVE FOLDER.
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
 */

/** The weekly invoice bundles from the office. */
function saveInvoiceBundles() {
  savePdfAttachments_(
    'from:denise.nicolson@donfishing.com subject:"invoices for approval" has:attachment',
    'Audacious Invoice Bundles');
}

/** The settling sheets. Same job, different search — these never reached the
 *  app by email either, because they are over the forwarding size limit too. */
function saveSettlingSheets() {
  savePdfAttachments_(
    'from:donfishing.com subject:settling has:attachment',
    'Audacious Settling Sheets');
}

/* --------------------------------------------------------------------------
 * The worker. Both of the above are one call to this with a different search.
 * -------------------------------------------------------------------------- */
function savePdfAttachments_(query, folderName) {
  var folder = getOrCreateFolder_(folderName);

  /* WHAT IS ALREADY THERE, read once. Checking per file would be one Drive
     query per attachment, which is what makes a script like this time out. */
  var have = {};
  var existing = folder.getFiles();
  while (existing.hasNext()) have[existing.next().getName()] = true;

  var saved = 0, skipped = 0, scanned = 0;
  var start = new Date().getTime();

  /* Paged, because a year of weekly mail is more threads than one search
     returns, and because the six-minute limit means this may not finish in one
     go. Everything already saved is skipped on the next run, so stopping early
     costs nothing but a second press of Run. */
  for (var page = 0; page < 40; page++) {
    var threads = GmailApp.search(query, page * 50, 50);
    if (!threads.length) break;

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];

        /* ONLY WHAT THE OFFICE SENT. A thread carries your replies and their
           replies too, and a forward of your own would save the same bundle a
           second time under a different date. */
        if (msg.getFrom().indexOf('donfishing.com') === -1) continue;

        scanned++;
        var atts = msg.getAttachments({ includeInlineImages: false });
        for (var a = 0; a < atts.length; a++) {
          var att = atts[a];
          if (att.getContentType().indexOf('pdf') === -1) continue;

          /* NAMED BY THE DATE OF THE EMAIL, so the folder sorts into the order
             the bundles arrived. The scanner's own name (20260831082919614.pdf)
             sorts correctly by luck rather than design, and the settling sheets
             are named nothing useful at all. The original name is kept on the
             end so a file can still be traced back to the message. */
          var name = Utilities.formatDate(msg.getDate(),
                       Session.getScriptTimeZone(), 'yyyy-MM-dd')
                   + ' ' + att.getName();

          if (have[name]) { skipped++; continue; }
          folder.createFile(att.copyBlob()).setName(name);
          have[name] = true;
          saved++;
        }
      }
    }

    /* Stop with five minutes gone rather than being killed at six, so the log
       says what happened instead of the run simply vanishing. */
    if (new Date().getTime() - start > 5 * 60 * 1000) {
      Logger.log('Stopped on the time limit — press Run again to carry on.');
      break;
    }
  }

  Logger.log('%s: %s saved, %s already there, %s office emails scanned.',
             folderName, saved, skipped, scanned);
  Logger.log('Open Drive, right-click the "%s" folder and choose Download.', folderName);
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
