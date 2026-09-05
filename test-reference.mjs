/* THE REFERENCE FOR AN INVOICE THAT CARRIES NO NUMBER.
 *
 * David, Sep 2026: "just make up a number for the page to log it as, not alter
 * the invoice itself." The rows below are the REAL ones out of the record. */
import assert from 'node:assert/strict'
import { assignedRef, isAssignedRef } from './src/lib/invoices/reference.js'

let n = 0
const ok = (c, m) => { n++; assert.ok(c, m) }
const eq = (a, b, m) => { n++; assert.equal(a, b, m) }

/* IT NEVER TOUCHES A PRINTED NUMBER. This is the one that matters: the document
   is not altered and its own number is never overwritten. */
ok(assignedRef({ supplier: 'X', invoice_no: '3098', total: 1 }) === null,
   'a printed number is left alone')
ok(assignedRef({ supplier: 'X', invoice_no: '  INV-0114  ', total: 1 }) === null,
   'even one with whitespace round it')

/* DERIVED, so the SAME invoice arriving again produces the SAME reference and
   the two collide. A random one would leave them unmatchable for ever. */
const dek = { supplier: 'DekMar Ltd', invoice_date: '2022-02-01', total: 10200 }
eq(assignedRef(dek), 'NN-DEKMAR-20220201-10200.00', 'the real DekMar reference')
eq(assignedRef({ ...dek, supplier: 'Dekmar Ltd' }), assignedRef(dek), 'case does not matter')
eq(assignedRef({ ...dek, supplier: 'DEKMAR LIMITED' }), assignedRef(dek),
   'nor does Ltd against Limited')
eq(assignedRef({ ...dek, total: '10200.00' }), assignedRef(dek), 'nor a string total')

/* The two real Strachan rows that collide, and the Macduff three that must not. */
eq(assignedRef({ supplier: 'Strachan Trawls (Fraserburgh) Ltd', invoice_date: null, total: 1523 }),
   'NN-STRACHANTR-undated-1523.00', 'undated says so rather than faking a date')
const mac = (t) => assignedRef({ supplier: 'Macduff Shipyards Ltd', invoice_date: '2021-11-10', total: t })
ok(new Set([mac(50413.79), mac(54483.39), mac(55737.45)]).size === 3,
   'three Macduff invoices on one day stay three references')

/* Blank and zero are different facts — `Number('') === 0` has caught this repo
   four times, and a total nobody read must not read as a total of nothing. */
ok(/-nototal$/.test(assignedRef({ supplier: 'X', invoice_date: '2022-01-01', total: '' })),
   'no total says so')
ok(/-0\.00$/.test(assignedRef({ supplier: 'X', invoice_date: '2022-01-01', total: 0 })),
   'but zero is a real total')

/* It is always recognisable as ours, in both directions. */
ok(isAssignedRef(assignedRef(dek)), 'recognised as assigned')
ok(!isAssignedRef('3098') && !isAssignedRef('INV-0114') && !isAssignedRef(''),
   'a real number, and a blank, are not')

/* A supplier with nothing readable still gets a reference rather than nothing —
   three rows in the record are literally "Unknown". */
ok(/^NN-UNKNOWN-/.test(assignedRef({ supplier: '', invoice_date: null, total: 0 })),
   'an unreadable firm still gets one')

console.log('invoice references: ' + n + ' checks passed')
