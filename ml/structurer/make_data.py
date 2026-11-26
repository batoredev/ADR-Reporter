"""Synthetic training data for the two-step reader's structuring step.

Each example is the kind of text the local vision model writes out from a photo
(an Indian prescription, a medicine box or strip, a US practice script), paired
with the exact JSON the structuring step must return. Everything is fictional and
generated from the lists below. The reporter's own test photos are never used, so
they stay a fair test. Transcription slips (URTl, x sd, 50S, pack columns read out
of order) are copied as written in the answer, because fixed code in the app
corrects them afterwards.

    .venv-ml/Scripts/python.exe ml/structurer/make_data.py --train 2400 --val 200
"""

import argparse
import json
import random
from pathlib import Path

FIRST = "Ravi Priya Anil Meena Suresh Kavya Arjun Lakshmi Vikram Deepa Rahul Anjali Kiran Sunita Manoj Rekha Nikhil Pooja Sanjay Divya".split()
LAST = "Sharma Nair Reddy Iyer Menon Das Patel Singh Gupta Pillai Rao Verma Joshi Kulkarni Bose Varghese".split()
US_NAMES = ["Mary Jones", "Robert Brown", "Linda Davis", "James Miller", "Susan Wilson"]
DIAGNOSES = [
    "URTI", "UTI", "LRTI", "Acute sinusitis", "Allergic rhinitis", "Acute gastroenteritis", "Viral fever",
    "Acute pharyngitis", "Tonsillitis", "Dental abscess", "Cellulitis", "Bronchitis", "Otitis media",
    "Migraine", "Dyspepsia", "Conjunctivitis", "Fungal infection",
]
VITALS = ["RR-24/min", "BP 120/80 mmHg", "SpO2 98%", "Temp 100.2 F", "PR 88/min", "RS-B/L AEE", "CVS S1S2+"]

# (name, form word, strength): medicines other than those in the reporter's test photos.
ORAL = [
    ("Azithromycin", "Tab", "500mg"), ("Cefixime", "Tab", "200 mg"), ("Pantoprazole", "Tab", "40mg"),
    ("Cetirizine", "Tab", "10mg"), ("Montelukast", "Tab", "10 mg"), ("Paracetamol", "Tab", "650mg"),
    ("Dolo", "Tab", "650"), ("Augmentin", "Tab", "625"), ("Metformin", "Tab", "500mg"), ("Amlodipine", "Tab", "5mg"),
    ("Doxycycline", "Cap", "100mg"), ("Omeprazole", "Cap", "20 mg"), ("Ondansetron", "Tab", "4mg"),
    ("Levocetirizine", "Tab", "5mg"), ("Ibuprofen", "Tab", "400mg"), ("Ciprofloxacin", "Tab", "500 mg"),
    ("Metronidazole", "Tab", "400mg"), ("Domperidone", "Tab", "10mg"), ("Zerodol-P", "Tab", ""),
    ("Pan-D", "Cap", ""), ("Telma", "Tab", "40"), ("Glycomet", "Tab", "500"), ("Allegra", "Tab", "120"),
]
SYRUPS = [
    ("Crocin", "(120/5)"), ("Ibugesic", "(100/5)"), ("Zifi", "(50/5)"), ("Asthalin", "(2/5)"), ("Ondem", "(2/5)"),
    ("Cetzine", "(5/5)"), ("Azee", "(200/5)"), ("Mox", "(125/5)"), ("Domstal", "(5/5)"),
]
OTHER = [
    ("Otrivin", "Nasal drops", "2 drops each nostril"), ("Nasivion", "Nasal spray", "1 spray each nostril"),
    ("Budecort", "Respules", "1 respule"), ("Moxifloxacin", "Eye drops", "1 drop"),
    ("Clotrimazole", "Cream", "apply thin layer"), ("Ceftriaxone", "Inj", "1g IV"), ("Pheniramine", "Inj", "1 amp IM"),
]
FREQ = ["OD", "BD", "TDS", "QID", "HS", "SOS", "1-0-1", "1-1-1", "0-0-1", "1-0-0", "Q6H", "Q8H", "stat"]
DURATION = ["x 3d", "x 5d", "x 7 days", "x 5 days", "for 2 weeks", "x 10d", "x 1 week", "for 3 days", ""]

PACK_BRANDS = [
    ("Zifi", "Cefixime Tablets IP", "Cefixime IP 200 mg"),
    ("Pantocid", "Pantoprazole Gastro-resistant Tablets IP", "Pantoprazole Sodium IP eq. to Pantoprazole 40 mg"),
    ("Okacet", "Cetirizine Hydrochloride Tablets IP", "Cetirizine Hydrochloride IP 10 mg"),
    ("Azithral", "Azithromycin Tablets IP", "Azithromycin IP 500 mg"),
    ("Montair", "Montelukast Sodium Tablets IP", "Montelukast Sodium IP eq. to Montelukast 10 mg"),
    ("Clavam", "Amoxycillin and Potassium Clavulanate Tablets IP",
     "Amoxycillin Trihydrate IP eq. to Amoxycillin 500 mg|Potassium Clavulanate Diluted IP eq. to Clavulanic Acid 125 mg"),
    ("Ciplox", "Ciprofloxacin Tablets IP", "Ciprofloxacin Hydrochloride IP eq. to Ciprofloxacin 500 mg"),
    ("Brufen", "Ibuprofen Tablets IP", "Ibuprofen IP 400 mg"),
    ("Emeset", "Ondansetron Orally Disintegrating Tablets IP", "Ondansetron IP 4 mg"),
    ("Telma", "Telmisartan Tablets IP", "Telmisartan IP 40 mg"),
]
MAKERS = ["Alkem Laboratories Ltd.", "Cipla Ltd.", "Sun Pharmaceutical Industries Ltd.", "Torrent Pharmaceuticals Ltd.",
          "Zydus Lifesciences Ltd.", "Micro Labs Ltd.", "Lupin Ltd.", "Intas Pharmaceuticals Ltd."]
MARKETERS = ["Abbott Healthcare Pvt. Ltd.", "Dr. Reddy's Laboratories Ltd.", "Glenmark Pharmaceuticals Ltd.", "Mankind Pharma Ltd."]

KEYS = ["documentType", "documentDate", "patientName", "age", "ageUnit", "gender", "weightKg", "diagnosis",
        "reaction", "reactionStartDate", "reactionStopDate", "reactionDetails", "reactionTreatment",
        "medicalHistory", "medicines", "tests"]
MED_KEYS = ["name", "composition", "dose", "route", "frequency", "duration", "indication", "startDate", "stopDate",
            "manufacturer", "batch", "mfgDate", "expiryDate"]


def blank(document_type="PRESCRIPTION"):
    out = {k: ([] if k in ("medicines", "tests") else None) for k in KEYS}
    out["documentType"] = document_type
    return out


def med(**fields):
    return {k: fields.get(k) for k in MED_KEYS}


def clinic_line(r):
    return r.choice([
        f"Dr. {r.choice(FIRST)} {r.choice(LAST)}, MBBS, MD",
        f"Reg. No.: {r.randint(10000, 99999)}",
        f"Ph: 9{r.randint(100000000, 999999999)}",
        "Timings: 9.00 to 1.00, 5.00 to 8.00",
        f"{r.choice(LAST)} Clinic",
    ])


def date_written(r):
    d, m, y = r.randint(1, 28), r.randint(1, 12), r.choice([2024, 2025, 2026])
    return r.choice([f"{d}/{m}/{y}", f"{d:02d}/{m:02d}/{y}", f"{d}-{m}-{y}", f"{d}.{m:02d}.{str(y)[2:]}", f"{d}/{m}/{str(y)[2:]}"])


def prescription(r):
    out, lines = blank(), []
    for _ in range(r.randint(0, 2)):
        lines.append(clinic_line(r))
    date = date_written(r)
    first, last = r.choice(FIRST), r.choice(LAST)
    young = r.random() < 0.3
    age = r.randint(1, 12) if young else r.randint(18, 80)
    sex = r.choice(["M", "F"])
    weight = r.choice(["", str(r.randint(10, 30)) + r.choice(["", ".5", ".25"])]) if young else r.choice(["", str(r.randint(40, 90))])
    style = r.random()
    if style < 0.33:
        name = f"{first[0]}. {last}"
        lines += [f"{date}. {weight + 'kg' if weight else ''}".strip(), f"{name}, {age}, {sex}."]
    elif style < 0.66:
        name = first.upper()
        lines += [f"Date: {date}", f"Name: {name}", f"Age, Gender: {age} yrs / {sex}"]
        if weight:
            lines.append(f"Weight: {weight} kg")
    else:
        name = f"{first} {last}"
        lines += [f"Pt: {name}  Age/Sex: {age}/{sex}", f"Dt {date}"]
        if weight:
            lines.append(f"Wt: {weight} kg")
    out.update(documentDate=date, patientName=name, age=str(age), ageUnit="YEARS",
               gender="MALE" if sex == "M" else "FEMALE", weightKg=weight or None)
    if r.random() < 0.6:
        lines.append(r.choice(VITALS))
    if r.random() < 0.7:
        diagnosis = r.choice(DIAGNOSES)
        written = diagnosis.replace("I", "l", 1) if diagnosis.isupper() and r.random() < 0.2 else diagnosis
        if r.random() < 0.6:
            lines += ["Clinical Description:", f"{written} {r.choice(VITALS) if r.random() < 0.5 else ''}".strip()]
        else:
            lines.append(f"Dx: {written}")
        out["diagnosis"] = written
    lines.append(r.choice(["Rx", "Advice:", "Rx:"]))
    for _ in range(r.randint(1, 4)):
        kind = r.random()
        if kind < 0.5:
            drug, form, strength = r.choice(ORAL)
            dose = r.choice(["1 tab", "1", "", "1 cap" if form == "Cap" else "1 tab"])
            freq, dur = r.choice(FREQ), r.choice(DURATION)
            if dur == "x 5d" and r.random() < 0.3:
                dur = "x sd"
            name = " ".join(p for p in [form, drug, strength] if p)
            lines.append(" ".join(p for p in [name, dose, freq, dur] if p))
            out["medicines"].append(med(name=name, dose=dose or None, frequency=freq, duration=dur or None))
        elif kind < 0.8:
            drug, strength = r.choice(SYRUPS)
            ml = r.choice(["2.5 ml", "5ML", "3 ML", "4ml", "7.5 ml"])
            freq, dur = r.choice(["TDS", "BD", "Q6H", "SOS", "QID", "HS"]), r.choice(DURATION)
            name = f"{r.choice(['syp', 'Syp.', 'SYP'])} {drug.upper() if r.random() < 0.5 else drug} {strength}"
            written_freq = "50S" if freq == "SOS" and r.random() < 0.3 else freq
            lines.append(" ".join(p for p in [name, ml, written_freq, dur] if p))
            out["medicines"].append(med(name=name, dose=ml, frequency=written_freq, duration=dur or None))
        else:
            drug, form, dose = r.choice(OTHER)
            freq = r.choice(["BD", "TDS", "0-0-1", "1-0-1", "stat", "OD"])
            name = f"Inj {drug}" if form == "Inj" else f"{drug} {form}"
            route = "IV" if dose.endswith(" IV") else "IM" if dose.endswith(" IM") else None
            plain_dose = dose[: -3] if route else dose
            dur = None
            if r.random() < 0.5 and not route:
                dur = r.choice(["for 1 week", "x 5 days", None])
                lines += [f"{name} - {freq}", " ".join(p for p in [dose, dur] if p)]
            else:
                lines.append(f"{name} {dose} {freq}")
            out["medicines"].append(med(name=name, dose=plain_dose, route=route, frequency=freq, duration=dur))
    if r.random() < 0.4:
        lines.append(r.choice(["Review after 5 days", "Plenty of fluids", "Follow up if needed"]))
    return out, lines


def us_script(r):
    out, name = blank(), r.choice(US_NAMES)
    drug, strength = r.choice([("Cephalexin", "250 mg capsules"), ("Ibuprofen", "400 mg tablets"), ("Penicillin VK", "500 mg tablets")])
    count, n, freq, days = r.choice([20, 28, 30, 40]), r.choice(["T", "T T"]), r.choice(["b.i.d.", "t.i.d.", "q.i.d."]), r.choice([5, 10, 14])
    m, d, y = r.randint(1, 12), r.randint(1, 28), r.choice(["01", "02", "99"])
    form = strength.split()[-1]
    lines = [f"Patient Name: {name}", f"Address: {r.randint(10, 999)} Main Street", f"Springfield, IL {r.randint(60000, 62999)}",
             f"Rx {drug} {strength} # {count}", f"{n} {form} p.o. {freq} X {days} days", "Do Not Refill X", f"Date {m}/{d}/{y}"]
    out.update(documentDate=f"{m}/{d}/{y}", patientName=name)
    out["medicines"].append(med(name=f"{drug} {strength}", dose=f"{2 if n == 'T T' else 1} {form}", route="p.o.",
                                frequency=freq, duration=f"X {days} days"))
    return out, lines


def pack(r):
    out = blank("MEDICINE_PACK")
    brand, generic, composition = r.choice(PACK_BRANDS)
    maker, marketer = r.choice(MAKERS), r.choice(MARKETERS)
    letters = "ABCDEFGHKMNPRSTZ"
    batch = f"{r.choice(letters)}{r.choice(letters)}{r.randint(100, 999)}{r.choice(letters)}{r.randint(10, 99)}"
    mm, yy = r.randint(1, 12), r.choice([2025, 2026])
    mfg, exp = f"{mm:02d}/{yy}", f"{mm:02d}/{yy + r.choice([2, 3])}"
    price = f"{r.randint(40, 400)}.{r.randint(10, 99)}"
    if r.random() < 0.35:  # front: brand and generic name
        strength = r.choice(["", " 500", " 200", " 10"])
        mark = r.choice(["®", ""])
        lines = [f"Rx {generic}", f"{brand}{mark}{strength}", f"{r.choice([10, 15])} Tablets"]
        entry = med(name=f"{brand}{strength}", composition=generic)
    else:  # back or side: composition, licence, batch, dates, makers
        has_name = r.random() < 0.7
        parts = composition.split("|")
        lines = ([brand] if has_name else []) + ["Composition:", "Each film coated tablet contains :", *parts, "Excipients q.s."]
        lines.append(f"Mfg. Lic. No.: {r.choice(['G/25/', 'MB/06/', 'KTK/28/'])}{r.randint(100, 999)}")
        shifted = r.random() < 0.3
        if shifted:  # labels and stamped values transcribed in separate columns
            lines += [f"Batch No.: {batch}", mfg, f"Mfg. Date: {exp}", price, "Expiry Date:"]
        else:
            lines += [f"Batch No.: {batch}", f"Mfg. Date: {mfg}", f"Expiry Date: {exp}", f"M.R.P. Rs. {price}"]
        lines += ["Marketed by:", marketer, "Manufactured by:", maker]
        # Shifted columns: the text says "Mfg. Date: <expiry>", so that is what is copied; the app corrects it.
        entry = med(name=brand if has_name else None, composition=" ".join(parts), manufacturer=maker, batch=batch,
                    mfgDate=exp if shifted else mfg, expiryDate=None if shifted else exp)
    out["medicines"].append(entry)
    return out, lines


def example(r):
    kind = r.random()
    out, lines = prescription(r) if kind < 0.55 else pack(r) if kind < 0.9 else us_script(r)
    return {"transcript": "\n".join(lines), "target": {k: out[k] for k in KEYS}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=int, default=2400)
    parser.add_argument("--val", type=int, default=200)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--out", default="ml/data/structurer")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    r = random.Random(args.seed)
    for split, n in (("train", args.train), ("val", args.val)):
        with open(out / f"{split}.jsonl", "w", encoding="utf-8") as f:
            for _ in range(n):
                f.write(json.dumps(example(r), ensure_ascii=False) + "\n")
    print(f"Wrote {args.train} training and {args.val} validation examples to {out}")


if __name__ == "__main__":
    main()
