/* THE ENGINE LOG'S PARAMETERS — one list, shared by the page, its PDF export and
 * the printable sheet.
 *
 * Modelled on Ægir's Engine Log. Readings are grouped by equipment; each entry
 * stores { group: { param: value } } in engine_logs.readings (jsonb), so this
 * list can be tweaked without a migration. Units are shown next to each input.
 *
 * IT LIVED INSIDE EngineLogs.jsx, which drags the supabase client in behind it,
 * so nothing that needed the list could be rendered or tested without a login.
 * The printable sheet is why it moved: the rows printed on paper must be EXACTLY
 * the rows the app stores, or the reader fills in a box with nowhere to go. One
 * list is how that stays true — add a parameter here and the sheet grows a row.
 *
 * EVERYTHING ON THE ENGINE ROOM'S OWN PAPER SHEET IS HERE NOW (Sep 2026). David:
 * *"add them all to app."* Generator oil temp, gearbox oil added, the four
 * refrigeration machines and the four remaining-on-board figures were written
 * on paper every day and had nowhere to go. The one field that is not a number —
 * steaming/towing/alongside — is a column, not a row; see
 * supabase/engine_log_vessel_operation.sql.
 *
 * `boxes` is how many boxes the printable sheet gives a reading that has NO range
 * and NO history yet — a guess, and only ever the last resort: a confirmed range
 * or the boat's own record always overrules it (printSheet.js boxShape).
 *
 * `sheet` says where a group sits on the printed page. `pair` groups share rows
 * and sit side by side, as the paper sheet has always had the generators.
 */
const P = (label, unit = '', boxes) => (boxes ? { label, unit, boxes } : { label, unit })

export const ENGINE_TEMPLATE = [
  {
    group: 'Main Engine 1',
    hoursParam: 'Running Hours',           // this param feeds the headline running-hours figure
    sheet: { column: 'left', order: 0 },
    params: [
      P('RPM', 'rpm'), P('GOV'),
      P('Charge Air Pressure', 'bar'), P('Charge Air Temp', '°C'),
      P('Turbo IN Temp', '°C'), P('Turbo OUT Temp', '°C'),
      P('Unit 1 Exhaust Temp', '°C'), P('Unit 2 Exhaust Temp', '°C'),
      P('Unit 3 Exhaust Temp', '°C'), P('Unit 4 Exhaust Temp', '°C'),
      P('Unit 5 Exhaust Temp', '°C'), P('Unit 6 Exhaust Temp', '°C'),
      P('Unit 7 Exhaust Temp', '°C'), P('Unit 8 Exhaust Temp', '°C'),
      P('HT Pressure', 'bar'), P('HT IN Temp', '°C'), P('HT OUT Temp', '°C'),
      P('LT Pressure', 'bar'), P('LT IN Temp', '°C'), P('LT OUT Temp', '°C'),
      P('Lube Oil Pressure', 'bar'), P('Lube Oil IN Temp', '°C'), P('Lube Oil OUT Temp', '°C'),
      P('Fuel Pressure', 'bar'), P('Start Air Pressure', 'bar'), P('Stop Air Pressure', 'bar'),
      P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Generator 1',
    sheet: { column: 'right', order: 1, pair: 'Generators' },
    params: [
      P('Oil', 'bar'), P('Oil Temp', '°C'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Generator 2',
    sheet: { column: 'right', order: 1, pair: 'Generators' },
    params: [
      P('Oil', 'bar'), P('Oil Temp', '°C'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Gearbox 1',
    sheet: { column: 'right', order: 0 },
    params: [
      P('Oil Press', 'bar'), P('Oil Temp IN', '°C'), P('Oil Temp OUT', '°C'),
      P('Thrust Bearing Temp', '°C'), P('Clutch Pressure', 'bar'),
      P('PTO 1 Bearing Temp', '°C'), P('PTO 2 Bearing Temp', '°C'), P('PTO 3 Bearing Temp', '°C'),
      P('Pitch', '%'), P('Oil added', 'L'),
    ],
  },
  /* What is left in the tanks. Sludge is the weekly reading the Oil Record Book
     wants under code C item 11.3, which is the first reason to record it here. */
  {
    group: 'Remaining on Board',
    sheet: { column: 'right', order: 2 },
    params: [
      P('Main Engine Oil', 'L', { int: 4, dec: 0 }),
      P('Fuel Oil', 'm³', { int: 3, dec: 1 }),
      P('Hydraulic Oil', 'L', { int: 4, dec: 0 }),
      P('Sludge', 'L', { int: 4, dec: 0 }),
    ],
  },
  ...['Ice Machine 1', 'Ice Machine 2', 'Fishroom', 'Fish Handling'].map((group) => ({
    group,
    sheet: { column: 'band', order: 0, pair: 'Refrigeration' },
    params: [
      P('Compressor HP', 'bar'), P('Compressor LP', 'bar'),
      P('Oil Level'), P('Running Hours', 'h', { int: 5, dec: 0 }),
    ],
  })),
]
