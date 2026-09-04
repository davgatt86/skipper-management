import fs from 'fs'

const src = fs.readFileSync('C:/Users/davga/Skipper Management/scripts/gmail-attachments.gs', 'utf8')
let bad = 0
const ok = (name, cond) => { console.log((cond ? '  ok    ' : '  FAIL  ') + name); if (!cond) bad++ }

// The date-prefix test. Written as a literal so no escaping stands between this
// check and the thing it is checking — the bug being tested for IS a lost
// backslash, so a test that can lose one too proves nothing.
const PREFIX = '/^\\d{4}-\\d{2}-\\d{2} /'
ok('date-prefix regex carries its backslashes', src.includes(PREFIX))
ok('appears in both places that need it', src.split(PREFIX).length - 1 === 2)
ok('no de-fanged copy left behind', !src.includes('/^d{4}-d{2}-d{2} /'))

// Behaviour, not just spelling.
const dated = new RegExp('^\\d{4}-\\d{2}-\\d{2} ')
ok('a dated name matches',   dated.test('2017-07-28 SKM_C3350170728085100.pdf'))
ok('an undated name does not', !dated.test('SKM_C3350170728085100.pdf'))

// The Drive query that threw "Invalid argument: q" must be gone, and the
// replacement must not iterate a folder it is moving files out of.
ok('no searchFiles query',        !src.includes('searchFiles('))
ok('compares dates in code',       src.includes('getDateCreated() >= cutoff'))
ok('collects before it moves',     src.indexOf('isNew.push(f)') < src.indexOf('isNew[i].moveTo(target)'))
ok('names the blob before create', src.includes('createFile(att.copyBlob().setName(name))'))

// And it still parses.
try { new Function(src); ok('parses as JavaScript', true) }
catch (e) { ok('parses as JavaScript — ' + e.message, false) }

console.log(bad ? '\n' + bad + ' FAILURES' : '\nall checks passed')
process.exit(bad ? 1 : 0)
