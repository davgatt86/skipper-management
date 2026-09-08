/* THE MSF 5550 AIDE MEMOIRE — the checklist an MCA surveyor actually works from.
 *
 * David, Sep 2026: an annual self-certification wizard that mirrors the MCA's
 * official checklist.
 *
 * WHICH CODE APPLIES IS DECIDED BY FOUR CENTIMETRES. Audacious is 29.80 m LOA
 * and **23.96 m REGISTERED length**, so she sits in the 15 m LOA to under 24 m RL
 * band: a United Kingdom Fishing Vessel Certificate, an MCA inspection between
 * 24 and 36 months, and an ANNUAL SELF-CERTIFICATION in between. A boat of 24.00 m
 * RL is a different world — International Fishing Vessel Certificate, an annual
 * class or MCA survey and an intermediate at the second anniversary. The figure
 * lives in `vessel_details.length_registered` and is typed by hand, so it must be
 * checked against the UKFVC before this page is believed.
 *
 * TRANSCRIBED FROM THE FORM, NOT WRITTEN FROM MEMORY. MSF 5550 revision 09.24,
 * "FISHING VESSEL AIDE MEMOIRE – 15-24m SURVEY", stated on the form itself to be
 * based on MSN 1872 and MSN 1885. 148 numbered checks in 16 sections, taken from
 * the ODT published at gov.uk as MSIS 27 Chapter 1 Annex 17b and kept in the
 * order and wording the MCA uses.
 *
 * IT SHIPS IN CODE, like the market rules, the stores catalogue and the gear
 * parts, for the same reason: the MCA revises this form, and a fleet that had
 * seeded its own copy would be checking last year's list for ever. Per-fleet
 * changes are an OVERLAY in the database; the shipped list is the baseline.
 *
 * THE REVISION IS PART OF THE RECORD. A completed self-certification stores the
 * revision it was worked through, because "the vessel complied" is only meaningful
 * against a stated list — and the next revision will not match.
 *
 * WHAT THIS IS NOT. It is not MSF 1323, the Annual Self Certificate itself, and
 * it must never be presented as it. MSF 1323 is the declaration the skipper signs
 * and returns; this is the working paper behind it — the aide memoire worked
 * through, with the app's own evidence attached where it has any. Producing a
 * facsimile of an official form would be worse than useless.
 */

export const FORM = {
 code: 'MSF 5550',
 revision: '09.24',
 title: 'Fishing Vessel Aide Memoire – 15-24m Survey',
 basis: ['MSN 1872', 'MSN 1885'],
 source: 'MSIS 27 Chapter 1 Annex 17b',
 /* The band this list is for, in REGISTERED length. Checked against the vessel
 rather than assumed — see bandFor(). */
 band: { minLoa: 15, maxRegistered: 24 },
}

export const SECTIONS = [
 {
 key: "certificates_and_records",
 title: "CERTIFICATES AND RECORDS",
 items: [
 { n: 1, text: "Valid Certificate of Registry (change of ownership and/or modifications, i.e., length/engine requires new/amended CoR)" },
 { n: 2, text: "Validity of existing exemptions" },
 { n: 3, text: "Previously open deficiencies closed or re-issued" },
 { n: 4, text: "Photograph of vessel" },
 { n: 5, text: "Safety Signage" },
 { n: 6, text: "SOLAS 1 Poster" },
 { n: 7, text: "Annual Self Certification" },
 { n: 8, text: "Check MMSI registered and correctly input into GMDSS radio. Emergency radio procedure posted up – Test Call. Does vessel carry Iridium (see MIN636 latest amendment and section 12.4.3 of MSIS27 Chapter 12." },
 { n: 9, text: "Valid Radio licence– details of ownership correct?" },
 { n: 10, text: "Valid Servicing Certificates for Fire Appliances (MGN 276), Liferafts etc" },
 { n: 11, text: "Risk Assessment conducted or copies on board, updated annually, since change of ownership, or fishing method. MGN 587" },
 { n: 12, text: "Has any fire occurred requiring operation of fixed fire-extinguishing systems or portable fire extinguishers since last survey" },
 { n: 13, text: "Written Risk Assessment for Man Overboard (ref to MGN 571)– any mitigating actionto eliminate risk of MOB or PFDs worn" },
 { n: 14, text: "Crew aware of risk assessment" },
 { n: 15, text: "Crew aware of procedures for entry into dangerous (enclosed) spaces (see Chapter 15 of the Code of Safe Working Practices Entering dangerous (enclosed) spaces); MGN 309 (F) Fishing Vessels — The Dangers of Enclosed Spaces. Owners should be advised that MGN659 - Merchant Shipping and Fishing Vessels (Entry into Enclosed Spaces) Regulations 2022 comes into force for fishing vessels on 14 May 2023." },
 { n: 16, text: "Written Health and Safety Policy if more than 5 crew" },
 { n: 17, text: "Hours of rest records" },
 { n: 18, text: "Man Overboard Risk Review conducted with skipper" },
 { n: 19, text: "Conduct Drills, including at least one Mo Band recovery of unconscious person-– Checkcrew preparedness for a flooding incident and that crew are aware of the actions to take" },
 { n: 20, text: "Record of regular Drills– Muster lists" },
 { n: 21, text: "Shore power for fire and safety systems" },
 { n: 22, text: "EIAPP and technical file for new engines over 130 k W" },
 ],
 },
 {
 key: "crew_certificates_and_training_rec",
 title: "CREW CERTIFICATES AND TRAINING RECORDS",
 items: [
 { n: 23, text: "Crew list & is it posted ashore?" },
 { n: 24, text: "Induction records" },
 { n: 25, text: "On board training records for vessel equipment" },
 { n: 26, text: "Emergency instructions available for each person on board. Copies of suitably up to date muster lists posted in conspicuous places and in a language understood by all on board and posters or signs in the vicinity of survival craft and their launching stations as appropriate" },
 { n: 27, text: "One crew holding Short range Radio Certificate (area 1)/Restricted GMDSS (Area 2)" },
 { n: 28, text: "Validity of Crew Certificates of Competency" },
 { n: 29, text: "Validity of crew training Certificates" },
 { n: 30, text: "Voluntary Training –" },
 ],
 },
 {
 key: "hull",
 title: "HULL",
 items: [
 { n: 31, text: "Stability – condition of vessel" },
 { n: 32, text: "Hull condition – external/internal – no degradation, good maintenance" },
 { n: 33, text: "Deck, bulkheads, frames condition– perforations/damage/unplugged holes/non slip" },
 { n: 34, text: "Watertight Doors – condition and secure space watertight" },
 { n: 35, text: "Watertight hatches/coamings – condition and secure space watertight" },
 { n: 36, text: "Bulwarks – condition and adequate minimum height" },
 { n: 37, text: "Skylights – can be closed from outside" },
 { n: 38, text: "Bulkheads, frames, intact condition, SFP, no damage" },
 { n: 39, text: "Buoyancy Tanks – no damage" },
 { n: 40, text: "Fire doors, flaps, condition" },
 { n: 41, text: "Scuttles, Portlight and Flush scuttles– hinged deadlights – can be closed watertight-exposed areas and in the forward bulkheads of freeboard deck erections shall be of the non-opening type" },
 { n: 42, text: "Ventilators – height above deck, means of closure" },
 { n: 43, text: "Air pipes – height above deck, means of closure, provision to prevent overpressure." },
 { n: 44, text: "Freeing Ports clear of obstruction – minimum area 3% of bulwark area" },
 { n: 45, text: "Discharges – below freeboard deck with shut off ornon-returnvalves, exhaust pipes in hull below deck non return valve device or flap to prevent water ingress" },
 { n: 46, text: "Factory Deck – Tonnage Valves" },
 { n: 47, text: "Gas Cylinders, storage, safety provisions" },
 { n: 48, text: "Unauthorised modifications – no damage" },
 ],
 },
 {
 key: "out_of_water_intermediate_renewal",
 title: "OUT OF WATER – INTERMEDIATE/RENEWAL",
 items: [
 { n: 49, text: "Condition of Hull, Steelultra-sonictest and report, Bilge Keels, Sea chests, Sacrificial Anodes" },
 { n: 50, text: "Wood – condition of planking, nails, caulking etc" },
 { n: 51, text: "Aluminium – condition, cracking etc" },
 { n: 52, text: "GRP – condition, gel coat, damage, osmosis etc" },
 { n: 53, text: "Stern Gear Condition – Report, shaft clearances, Lubrication, Propeller, Kort Nozzle" },
 { n: 54, text: "Steering Gear condition, test, rudder stock, rudder, Clearances" },
 { n: 55, text: "Condition of sea inlet and discharge valves/cocks" },
 { n: 56, text: "Draught marks – condition/accuracy" },
 ],
 },
 {
 key: "wheelhouse_cabin",
 title: "WHEELHOUSE/CABIN",
 items: [
 { n: 57, text: "Windows – condition and to standard" },
 { n: 58, text: "Doors – condition– able to open from both sides?" },
 { n: 59, text: "Instructions for on board maintenance of LSA are on board – inspect anynon-mandatory LSAi.e., immersion suits/thermal protective aids" },
 { n: 60, text: "Table or curve of residual deviations for magnetic compass may be provided" },
 { n: 61, text: "Operational and, where appropriate, maintenance manuals for all navigational equipment provided" },
 { n: 62, text: "Where fitted, the magnetic compass" },
 { n: 63, text: "Where fitted, Gyro Compass" },
 { n: 64, text: "Where fitted, radar installation" },
 { n: 65, text: "Where fitted, automatic radar plotting aid" },
 { n: 66, text: "Where fitted, echo-sounding device" },
 { n: 67, text: "Where fitted, speed and distance indicator" },
 { n: 68, text: "Where fitted, rudder angle indicator" },
 { n: 69, text: "Where fitted, propeller rate of revolution indicator" },
 { n: 70, text: "Where fitted, variable pitch propeller pitch and operational mode indicator" },
 { n: 71, text: "Where fitted, Automatic identification system" },
 { n: 72, text: "Where fitted, voyage data recorder" },
 { n: 73, text: "Where fitted, ECDIS" },
 { n: 74, text: "Where fitted, GPS" },
 { n: 75, text: "Vessel complies with MGN314 – if not ensure visibility is adequate" },
 { n: 76, text: "Any accommodation facilities meet the requirements of MGN 413 ILO 188" },
 { n: 77, text: "Garbage arrangements" },
 ],
 },
 {
 key: "deck",
 title: "DECK",
 items: [
 { n: 78, text: "Lifeboats, rescue boats, condition, equipment in boats to scale required and in date" },
 { n: 79, text: "Embarkation arrangements and launching appliances for each survival craft including relevant testsand overboard lights" },
 { n: 80, text: "Access to safety equipment" },
 { n: 81, text: "PFD servicing – MGN 548 non SOLAS, MGN 553 SOLAS" },
 { n: 82, text: "Encourage use of PFDs/lifelines even where risk assessment says risk of MOB eliminated" },
 { n: 83, text: "If PFD requires to be fitted with crotch strap: the crotch strap is in place and in good condition; is not tied up with tape, tie wraps, or any other means that would indicate that it is not being used; the crew are made aware of the dangers of wearing a PFD without the crotch strap being connected" },
 { n: 84, text: "Man Overboard – discuss means of recovering if single handed or recovery with crew" },
 { n: 85, text: "Pilot ladder/Boarding arrangements" },
 { n: 86, text: "Safety of operation of fishing gear, winches, wires, blocks, nets, lines etc (LOLER/PUWER)" },
 ],
 },
 {
 key: "machinery",
 title: "MACHINERY",
 items: [
 { n: 87, text: "Main and Auxiliary engines – securely mounted, condition, guards, exhaust, protected no exposed high temperature surfaces, fuel lines" },
 { n: 88, text: "Remote Stops- Test (including haulers/conveyors etc)" },
 { n: 89, text: "Condition of pipework, securing clips, skin fittings, sea cocks and their ease of operation" },
 { n: 90, text: "Electrical systems – alternators, motors etc" },
 { n: 91, text: "Electrical cables – condition/sealed container, securely clipped, electrically safe" },
 { n: 92, text: "Batteries – condition – Emergency and Radio, ventilated" },
 { n: 93, text: "MEGGAR Test record" },
 { n: 94, text: "Fire risks and hazards" },
 { n: 95, text: "Arrangements for oil fuel, lubricating oil, and other flammable oils." },
 { n: 96, text: "Operation of remote means of closing valves on tanks that contain oil fuel, lubricating oil, and other flammable oils" },
 { n: 97, text: "Bunding arrangements" },
 { n: 98, text: "Bilge arrangements– means of discharging automatically from engine rooms" },
 { n: 99, text: "Fuel Filtering arrangements" },
 { n: 100, text: "Bilges – condition, no oil pumped overboard, Disposal arrangement for Oily Water" },
 { n: 101, text: "Fire extinguishing and special arrangements in the machinery spaces. Operation of the remote means of control provided for: - opening and closing of the skylights, release of smoke, closure of the funnel and ventilation openings, closure of doors, stopping of ventilation fans, stopping of oil fuel and other pumps that discharge flammable liquids" },
 { n: 102, text: "Fuel, Type, Stowage, signage, Shut-offs/jettisonable, safety issues" },
 { n: 103, text: "Compressed Air Systems Calibration of safety valves" },
 ],
 },
 {
 key: "life_saving_appliances",
 title: "LIFE SAVING APPLIANCES",
 items: [
 { n: 104, text: "Lifejackets, with lights. 1 per person, with 2 spares. Lifejackets (inc, whistles, retro-reflective material and lights) PFDs to comply with EN ISO 12402, auto inflation and 150 Newtons buoyancy." },
 { n: 105, text: "2 Liferafts – (SOLAS/MED). Stowage, will it snag. Float free arrangements, HRU expiry. Service as required by MGN 548 or 553." },
 { n: 106, text: "Handheld VHF Radio" },
 { n: 107, text: "2 Safety Harnesses or higher number to mitigate MOB risk assessment" },
 { n: 108, text: "Lifebuoys 1 with self-igniting light and smoke signal, 1 with 18 m buoyant line" },
 { n: 109, text: "Parachute flares – 6 (MED/SOLAS). Must be in date and in waterproof container" },
 { n: 110, text: "Handheld flares – 4 (MED/SOLAS)must be in date and in waterproof container" },
 { n: 111, text: "Smoke Signals 2 – (MED/SOLAS) – must be in date and in waterproof container" },
 { n: 112, text: "2 Line Throwing apparatus (MED/SOLAS)– readily available" },
 { n: 113, text: "Man Overboard Recovery system – Instructions posted. Crew drilled in use. Readily available" },
 { n: 114, text: "LPG Gas Detection and alarm system, visible and audible alarm in space and control position. Test. Notice in space for action to take if alarm sounds" },
 { n: 115, text: "CO Alarms – All vessels withenclosed spaces with fired cooking or heating appliances or where engine exhausts run through wheelhouse or crew space. Lithium battery, tested, maintained, in date and BS EN 50291" },
 { n: 116, text: "406 MHz EPIRB – If 406 EPIRB is carried, then additional PLBs may be AIS. EPIRBs and PLBs must be Registered, unless PLB is AIS. Annual Test Certificate for EPIRB." },
 { n: 117, text: "2 Bilge Pumps. Test. Two independent systems for every WT compartment" },
 { n: 118, text: "Bilge Alarms 1 If watertight bulkhead requires, sensors in main watertight compartments i.e. Fish Room, Machinery spaces and spaces with bilge suction but bilge water not checked visually. Test. No oil being pumped overboard / save-alls under filters, closure of fuel tank isolating valves when not in use." },
 { n: 119, text: "Navigation lights and soundsignals - as per MSN 1781 Amendment No.2 or any subsequent document" },
 { n: 120, text: "Charts/nautical publications for intended voyages and up to date" },
 { n: 121, text: "Compass and deviation chart – check– all vessels" },
 { n: 122, text: "Radar reflector – all vessels – Condition, if vessel less than 150 gt, should be capable of detecting by radar at 9 and 3 GHz" },
 { n: 123, text: "Signalling Lamp" },
 { n: 124, text: "Anchor and Cable/warp – condition" },
 { n: 125, text: "Medical Stores andkit" },
 { n: 126, text: "Waterproof Torch" },
 ],
 },
 {
 key: "fire_detection_fighting",
 title: "FIRE DETECTION/FIGHTING",
 items: [
 { n: 127, text: "Smoke Alarms (accommodation/enginespaces) - Decked vessels." },
 { n: 128, text: "Fire Detection system - audible and visual alarms (new build show location of fire. Cover machinery, galley, accommodation spaces. 2 power sources" },
 { n: 129, text: "3 Fire extinguishers suitable for accommodation and 2 suitable for oil fires. Correct type, condition, adequately maintained, location" },
 { n: 130, text: "Power operated Fire pump and hose –15 m 3/hr at pressure 2 kg/m 2" },
 { n: 131, text: "Fire pumps, fire main, hydrants, hoses and nozzles – jet of water produced at any part of the ship whilst required pressure maintained in fire main." },
 { n: 132, text: "1 Fire Blanket (if galley or cooking area)" },
 { n: 133, text: "Fixed Fire fighting system for machinery space – suitable for class of fire, means of operation clearly marked, CO2/FM200, capacity checked. Space gastight. Pipework clear. Advance warning audible and visual in space required. Serviced" },
 { n: 134, text: "Fixed Fire fighting system for galley if SFP not at A 30. Requires as per Machinery Spaces." },
 { n: 135, text: "LPG Flame failure devices and low pressure shut off valve" },
 ],
 },
 {
 key: "stability",
 title: "STABILITY",
 items: [
 { n: 136, text: "Stability book (or Roll Test Report)" },
 { n: 137, text: "Inclining Test or Lightship check" },
 ],
 },
 {
 key: "all_vessels",
 title: "ALL VESSELS",
 items: [
 { n: 138, text: "Crew position on shooting/hauling" },
 ],
 },
 {
 key: "beam_trawlers",
 title: "Beam Trawlers",
 items: [
 { n: 139, text: "Towing Height above deck" },
 { n: 140, text: "Length of booms" },
 { n: 141, text: "Length of beams" },
 { n: 142, text: "No of scallop bags per side" },
 ],
 },
 {
 key: "trawlers",
 title: "TRAWLERS",
 items: [
 { n: 143, text: "Towing heights" },
 ],
 },
 {
 key: "netter",
 title: "NETTER",
 items: [
 { n: 144, text: "Where are bins stored" },
 { n: 145, text: "Fish pounded" },
 ],
 },
 {
 key: "static_gear_potters_creelers_etc",
 title: "STATIC GEAR: POTTERS, CREELERS ETC",
 items: [
 { n: 146, text: "Shooting, hauling method" },
 ],
 },
 {
 key: "completion",
 title: "COMPLETION",
 items: [
 { n: 147, text: "If any doubt before completion, contact local MO or Consultant FV surveyor" },
 { n: 148, text: "Certificate Issued or endorsed" },
 ],
 },
]
