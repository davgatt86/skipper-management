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
 */
const P = (label, unit = '') => ({ label, unit })

export const ENGINE_TEMPLATE = [
  {
    group: 'Main Engine 1',
    hoursParam: 'Running Hours',           // this param feeds the headline running-hours figure
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
    params: [
      P('Oil', 'bar'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Generator 2',
    params: [
      P('Oil', 'bar'), P('RPM', 'rpm'), P('Load', 'kW'),
      P('Jacket Water Temp', '°C'), P('Exhaust Temp', '°C'), P('Inst Fuel', 'L'),
      P('Fuel Pressure', 'bar'), P('Oil added', 'L'), P('Running Hours', 'h'),
    ],
  },
  {
    group: 'Gearbox 1',
    params: [
      P('Oil Press', 'bar'), P('Oil Temp IN', '°C'), P('Oil Temp OUT', '°C'),
      P('Thrust Bearing Temp', '°C'), P('Clutch Pressure', 'bar'),
      P('PTO 1 Bearing Temp', '°C'), P('PTO 2 Bearing Temp', '°C'), P('PTO 3 Bearing Temp', '°C'),
      P('Pitch', '%'),
    ],
  },
]
