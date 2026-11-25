// Reference names for recognising medicines as reporters and prescriptions write
// them. A reading one slip away from a listed name ("Crosin", "Cefixim",
// "Paracetamal") is that medicine; two listed names are never merged, which keeps
// look-alike drugs (ampicillin/amoxicillin, prednisone/prednisolone) apart.
// A starting list for Indian hospital practice, not a complete formulary:
// anything not listed is still matched against the other names in the report.

/** Generic (INN) names, lower case. Look-alike partners are listed deliberately. */
export const GENERIC_NAMES = // Antibiotics and anti-infectives
  (
    "amoxicillin ampicillin cloxacillin flucloxacillin dicloxacillin penicillin benzathine piperacillin tazobactam " +
    "clavulanate sulbactam cefalexin cefadroxil cefazolin cefuroxime cefaclor cefixime cefpodoxime cefdinir cefotaxime " +
    "ceftriaxone ceftazidime cefoperazone cefepime ceftaroline cefoxitin imipenem meropenem ertapenem doripenem aztreonam " +
    "azithromycin clarithromycin erythromycin roxithromycin clindamycin lincomycin doxycycline minocycline tetracycline " +
    "tigecycline ciprofloxacin ofloxacin levofloxacin moxifloxacin norfloxacin gatifloxacin prulifloxacin nalidixic " +
    "gentamicin amikacin tobramycin streptomycin netilmicin vancomycin teicoplanin linezolid daptomycin colistin " +
    "polymyxin metronidazole tinidazole ornidazole secnidazole nitrofurantoin fosfomycin sulfamethoxazole trimethoprim " +
    "cotrimoxazole chloramphenicol rifampicin rifabutin rifapentine isoniazid pyrazinamide ethambutol bedaquiline " +
    "delamanid pretomanid cycloserine ethionamide clofazimine dapsone fluconazole itraconazole voriconazole " +
    "posaconazole ketoconazole clotrimazole miconazole terbinafine griseofulvin nystatin amphotericin caspofungin " +
    "micafungin acyclovir valacyclovir famciclovir ganciclovir valganciclovir oseltamivir remdesivir favipiravir " +
    "tenofovir lamivudine zidovudine abacavir efavirenz nevirapine dolutegravir raltegravir lopinavir ritonavir " +
    "atazanavir darunavir sofosbuvir daclatasvir velpatasvir entecavir chloroquine hydroxychloroquine artesunate " +
    "artemether lumefantrine primaquine quinine mefloquine albendazole mebendazole ivermectin praziquantel " +
    "pyrantel diethylcarbamazine permethrin " +
    // Analgesics, anti-inflammatories, antipyretics
    "paracetamol ibuprofen diclofenac aceclofenac naproxen ketorolac mefenamic indomethacin piroxicam meloxicam " +
    "etoricoxib celecoxib nimesulide aspirin tramadol tapentadol morphine fentanyl pethidine buprenorphine codeine " +
    "dicyclomine drotaverine hyoscine metamizole " +
    // Antihistamines and allergy
    "cetirizine levocetirizine fexofenadine loratadine desloratadine pheniramine chlorpheniramine hydroxyzine " +
    "promethazine diphenhydramine bilastine rupatadine ebastine montelukast ketotifen oxymetazoline xylometazoline " +
    // Gastrointestinal
    "pantoprazole omeprazole esomeprazole rabeprazole lansoprazole ranitidine famotidine domperidone metoclopramide " +
    "ondansetron granisetron itopride sucralfate lactulose bisacodyl loperamide racecadotril mesalamine sulfasalazine " +
    "ursodeoxycholic simethicone " +
    // Cardiovascular
    "amlodipine nifedipine cilnidipine felodipine diltiazem verapamil atenolol metoprolol bisoprolol carvedilol " +
    "propranolol nebivolol labetalol losartan telmisartan olmesartan valsartan irbesartan candesartan enalapril " +
    "ramipril lisinopril captopril perindopril hydrochlorothiazide chlorthalidone indapamide furosemide torsemide " +
    "spironolactone eplerenone clonidine methyldopa hydralazine prazosin atorvastatin rosuvastatin simvastatin " +
    "fenofibrate ezetimibe clopidogrel prasugrel ticagrelor warfarin acenocoumarol heparin enoxaparin dabigatran " +
    "apixaban rivaroxaban digoxin amiodarone nitroglycerin isosorbide ivabradine ranolazine sacubitril trimetazidine " +
    "dopamine dobutamine noradrenaline adrenaline atropine " +
    // Diabetes and endocrine
    "metformin glimepiride gliclazide glipizide glibenclamide pioglitazone sitagliptin vildagliptin teneligliptin " +
    "linagliptin saxagliptin dapagliflozin empagliflozin canagliflozin voglibose acarbose insulin glargine detemir " +
    "degludec aspart lispro levothyroxine carbimazole methimazole propylthiouracil " +
    // Steroids
    "prednisolone prednisone methylprednisolone dexamethasone betamethasone hydrocortisone deflazacort budesonide " +
    "fluticasone beclomethasone mometasone triamcinolone clobetasol " +
    // Respiratory
    "salbutamol levosalbutamol terbutaline formoterol salmeterol tiotropium ipratropium theophylline etofylline " +
    "doxofylline acebrophylline ambroxol bromhexine guaifenesin dextromethorphan " +
    // Neurology and psychiatry
    "phenytoin carbamazepine oxcarbazepine valproate levetiracetam lamotrigine topiramate phenobarbital clobazam " +
    "clonazepam lorazepam diazepam alprazolam midazolam gabapentin pregabalin amitriptyline nortriptyline " +
    "imipramine sertraline fluoxetine escitalopram citalopram paroxetine venlafaxine duloxetine mirtazapine " +
    "trazodone bupropion haloperidol olanzapine risperidone quetiapine aripiprazole clozapine lithium donepezil " +
    "levodopa carbidopa pramipexole ropinirole trihexyphenidyl betahistine cinnarizine flunarizine zolpidem " +
    // Others
    "allopurinol febuxostat colchicine methotrexate leflunomide azathioprine mycophenolate tacrolimus cyclosporine " +
    "cyclophosphamide cisplatin carboplatin oxaliplatin paclitaxel docetaxel doxorubicin fluorouracil capecitabine " +
    "imatinib tamoxifen letrozole iron ferrous folic cyanocobalamin methylcobalamin pyridoxine thiamine calcium " +
    "cholecalciferol zinc potassium sodium magnesium tranexamic vitamin oxytocin misoprostol mifepristone " +
    "progesterone estradiol sildenafil tamsulosin finasteride alendronate iohexol iodixanol ketamine propofol " +
    "lidocaine bupivacaine succinylcholine vecuronium rocuronium neostigmine naloxone"
  )
    .split(/\s+/)
    .filter(Boolean);

/**
 * Brand names in common Indian use, mapped to their ingredients ("+" for combinations).
 * Only well-established brands are listed; an unlisted brand is matched by spelling alone.
 */
export const BRAND_NAMES: Record<string, string> = {
  crocin: "paracetamol",
  dolo: "paracetamol",
  calpol: "paracetamol",
  pacimol: "paracetamol",
  combiflam: "ibuprofen+paracetamol",
  brufen: "ibuprofen",
  voveran: "diclofenac",
  zerodol: "aceclofenac",
  "zerodol-p": "aceclofenac+paracetamol",
  meftal: "mefenamic",
  "meftal-spas": "dicyclomine+mefenamic",
  "meftal-p": "mefenamic",
  ibugesic: "ibuprofen",
  "ibugesic-plus": "ibuprofen+paracetamol",
  nasivion: "oxymetazoline",
  otrivin: "xylometazoline",
  zyrtec: "cetirizine",
  ultracet: "paracetamol+tramadol",
  avil: "pheniramine",
  cetzine: "cetirizine",
  okacet: "cetirizine",
  alerid: "cetirizine",
  levocet: "levocetirizine",
  xyzal: "levocetirizine",
  allegra: "fexofenadine",
  montair: "montelukast",
  "montek-lc": "levocetirizine+montelukast",
  pan: "pantoprazole",
  pantop: "pantoprazole",
  pantocid: "pantoprazole",
  "pan-d": "domperidone+pantoprazole",
  omez: "omeprazole",
  razo: "rabeprazole",
  rantac: "ranitidine",
  aciloc: "ranitidine",
  zinetac: "ranitidine",
  emeset: "ondansetron",
  ondem: "ondansetron",
  vomikind: "ondansetron",
  domstal: "domperidone",
  perinorm: "metoclopramide",
  augmentin: "amoxicillin+clavulanate",
  clavam: "amoxicillin+clavulanate",
  moxclav: "amoxicillin+clavulanate",
  mox: "amoxicillin",
  novamox: "amoxicillin",
  azee: "azithromycin",
  azithral: "azithromycin",
  zifi: "cefixime",
  "taxim-o": "cefixime",
  taxim: "cefotaxime",
  monocef: "ceftriaxone",
  cifran: "ciprofloxacin",
  ciplox: "ciprofloxacin",
  oflox: "ofloxacin",
  zanocin: "ofloxacin",
  levoflox: "levofloxacin",
  metrogyl: "metronidazole",
  flagyl: "metronidazole",
  septran: "sulfamethoxazole+trimethoprim",
  bactrim: "sulfamethoxazole+trimethoprim",
  forcan: "fluconazole",
  zentel: "albendazole",
  glycomet: "metformin",
  amaryl: "glimepiride",
  ecosprin: "aspirin",
  disprin: "aspirin",
  clopilet: "clopidogrel",
  telma: "telmisartan",
  amlokind: "amlodipine",
  amlong: "amlodipine",
  stamlo: "amlodipine",
  thyronorm: "levothyroxine",
  eltroxin: "levothyroxine",
  asthalin: "salbutamol",
  budecort: "budesonide",
  foracort: "budesonide+formoterol",
  seroflo: "fluticasone+salmeterol",
  duolin: "ipratropium+levosalbutamol",
  deriphyllin: "etofylline+theophylline",
  wysolone: "prednisolone",
  omnacortil: "prednisolone",
  dexona: "dexamethasone",
  betnesol: "betamethasone",
  lasix: "furosemide",
  aldactone: "spironolactone",
  eptoin: "phenytoin",
  dilantin: "phenytoin",
  tegretol: "carbamazepine",
  valparin: "valproate",
  levipil: "levetiracetam",
  keppra: "levetiracetam",
};

/** Short forms doctors write for a generic ("Azithro", "PCM"). Matched exactly, never by spelling. */
export const ABBREVIATIONS: Record<string, string> = {
  azithro: "azithromycin",
  amox: "amoxicillin",
  cipro: "ciprofloxacin",
  levoflox: "levofloxacin",
  metro: "metronidazole",
  pcm: "paracetamol",
  ctz: "cetirizine",
  hcq: "hydroxychloroquine",
  inh: "isoniazid",
  mtx: "methotrexate",
  cotrimox: "sulfamethoxazole+trimethoprim",
  augmentin: "amoxicillin+clavulanate",
  "amox-clav": "amoxicillin+clavulanate",
  "pip-taz": "piperacillin+tazobactam",
  "pip-tazo": "piperacillin+tazobactam",
};
