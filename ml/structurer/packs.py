"""Medicine pack panels as the vision model transcribes them, with the answer a careful reader gives.

Packs are the main thing reporters photograph, so this is the richest generator: many brands and forms
(tablets, capsules, syrups, injections, creams, eye drops, inhalers), front, back, side and strip faces, every
common way of printing batch and dates, label and stamped-value columns, "manufactured for X by Y", and the
lines a reader must ignore (licence numbers, PIN codes, prices, warnings, product codes).

The reporters' own test packs (Flutifer, Meftal-P, Moxikind) are never used here, so they stay a fair test.
HELD brands appear only in the held-out hard set.
"""

# brand, form, front generic text, composition lines (the block after "contains"), strengths on the brand line,
# pack sizes. Fictional pairings of real generic names with brand-like names; no claim about real products.
TRAIN = [
    ("Zifi", "tablet", "Cefixime Tablets IP", ["Cefixime IP (as Trihydrate)", "eq. to Anhydrous Cefixime 200 mg"], ["", " 200"], ["10 Tablets", "1 x 10 Tablets"]),
    ("Pantocid", "tablet", "Pantoprazole Gastro-resistant Tablets IP", ["Pantoprazole Sodium IP", "eq. to Pantoprazole 40 mg"], ["", " 40"], ["15 Tablets", "10 x 15 Tablets"]),
    ("Okacet", "tablet", "Cetirizine Hydrochloride Tablets IP", ["Cetirizine Hydrochloride IP 10 mg"], [""], ["10 Tablets"]),
    ("Azithral", "tablet", "Azithromycin Tablets IP", ["Azithromycin IP (as Dihydrate)", "eq. to Azithromycin 500 mg"], [" 500", ""], ["3 Tablets", "1 x 5 Tablets"]),
    ("Montair", "tablet", "Montelukast Sodium Tablets IP", ["Montelukast Sodium IP", "eq. to Montelukast 10 mg"], [" 10", ""], ["15 Tablets"]),
    ("Clavam", "tablet", "Amoxycillin and Potassium Clavulanate Tablets IP",
     ["Amoxycillin Trihydrate IP", "eq. to Amoxycillin 500 mg", "Potassium Clavulanate Diluted IP", "eq. to Clavulanic Acid 125 mg"], [" 625", ""], ["6 Tablets", "1 x 10 Tablets"]),
    ("Ciplox", "tablet", "Ciprofloxacin Tablets IP", ["Ciprofloxacin Hydrochloride IP", "eq. to Ciprofloxacin 500 mg"], [" 500", ""], ["10 Tablets"]),
    ("Brufen", "tablet", "Ibuprofen Tablets IP", ["Ibuprofen IP 400 mg"], [" 400", ""], ["15 Tablets"]),
    ("Emeset", "tablet", "Ondansetron Orally Disintegrating Tablets IP", ["Ondansetron IP 4 mg"], [" 4", ""], ["10 Tablets"]),
    ("Telma", "tablet", "Telmisartan Tablets IP", ["Telmisartan IP 40 mg"], [" 40", ""], ["15 Tablets", "30 Tablets"]),
    ("Dolo", "tablet", "Paracetamol Tablets IP", ["Paracetamol IP 650 mg"], [" 650"], ["15 Tablets"]),
    ("Combiflam", "tablet", "Ibuprofen and Paracetamol Tablets IP", ["Ibuprofen IP 400 mg", "Paracetamol IP 325 mg"], [""], ["20 Tablets"]),
    ("Allegra", "tablet", "Fexofenadine Hydrochloride Tablets IP", ["Fexofenadine Hydrochloride IP 120 mg"], [" 120", ""], ["10 Tablets"]),
    ("Ecosprin", "tablet", "Aspirin Gastro-resistant Tablets IP", ["Aspirin IP 75 mg"], [" 75", ""], ["14 Tablets"]),
    ("Glycomet", "tablet", "Metformin Hydrochloride Tablets IP", ["Metformin Hydrochloride IP 500 mg"], [" 500", " SR 500"], ["10 x 10 Tablets", "20 Tablets"]),
    ("Amlokind", "tablet", "Amlodipine Tablets IP", ["Amlodipine Besilate IP", "eq. to Amlodipine 5 mg"], [" 5", "-5"], ["15 Tablets"]),
    ("Atorva", "tablet", "Atorvastatin Tablets IP", ["Atorvastatin Calcium IP", "eq. to Atorvastatin 10 mg"], [" 10", ""], ["15 Tablets"]),
    ("Thyronorm", "tablet", "Thyroxine Sodium Tablets IP", ["Thyroxine Sodium IP", "eq. to Anhydrous Thyroxine Sodium 50 mcg"], [" 50 mcg", ""], ["100 Tablets"]),
    ("Levipil", "tablet", "Levetiracetam Tablets IP", ["Levetiracetam IP 500 mg"], [" 500", ""], ["10 Tablets"]),
    ("Zerodol-SP", "tablet", "Aceclofenac, Paracetamol and Serratiopeptidase Tablets",
     ["Aceclofenac IP 100 mg", "Paracetamol IP 325 mg", "Serratiopeptidase IP 15 mg"], [""], ["10 Tablets"]),
    ("Omez", "capsule", "Omeprazole Gastro-resistant Capsules IP", ["Omeprazole IP 20 mg", "(as enteric coated pellets)"], [" 20", ""], ["15 Capsules", "20 Capsules"]),
    ("Becosules", "capsule", "Vitamin B-Complex with Vitamin C Capsules", ["Thiamine Mononitrate IP 10 mg", "Riboflavin IP 10 mg", "Ascorbic Acid IP 150 mg"], [""], ["20 Capsules"]),
    ("Doxt", "capsule", "Doxycycline Capsules IP", ["Doxycycline Hydrochloride IP", "eq. to Doxycycline 100 mg"], [" 100", ""], ["10 Capsules"]),
    ("Ascoril", "syrup", "Bromhexine, Guaiphenesin and Terbutaline Syrup", ["Terbutaline Sulphate IP 1.25 mg", "Bromhexine Hydrochloride IP 4 mg", "Guaiphenesin IP 50 mg"], [" LS", ""], ["100 ml", "60 ml"]),
    ("Calpol", "syrup", "Paracetamol Oral Suspension IP", ["Paracetamol IP 250 mg"], [" 250", ""], ["60 ml"]),
    ("Zifi Dry", "syrup", "Cefixime for Oral Suspension IP", ["Cefixime IP", "eq. to Anhydrous Cefixime 50 mg"], [""], ["30 ml"]),
    ("Monocef", "injection", "Ceftriaxone for Injection IP", ["Ceftriaxone Sodium IP", "eq. to Ceftriaxone 1 g"], [" 1 g", ""], ["1 Vial"]),
    ("Taxim", "injection", "Cefotaxime Sodium for Injection IP", ["Cefotaxime Sodium IP", "eq. to Cefotaxime 1 g"], [" 1 g", ""], ["1 Vial"]),
    ("Candid", "cream", "Clotrimazole Cream IP", ["Clotrimazole IP 1% w/w", "Cream base q.s."], [""], ["15 g", "20 g"]),
    ("Betadine", "ointment", "Povidone-Iodine Ointment USP", ["Povidone-Iodine IP 5% w/w"], [""], ["20 g"]),
    ("Tobrex", "eye drops", "Tobramycin Ophthalmic Solution", ["Tobramycin IP 0.3% w/v", "Benzalkonium Chloride IP 0.01% w/v (as preservative)"], [""], ["5 ml"]),
    ("Otrivin", "nasal spray", "Xylometazoline Hydrochloride Nasal Spray IP", ["Xylometazoline Hydrochloride IP 0.1% w/v"], [""], ["10 ml"]),
    ("Asthalin", "inhaler", "Salbutamol Inhalation Aerosol IP", ["Salbutamol Sulphate IP", "eq. to Salbutamol 100 mcg"], [""], ["200 Metered Doses"]),
    ("Shelcal", "tablet", "Calcium and Vitamin D3 Tablets IP", ["Calcium Carbonate IP 1250 mg", "eq. to Elemental Calcium 500 mg", "Cholecalciferol IP 250 IU"], [" 500", ""], ["15 Tablets"]),
    ("Rantac", "tablet", "Ranitidine Tablets IP", ["Ranitidine Hydrochloride IP", "eq. to Ranitidine 150 mg"], [" 150", ""], ["30 Tablets"]),
]
HELD = [
    ("Levoflox", "tablet", "Levofloxacin Tablets IP", ["Levofloxacin Hemihydrate IP", "eq. to Levofloxacin 500 mg"], [" 500", ""], ["10 Tablets"]),
    ("Nimulid", "tablet", "Nimesulide Tablets", ["Nimesulide BP 100 mg"], [""], ["15 Tablets"]),
    ("Vancogen", "injection", "Vancomycin Hydrochloride for Injection IP", ["Vancomycin Hydrochloride IP", "eq. to Vancomycin 500 mg"], [" 500", ""], ["1 Vial"]),
    ("Lamitor", "tablet", "Lamotrigine Tablets IP", ["Lamotrigine IP 25 mg"], [" 25", ""], ["10 Tablets"]),
    ("R-Cinex", "capsule", "Rifampicin and Isoniazid Capsules", ["Rifampicin IP 450 mg", "Isoniazid IP 300 mg"], [""], ["10 Capsules"]),
    ("Losar", "tablet", "Losartan Potassium Tablets IP", ["Losartan Potassium IP 50 mg"], [" 50", ""], ["15 Tablets"]),
    ("Grilinctus", "syrup", "Dextromethorphan and Chlorpheniramine Syrup", ["Dextromethorphan Hydrobromide IP 5 mg", "Chlorpheniramine Maleate IP 2 mg"], [""], ["100 ml"]),
]
HEADERS = {
    "tablet": ["Each film coated tablet contains:", "Each uncoated tablet contains:", "Each tablet contains:", "Composition:"],
    "capsule": ["Each hard gelatin capsule contains:", "Each capsule contains:"],
    "syrup": ["Each 5 ml contains:", "Each 5 ml of reconstituted suspension contains:"],
    "injection": ["Each vial contains:", "Composition:"],
    "cream": ["Contains:"], "ointment": ["Contains:"], "eye drops": ["Contains:"], "nasal spray": ["Contains:"],
    "inhaler": ["Each actuation delivers:"],
}
MAKERS = ["Alkem Laboratories Ltd.", "Cipla Ltd.", "Sun Pharmaceutical Industries Ltd.", "Torrent Pharmaceuticals Ltd.",
          "Zydus Lifesciences Ltd.", "Micro Labs Ltd.", "Lupin Ltd.", "Intas Pharmaceuticals Ltd.", "Akums Drugs & Pharmaceuticals Ltd.",
          "Synokem Pharmaceuticals Ltd.", "Pure & Cure Healthcare Pvt. Ltd.", "Medopharm Pvt. Ltd."]
MARKETERS = ["Abbott Healthcare Pvt. Ltd.", "Dr. Reddy's Laboratories Ltd.", "Glenmark Pharmaceuticals Ltd.", "Mankind Pharma Ltd.",
             "Macleods Pharmaceuticals Ltd.", "Ipca Laboratories Ltd."]
MADE_BY = ["Manufactured by:", "Mfd. by:", "Made in India by:", "Mfg. by:", "Manufactured by"]
SOLD_BY = ["Marketed by:", "Mktd. by:", "Distributed by:", "Marketed by"]
BATCH = ["Batch No.:", "B.No.", "B. No.:", "Batch No", "LOT", "Lot No.:", "BN:"]
MFG = ["Mfg. Date:", "MFG.", "MFD.", "Mfd.:", "Mfg Dt.", "D.O.M.:", "MFG. DATE"]
EXP = ["Expiry Date:", "EXP.", "Exp.:", "Use before", "EXP. DATE", "Best before"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
NOISE = [
    "SCHEDULE H PRESCRIPTION DRUG - CAUTION", "Not to be sold by retail without the prescription of a Registered Medical Practitioner.",
    "SCHEDULE H DRUG WARNING:", "To be sold by retail on the prescription of a Registered Medical Practitioner only.",
    "Store in a cool dry place below 30°C.", "Protect from light and moisture.", "Keep out of reach of children.",
    "Dosage: As directed by the Physician.", "Dosage: As prescribed by the Physician.", "For more information, refer package insert.",
    "® Registered Trade Mark", "(Inclusive of all taxes)", "Read the leaflet before use.",
]
# Lines that belong only on some forms: a tablet box never says "For external use only".
FORM_NOISE = {
    "syrup": ["Shake well before use.", "Use within 7 days of reconstitution.", "Do not freeze."],
    "injection": ["For I.M./I.V. use only", "Do not freeze.", "Reconstitute with Sterile Water for Injection IP"],
    "cream": ["For external use only.", "Not for ophthalmic use."], "ointment": ["For external use only."],
    "eye drops": ["For external use only.", "Use within one month of opening.", "Do not touch the nozzle tip."],
    "nasal spray": ["For nasal use only.", "Do not use for more than 7 days."],
    "inhaler": ["Shake well before use.", "Do not puncture or burn the container."],
}
TOWNS = ["Baddi, Distt. Solan (HP)", "Verna, Goa", "Sikkim", "Pithampur, Dhar (MP)", "Ahmedabad, Gujarat", "Haridwar, Uttarakhand",
         "Bengaluru, Karnataka", "Nalagarh (HP)", "Paonta Sahib (HP)", "Daman"]
LETTERS = "ABCDEFGHKLMNPRSTVZ"


def address(r):
    return (f"{r.choice(['Plot No.', 'Unit-II, Plot', 'Survey No.', 'Khasra No.', 'L-'])} {r.randint(1, 300)}, "
            f"{r.choice(['Industrial Area', 'Industrial Estate', 'Phase II', 'EPIP'])}, {r.choice(TOWNS)} {r.randint(100, 899)} {r.randint(100, 999)}")


def batch_number(r):
    return r.choice([
        lambda: f"{r.choice(LETTERS)}{r.choice(LETTERS)}{r.randint(100, 999)}{r.choice(LETTERS)}{r.randint(10, 99)}",
        lambda: f"{r.choice(LETTERS)}{r.randint(10000, 99999)}",
        lambda: f"{''.join(r.choice(LETTERS) for _ in range(3))}{r.randint(1000, 9999)}",
        lambda: f"{r.randint(1000000, 9999999)}",
        lambda: f"{r.choice(LETTERS)}{r.choice(LETTERS)}{r.randint(1, 9)}{r.choice(LETTERS)}{r.randint(100, 999)}",
    ])()


def month_year(r, style, month, year):
    return {
        "mm/yyyy": f"{month:02d}/{year}", "mm/yy": f"{month:02d}/{str(year)[2:]}", "mm-yyyy": f"{month:02d}-{year}",
        "MON.yyyy": f"{MONTHS[month - 1]}.{year}", "MON yyyy": f"{MONTHS[month - 1]} {year}", "MON-yy": f"{MONTHS[month - 1]}-{str(year)[2:]}",
        "mm.yyyy": f"{month:02d}.{year}",
    }[style]


def pack(r, held=False, blank=None, med=None):
    """One pack face. Returns (answer, lines)."""
    out = blank("MEDICINE_PACK")
    brand, form, generic, parts, strengths, sizes = r.choice(HELD if held else TRAIN)
    strength = r.choice(strengths)
    upper = r.random() < 0.3
    brand_shown, strength_shown = (brand.upper(), strength.upper()) if upper else (brand, strength)
    shown = f"{brand_shown}{strength_shown}"
    maker, marketer = r.choice(MAKERS), r.choice(MARKETERS)
    style = r.choice(["mm/yyyy", "mm/yyyy", "mm/yy", "mm-yyyy", "MON.yyyy", "MON yyyy", "MON-yy", "mm.yyyy"])
    month, year = r.randint(1, 12), r.choice([2025, 2026])
    mfg = month_year(r, style, month, year)
    exp = month_year(r, style, (month + r.randint(-2, 2) - 1) % 12 + 1, year + r.choice([2, 2, 3]))
    batch = batch_number(r)
    face = r.random()

    if face < 0.3:  # front: generic name, brand, strength, pack size
        mark = r.choice(["®", "", ""])
        lines = [r.choice([f"Rx {generic}", generic, f"Rx\n{generic}"]), f"{brand_shown}{mark}{strength_shown}", r.choice(sizes)]
        lines = "\n".join(lines).split("\n")
        if r.random() < 0.5:
            lines.insert(r.randint(1, len(lines)), r.choice(NOISE[:4] + [marketer]))
        out["medicines"].append(med(name=shown, composition=generic))
        return out, lines

    if face < 0.45:  # a foil strip: brand repeated, cut-off fragments at the edges, stamps at one end
        cut = shown[r.randint(1, max(1, len(shown) // 2)):]
        lines = [cut, shown, generic, shown, f"{r.choice(MADE_BY)} {maker}"]
        stamped = r.random() < 0.75
        if stamped:
            lines.append(f"{r.choice(BATCH)} {batch} {r.choice(EXP)} {exp}")
        lines.append(shown)
        out["medicines"].append(med(name=shown, composition=generic, manufacturer=maker,
                                    batch=batch if stamped else None, expiryDate=exp if stamped else None))
        return out, lines

    # back or side panel: composition, licence, batch and dates, makers, warnings
    has_name = r.random() < 0.7
    lines = ([shown] if has_name else []) + [r.choice(HEADERS[form]), *parts]
    if form in ("tablet", "capsule"):
        lines.append(r.choice(["Excipients q.s.", "Excipients q.s.", "Approved colour used"]))
    block_end = len(lines)
    lines.append(f"Mfg. Lic. No.: {r.choice(['G/25/', 'MB/06/', 'KTK/28/', 'HP/DRUGS/', '22-B/'])}{r.randint(100, 999)}")
    layout = r.random()
    stamps_from = len(lines)
    answer = {"batch": batch, "mfgDate": mfg, "expiryDate": exp}
    if layout < 0.4:  # labelled lines
        lines += [f"{r.choice(BATCH)} {batch}", f"{r.choice(MFG)} {mfg}", f"{r.choice(EXP)} {exp}"]
    elif layout < 0.6:  # one stamped line
        lines.append(f"{r.choice(BATCH)} {batch}  {r.choice(MFG)} {mfg}  {r.choice(EXP)} {exp}")
    elif layout < 0.8:  # printed labels, then the stamped values beside them read as a separate column, in order
        lines += [r.choice(BATCH), r.choice(MFG), r.choice(EXP), batch, mfg, exp]
    elif layout < 0.88:  # values read against the wrong labels; copied as written, the app takes the later date as expiry
        lines += [f"Batch No.: {batch}", mfg, f"Mfg. Date: {exp}", "Expiry Date:"]
        answer = {"batch": batch, "mfgDate": exp, "expiryDate": None}
    else:  # nothing stamped on this face: an address PIN code or licence number is not a batch
        answer = {"batch": None, "mfgDate": None, "expiryDate": None}
    stamps_to = len(lines)
    if r.random() < 0.6:
        per = ["", "(Incl. of all taxes)"] + (["per strip of 10 tablets"] if form in ("tablet", "capsule") else [])
        lines.append(f"M.R.P. {r.choice(['Rs.', '₹', 'Rs'])} {r.randint(30, 450)}.{r.randint(0, 99):02d} {r.choice(per)}".strip())
    if r.random() < 0.35:
        lines.append("".join(r.choice(LETTERS) for _ in range(8)) + str(r.randint(100000, 999999)))
    pool = NOISE + FORM_NOISE.get(form, [])
    for line in r.sample(pool, r.randint(2, 5)):
        spot = r.choice([r.randint(block_end, stamps_from - 1), r.randint(stamps_to, len(lines))])
        if spot <= stamps_from - 1:
            stamps_from, stamps_to = stamps_from + 1, stamps_to + 1
        lines.insert(spot, line)
    # Who made it: never the marketer. "Manufactured for X by Y" means Y made it.
    if r.random() < 0.15:
        lines += [f"Manufactured for: {marketer}", f"by: {maker}", address(r)]
    else:
        lines += [r.choice(SOLD_BY), marketer]
        if r.random() < 0.4:
            lines.append(address(r))
        lines += [r.choice(MADE_BY), maker, address(r)]
    out["medicines"].append(med(name=shown if has_name else None, composition=" ".join(parts), manufacturer=maker, **answer))
    return out, lines
