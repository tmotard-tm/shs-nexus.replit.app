import { Router } from "express";
import { fleetScopeStorage } from "./fleet-scope-storage";
import { storage } from "./storage";
import { fsDb } from "./fleet-scope-db";
import { approvedCostRecords, vehicleMaintenanceCosts, pmfRows, spareVehicleDetails, registrationTracking, rentalWeeklyManual, pickupWeeklySnapshots, regMessages, regScheduledMessages } from "@shared/fleet-scope-schema";
import { sql, eq, desc, and, isNull, count } from "drizzle-orm";
import { broadcastMessage, getNextAllowedSendTime, sendTwilioMessage } from "./fleet-scope-reg-messaging";
import { insertTruckSchema, updateTruckSchema, insertTrackingRecordSchema, parseStatus, validateStatus, normalizeStatusLegacy } from "@shared/fleet-scope-schema";
import { z } from "zod";
import { testConnection, executeQuery, getTableData, getTableSchema } from "./fleet-scope-snowflake";
import { trackPackage, testUPSConnection, checkRateLimit } from "./fleet-scope-ups";
import { parqApi } from "./fleet-scope-pmf-api";
import { fetchFleetFinderData, fetchFleetFinderVehicleInfo, prewarmFleetFinderCache, type FleetFinderLocationData, type FleetFinderVehicleInfo } from "./fleet-scope-fleet-finder";
import { fetchSamsaraLocations, testSamsaraConnection, type SamsaraLocationData } from "./fleet-scope-samsara";
import { reverseGeocode, batchReverseGeocode, getGeocodeStats } from "./fleet-scope-reverse-geocode";
import sgMail from "@sendgrid/mail";
import multer from "multer";

function getDb() {
  if (!fsDb) throw new Error("Fleet-Scope database not configured (FS_DATABASE_URL missing)");
  return fsDb;
}

// Configure multer for file uploads (memory storage for processing)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Initialize SendGrid
if (process.env.FS_SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.FS_SENDGRID_API_KEY);
}

// Technician data cache (populated from TPMS_EXTRACT on startup and daily refresh)
let technicianDataCache: Map<string, { fullName: string; techNo: string; mobilePhone: string; managerName: string; managerPhone: string; enterpriseId: string; fullAddress: string }> = new Map();
let technicianCacheLastUpdated: Date | null = null;

// Manual spare truck cleanup tracker - runs once per day
let lastManualTruckCleanup: Date | null = null;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getCachedTechnicianData(): Map<string, { fullName: string; techNo: string; mobilePhone: string; managerName: string; managerPhone: string; fullAddress: string }> {
  return technicianDataCache;
}

// Helper to normalize vehicle ID for matching
function normalizeFleetIdForCache(id: string): string {
  const digits = id.replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

// ZIP code prefix to state mapping for data validation
// First 3 digits of ZIP code map to specific states
const zipPrefixToState: Record<string, string> = {
  // Arkansas: 716-729
  '716': 'AR', '717': 'AR', '718': 'AR', '719': 'AR',
  '720': 'AR', '721': 'AR', '722': 'AR', '723': 'AR', '724': 'AR',
  '725': 'AR', '726': 'AR', '727': 'AR', '728': 'AR', '729': 'AR',
  // Alaska: 995-999
  '995': 'AK', '996': 'AK', '997': 'AK', '998': 'AK', '999': 'AK',
  // Alabama: 350-369
  '350': 'AL', '351': 'AL', '352': 'AL', '354': 'AL', '355': 'AL', '356': 'AL',
  '357': 'AL', '358': 'AL', '359': 'AL', '360': 'AL', '361': 'AL', '362': 'AL',
  '363': 'AL', '364': 'AL', '365': 'AL', '366': 'AL', '367': 'AL', '368': 'AL', '369': 'AL',
  // Arizona: 850-865
  '850': 'AZ', '851': 'AZ', '852': 'AZ', '853': 'AZ', '855': 'AZ', '856': 'AZ',
  '857': 'AZ', '859': 'AZ', '860': 'AZ', '863': 'AZ', '864': 'AZ', '865': 'AZ',
  // California: 900-961
  '900': 'CA', '901': 'CA', '902': 'CA', '903': 'CA', '904': 'CA', '905': 'CA',
  '906': 'CA', '907': 'CA', '908': 'CA', '910': 'CA', '911': 'CA', '912': 'CA',
  '913': 'CA', '914': 'CA', '915': 'CA', '916': 'CA', '917': 'CA', '918': 'CA',
  '919': 'CA', '920': 'CA', '921': 'CA', '922': 'CA', '923': 'CA', '924': 'CA',
  '925': 'CA', '926': 'CA', '927': 'CA', '928': 'CA', '930': 'CA', '931': 'CA',
  '932': 'CA', '933': 'CA', '934': 'CA', '935': 'CA', '936': 'CA', '937': 'CA',
  '938': 'CA', '939': 'CA', '940': 'CA', '941': 'CA', '942': 'CA', '943': 'CA',
  '944': 'CA', '945': 'CA', '946': 'CA', '947': 'CA', '948': 'CA', '949': 'CA',
  '950': 'CA', '951': 'CA', '952': 'CA', '953': 'CA', '954': 'CA', '955': 'CA',
  '956': 'CA', '957': 'CA', '958': 'CA', '959': 'CA', '960': 'CA', '961': 'CA',
  // Colorado: 800-816
  '800': 'CO', '801': 'CO', '802': 'CO', '803': 'CO', '804': 'CO', '805': 'CO',
  '806': 'CO', '807': 'CO', '808': 'CO', '809': 'CO', '810': 'CO', '811': 'CO',
  '812': 'CO', '813': 'CO', '814': 'CO', '815': 'CO', '816': 'CO',
  // Connecticut: 060-069
  '060': 'CT', '061': 'CT', '062': 'CT', '063': 'CT', '064': 'CT', '065': 'CT', '066': 'CT', '067': 'CT', '068': 'CT', '069': 'CT',
  // Delaware: 197-199
  '197': 'DE', '198': 'DE', '199': 'DE',
  // DC: 200-205
  '200': 'DC', '202': 'DC', '203': 'DC', '204': 'DC', '205': 'DC',
  // Florida: 320-349
  '320': 'FL', '321': 'FL', '322': 'FL', '323': 'FL', '324': 'FL', '325': 'FL',
  '326': 'FL', '327': 'FL', '328': 'FL', '329': 'FL', '330': 'FL', '331': 'FL',
  '332': 'FL', '333': 'FL', '334': 'FL', '335': 'FL', '336': 'FL', '337': 'FL',
  '338': 'FL', '339': 'FL', '340': 'FL', '341': 'FL', '342': 'FL', '344': 'FL',
  '346': 'FL', '347': 'FL', '349': 'FL',
  // Georgia: 300-319, 398-399
  '300': 'GA', '301': 'GA', '302': 'GA', '303': 'GA', '304': 'GA', '305': 'GA',
  '306': 'GA', '307': 'GA', '308': 'GA', '309': 'GA', '310': 'GA', '311': 'GA',
  '312': 'GA', '313': 'GA', '314': 'GA', '315': 'GA', '316': 'GA', '317': 'GA',
  '318': 'GA', '319': 'GA', '398': 'GA', '399': 'GA',
  // Hawaii: 967-968
  '967': 'HI', '968': 'HI',
  // Idaho: 832-838
  '832': 'ID', '833': 'ID', '834': 'ID', '835': 'ID', '836': 'ID', '837': 'ID', '838': 'ID',
  // Illinois: 600-629
  '600': 'IL', '601': 'IL', '602': 'IL', '603': 'IL', '604': 'IL', '605': 'IL',
  '606': 'IL', '607': 'IL', '608': 'IL', '609': 'IL', '610': 'IL', '611': 'IL',
  '612': 'IL', '613': 'IL', '614': 'IL', '615': 'IL', '616': 'IL', '617': 'IL',
  '618': 'IL', '619': 'IL', '620': 'IL', '622': 'IL', '623': 'IL', '624': 'IL',
  '625': 'IL', '626': 'IL', '627': 'IL', '628': 'IL', '629': 'IL',
  // Indiana: 460-479
  '460': 'IN', '461': 'IN', '462': 'IN', '463': 'IN', '464': 'IN', '465': 'IN',
  '466': 'IN', '467': 'IN', '468': 'IN', '469': 'IN', '470': 'IN', '471': 'IN',
  '472': 'IN', '473': 'IN', '474': 'IN', '475': 'IN', '476': 'IN', '477': 'IN',
  '478': 'IN', '479': 'IN',
  // Iowa: 500-528
  '500': 'IA', '501': 'IA', '502': 'IA', '503': 'IA', '504': 'IA', '505': 'IA',
  '506': 'IA', '507': 'IA', '508': 'IA', '509': 'IA', '510': 'IA', '511': 'IA',
  '512': 'IA', '513': 'IA', '514': 'IA', '515': 'IA', '516': 'IA', '520': 'IA',
  '521': 'IA', '522': 'IA', '523': 'IA', '524': 'IA', '525': 'IA', '526': 'IA',
  '527': 'IA', '528': 'IA',
  // Kansas: 660-679
  '660': 'KS', '661': 'KS', '662': 'KS', '664': 'KS', '665': 'KS', '666': 'KS',
  '667': 'KS', '668': 'KS', '669': 'KS', '670': 'KS', '671': 'KS', '672': 'KS',
  '673': 'KS', '674': 'KS', '675': 'KS', '676': 'KS', '677': 'KS', '678': 'KS', '679': 'KS',
  // Kentucky: 400-427
  '400': 'KY', '401': 'KY', '402': 'KY', '403': 'KY', '404': 'KY', '405': 'KY',
  '406': 'KY', '407': 'KY', '408': 'KY', '409': 'KY', '410': 'KY', '411': 'KY',
  '412': 'KY', '413': 'KY', '414': 'KY', '415': 'KY', '416': 'KY', '417': 'KY',
  '418': 'KY', '420': 'KY', '421': 'KY', '422': 'KY', '423': 'KY', '424': 'KY',
  '425': 'KY', '426': 'KY', '427': 'KY',
  // Louisiana: 700-714
  '700': 'LA', '701': 'LA', '703': 'LA', '704': 'LA', '705': 'LA', '706': 'LA',
  '707': 'LA', '708': 'LA', '710': 'LA', '711': 'LA', '712': 'LA', '713': 'LA', '714': 'LA',
  // Maine: 039-049
  '039': 'ME', '040': 'ME', '041': 'ME', '042': 'ME', '043': 'ME', '044': 'ME',
  '045': 'ME', '046': 'ME', '047': 'ME', '048': 'ME', '049': 'ME',
  // Maryland: 206-219
  '206': 'MD', '207': 'MD', '208': 'MD', '209': 'MD', '210': 'MD', '211': 'MD',
  '212': 'MD', '214': 'MD', '215': 'MD', '216': 'MD', '217': 'MD', '218': 'MD', '219': 'MD',
  // Massachusetts: 010-027
  '010': 'MA', '011': 'MA', '012': 'MA', '013': 'MA', '014': 'MA', '015': 'MA',
  '016': 'MA', '017': 'MA', '018': 'MA', '019': 'MA', '020': 'MA', '021': 'MA',
  '022': 'MA', '023': 'MA', '024': 'MA', '025': 'MA', '026': 'MA', '027': 'MA',
  // Michigan: 480-499
  '480': 'MI', '481': 'MI', '482': 'MI', '483': 'MI', '484': 'MI', '485': 'MI',
  '486': 'MI', '487': 'MI', '488': 'MI', '489': 'MI', '490': 'MI', '491': 'MI',
  '492': 'MI', '493': 'MI', '494': 'MI', '495': 'MI', '496': 'MI', '497': 'MI',
  '498': 'MI', '499': 'MI',
  // Minnesota: 550-567
  '550': 'MN', '551': 'MN', '553': 'MN', '554': 'MN', '555': 'MN', '556': 'MN',
  '557': 'MN', '558': 'MN', '559': 'MN', '560': 'MN', '561': 'MN', '562': 'MN',
  '563': 'MN', '564': 'MN', '565': 'MN', '566': 'MN', '567': 'MN',
  // Mississippi: 386-397
  '386': 'MS', '387': 'MS', '388': 'MS', '389': 'MS', '390': 'MS', '391': 'MS',
  '392': 'MS', '393': 'MS', '394': 'MS', '395': 'MS', '396': 'MS', '397': 'MS',
  // Missouri: 630-658
  '630': 'MO', '631': 'MO', '633': 'MO', '634': 'MO', '635': 'MO', '636': 'MO',
  '637': 'MO', '638': 'MO', '639': 'MO', '640': 'MO', '641': 'MO', '644': 'MO',
  '645': 'MO', '646': 'MO', '647': 'MO', '648': 'MO', '649': 'MO', '650': 'MO',
  '651': 'MO', '652': 'MO', '653': 'MO', '654': 'MO', '655': 'MO', '656': 'MO',
  '657': 'MO', '658': 'MO',
  // Montana: 590-599
  '590': 'MT', '591': 'MT', '592': 'MT', '593': 'MT', '594': 'MT', '595': 'MT',
  '596': 'MT', '597': 'MT', '598': 'MT', '599': 'MT',
  // Nebraska: 680-693
  '680': 'NE', '681': 'NE', '683': 'NE', '684': 'NE', '685': 'NE', '686': 'NE',
  '687': 'NE', '688': 'NE', '689': 'NE', '690': 'NE', '691': 'NE', '692': 'NE', '693': 'NE',
  // Nevada: 889-898
  '889': 'NV', '890': 'NV', '891': 'NV', '893': 'NV', '894': 'NV', '895': 'NV',
  '897': 'NV', '898': 'NV',
  // New Hampshire: 030-038
  '030': 'NH', '031': 'NH', '032': 'NH', '033': 'NH', '034': 'NH', '035': 'NH',
  '036': 'NH', '037': 'NH', '038': 'NH',
  // New Jersey: 070-089
  '070': 'NJ', '071': 'NJ', '072': 'NJ', '073': 'NJ', '074': 'NJ', '075': 'NJ',
  '076': 'NJ', '077': 'NJ', '078': 'NJ', '079': 'NJ', '080': 'NJ', '081': 'NJ',
  '082': 'NJ', '083': 'NJ', '084': 'NJ', '085': 'NJ', '086': 'NJ', '087': 'NJ',
  '088': 'NJ', '089': 'NJ',
  // New Mexico: 870-884
  '870': 'NM', '871': 'NM', '873': 'NM', '874': 'NM', '875': 'NM', '877': 'NM',
  '878': 'NM', '879': 'NM', '880': 'NM', '881': 'NM', '882': 'NM', '883': 'NM', '884': 'NM',
  // New York: 100-149
  '100': 'NY', '101': 'NY', '102': 'NY', '103': 'NY', '104': 'NY', '105': 'NY',
  '106': 'NY', '107': 'NY', '108': 'NY', '109': 'NY', '110': 'NY', '111': 'NY',
  '112': 'NY', '113': 'NY', '114': 'NY', '115': 'NY', '116': 'NY', '117': 'NY',
  '118': 'NY', '119': 'NY', '120': 'NY', '121': 'NY', '122': 'NY', '123': 'NY',
  '124': 'NY', '125': 'NY', '126': 'NY', '127': 'NY', '128': 'NY', '129': 'NY',
  '130': 'NY', '131': 'NY', '132': 'NY', '133': 'NY', '134': 'NY', '135': 'NY',
  '136': 'NY', '137': 'NY', '138': 'NY', '139': 'NY', '140': 'NY', '141': 'NY',
  '142': 'NY', '143': 'NY', '144': 'NY', '145': 'NY', '146': 'NY', '147': 'NY',
  '148': 'NY', '149': 'NY',
  // North Carolina: 270-289
  '270': 'NC', '271': 'NC', '272': 'NC', '273': 'NC', '274': 'NC', '275': 'NC',
  '276': 'NC', '277': 'NC', '278': 'NC', '279': 'NC', '280': 'NC', '281': 'NC',
  '282': 'NC', '283': 'NC', '284': 'NC', '285': 'NC', '286': 'NC', '287': 'NC',
  '288': 'NC', '289': 'NC',
  // North Dakota: 580-588
  '580': 'ND', '581': 'ND', '582': 'ND', '583': 'ND', '584': 'ND', '585': 'ND',
  '586': 'ND', '587': 'ND', '588': 'ND',
  // Ohio: 430-459
  '430': 'OH', '431': 'OH', '432': 'OH', '433': 'OH', '434': 'OH', '435': 'OH',
  '436': 'OH', '437': 'OH', '438': 'OH', '439': 'OH', '440': 'OH', '441': 'OH',
  '442': 'OH', '443': 'OH', '444': 'OH', '445': 'OH', '446': 'OH', '447': 'OH',
  '448': 'OH', '449': 'OH', '450': 'OH', '451': 'OH', '452': 'OH', '453': 'OH',
  '454': 'OH', '455': 'OH', '456': 'OH', '457': 'OH', '458': 'OH', '459': 'OH',
  // Oklahoma: 730-749
  '730': 'OK', '731': 'OK', '734': 'OK', '735': 'OK', '736': 'OK', '737': 'OK',
  '738': 'OK', '739': 'OK', '740': 'OK', '741': 'OK', '743': 'OK', '744': 'OK',
  '745': 'OK', '746': 'OK', '747': 'OK', '748': 'OK', '749': 'OK',
  // Oregon: 970-979
  '970': 'OR', '971': 'OR', '972': 'OR', '973': 'OR', '974': 'OR', '975': 'OR',
  '976': 'OR', '977': 'OR', '978': 'OR', '979': 'OR',
  // Pennsylvania: 150-196
  '150': 'PA', '151': 'PA', '152': 'PA', '153': 'PA', '154': 'PA', '155': 'PA',
  '156': 'PA', '157': 'PA', '158': 'PA', '159': 'PA', '160': 'PA', '161': 'PA',
  '162': 'PA', '163': 'PA', '164': 'PA', '165': 'PA', '166': 'PA', '167': 'PA',
  '168': 'PA', '169': 'PA', '170': 'PA', '171': 'PA', '172': 'PA', '173': 'PA',
  '174': 'PA', '175': 'PA', '176': 'PA', '177': 'PA', '178': 'PA', '179': 'PA',
  '180': 'PA', '181': 'PA', '182': 'PA', '183': 'PA', '184': 'PA', '185': 'PA',
  '186': 'PA', '187': 'PA', '188': 'PA', '189': 'PA', '190': 'PA', '191': 'PA',
  '192': 'PA', '193': 'PA', '194': 'PA', '195': 'PA', '196': 'PA',
  // Puerto Rico: 006-009
  '006': 'PR', '007': 'PR', '008': 'PR', '009': 'PR',
  // Rhode Island: 028-029
  '028': 'RI', '029': 'RI',
  // South Carolina: 290-299
  '290': 'SC', '291': 'SC', '292': 'SC', '293': 'SC', '294': 'SC', '295': 'SC',
  '296': 'SC', '297': 'SC', '298': 'SC', '299': 'SC',
  // South Dakota: 570-577
  '570': 'SD', '571': 'SD', '572': 'SD', '573': 'SD', '574': 'SD', '575': 'SD',
  '576': 'SD', '577': 'SD',
  // Tennessee: 370-385
  '370': 'TN', '371': 'TN', '372': 'TN', '373': 'TN', '374': 'TN', '375': 'TN',
  '376': 'TN', '377': 'TN', '378': 'TN', '379': 'TN', '380': 'TN', '381': 'TN',
  '382': 'TN', '383': 'TN', '384': 'TN', '385': 'TN',
  // Texas: 750-799, 885
  '750': 'TX', '751': 'TX', '752': 'TX', '753': 'TX', '754': 'TX', '755': 'TX',
  '756': 'TX', '757': 'TX', '758': 'TX', '759': 'TX', '760': 'TX', '761': 'TX',
  '762': 'TX', '763': 'TX', '764': 'TX', '765': 'TX', '766': 'TX', '767': 'TX',
  '768': 'TX', '769': 'TX', '770': 'TX', '772': 'TX', '773': 'TX', '774': 'TX',
  '775': 'TX', '776': 'TX', '777': 'TX', '778': 'TX', '779': 'TX', '780': 'TX',
  '781': 'TX', '782': 'TX', '783': 'TX', '784': 'TX', '785': 'TX', '786': 'TX',
  '787': 'TX', '788': 'TX', '789': 'TX', '790': 'TX', '791': 'TX', '792': 'TX',
  '793': 'TX', '794': 'TX', '795': 'TX', '796': 'TX', '797': 'TX', '798': 'TX',
  '799': 'TX', '885': 'TX',
  // Utah: 840-847
  '840': 'UT', '841': 'UT', '842': 'UT', '843': 'UT', '844': 'UT', '845': 'UT',
  '846': 'UT', '847': 'UT',
  // Vermont: 050-059
  '050': 'VT', '051': 'VT', '052': 'VT', '053': 'VT', '054': 'VT', '056': 'VT',
  '057': 'VT', '058': 'VT', '059': 'VT',
  // Virginia: 220-246
  '220': 'VA', '221': 'VA', '222': 'VA', '223': 'VA', '224': 'VA', '225': 'VA',
  '226': 'VA', '227': 'VA', '228': 'VA', '229': 'VA', '230': 'VA', '231': 'VA',
  '232': 'VA', '233': 'VA', '234': 'VA', '235': 'VA', '236': 'VA', '237': 'VA',
  '238': 'VA', '239': 'VA', '240': 'VA', '241': 'VA', '242': 'VA', '243': 'VA',
  '244': 'VA', '245': 'VA', '246': 'VA',
  // Washington: 980-994
  '980': 'WA', '981': 'WA', '982': 'WA', '983': 'WA', '984': 'WA', '985': 'WA',
  '986': 'WA', '988': 'WA', '989': 'WA', '990': 'WA', '991': 'WA', '992': 'WA',
  '993': 'WA', '994': 'WA',
  // West Virginia: 247-268
  '247': 'WV', '248': 'WV', '249': 'WV', '250': 'WV', '251': 'WV', '252': 'WV',
  '253': 'WV', '254': 'WV', '255': 'WV', '256': 'WV', '257': 'WV', '258': 'WV',
  '259': 'WV', '260': 'WV', '261': 'WV', '262': 'WV', '263': 'WV', '264': 'WV',
  '265': 'WV', '266': 'WV', '267': 'WV', '268': 'WV',
  // Wisconsin: 530-549
  '530': 'WI', '531': 'WI', '532': 'WI', '534': 'WI', '535': 'WI', '537': 'WI',
  '538': 'WI', '539': 'WI', '540': 'WI', '541': 'WI', '542': 'WI', '543': 'WI',
  '544': 'WI', '545': 'WI', '546': 'WI', '547': 'WI', '548': 'WI', '549': 'WI',
  // Wyoming: 820-831
  '820': 'WY', '821': 'WY', '822': 'WY', '823': 'WY', '824': 'WY', '825': 'WY',
  '826': 'WY', '827': 'WY', '828': 'WY', '829': 'WY', '830': 'WY', '831': 'WY',
};

// Validate and correct state code based on ZIP code
function validateStateFromZip(providedState: string, address: string): string {
  if (!address) return providedState;
  
  // Extract ZIP code from address - look for pattern after state abbreviation or at end of address
  // Pattern: comma/space, then 2-letter state, then space, then 5-digit ZIP (optionally with -4 extension)
  // Examples: ", TX 75220" or "TX, 75220" or just "75220" at end
  let zipMatch = address.match(/,?\s*[A-Z]{2}[,\s]+(\d{5})(?:-\d{4})?(?:\s*$|[,\s])/i);
  
  // Fallback: look for ZIP at the very end of the address string
  if (!zipMatch) {
    zipMatch = address.match(/(\d{5})(?:-\d{4})?\s*$/);
  }
  
  if (!zipMatch) return providedState;
  
  const zipCode = zipMatch[1];
  const zipPrefix = zipCode.substring(0, 3);
  const correctState = zipPrefixToState[zipPrefix];
  
  if (correctState && correctState !== providedState) {
    console.log(`[ZIP Validation] Corrected state from ${providedState} to ${correctState} based on ZIP ${zipCode} in address: ${address.substring(0, 50)}...`);
    return correctState;
  }
  
  return providedState;
}

// Valid US state abbreviations for validation
const VALID_US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY'
]);

// Helper to validate if a string is a valid US state abbreviation
function isValidStateAbbreviation(state: string | null | undefined): boolean {
  if (!state || typeof state !== 'string') return false;
  const normalized = state.trim().toUpperCase();
  return normalized.length === 2 && VALID_US_STATES.has(normalized);
}

async function refreshTechnicianCache(): Promise<void> {
  try {
    console.log("[TechCache] Refreshing technician data cache from Snowflake...");
    const techSql = `
      SELECT TRUCK_LU, FULL_NAME, TECH_NO, MOBILEPHONENUMBER, MANAGER_NAME, MANAGER_ENT_ID, ENTERPRISE_ID,
             PRIMARYADDR1, PRIMARYADDR2, PRIMARYCITY, PRIMARYSTATE, PRIMARYZIP
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
    `;
    const techData = await executeQuery<{
      TRUCK_LU: string;
      FULL_NAME: string;
      TECH_NO: string | number | null;
      MOBILEPHONENUMBER: number | string | null;
      MANAGER_NAME: string | null;
      MANAGER_ENT_ID: string | number | null;
      ENTERPRISE_ID: string | number | null;
      PRIMARYADDR1: string | null;
      PRIMARYADDR2: string | null;
      PRIMARYCITY: string | null;
      PRIMARYSTATE: string | null;
      PRIMARYZIP: string | null;
    }>(techSql);
    
    // First pass: Build lookup of ENTERPRISE_ID -> phone number for manager phone lookup
    const enterpriseIdToPhone = new Map<string, string>();
    for (const tech of techData) {
      if (tech.ENTERPRISE_ID && tech.MOBILEPHONENUMBER) {
        const entId = String(tech.ENTERPRISE_ID).trim();
        enterpriseIdToPhone.set(entId, String(tech.MOBILEPHONENUMBER));
      }
    }
    
    // Second pass: Build main cache with manager info
    const newCache = new Map<string, { fullName: string; techNo: string; mobilePhone: string; managerName: string; managerPhone: string; enterpriseId: string }>();
    for (const tech of techData) {
      if (tech.TRUCK_LU) {
        const vehicleNum = normalizeFleetIdForCache(tech.TRUCK_LU);
        
        let managerPhone = '';
        if (tech.MANAGER_ENT_ID) {
          const managerEntId = String(tech.MANAGER_ENT_ID).trim();
          managerPhone = enterpriseIdToPhone.get(managerEntId) || '';
        }
        
        const addressParts = [
          tech.PRIMARYADDR1?.trim(),
          tech.PRIMARYADDR2?.trim(),
          tech.PRIMARYCITY?.trim(),
          tech.PRIMARYSTATE?.trim(),
          tech.PRIMARYZIP?.trim(),
        ].filter(Boolean);
        const fullAddress = addressParts.join(', ');

        newCache.set(vehicleNum, {
          fullName: tech.FULL_NAME || '',
          techNo: tech.TECH_NO ? String(tech.TECH_NO) : '',
          mobilePhone: tech.MOBILEPHONENUMBER ? String(tech.MOBILEPHONENUMBER) : '',
          managerName: tech.MANAGER_NAME || '',
          managerPhone,
          enterpriseId: tech.ENTERPRISE_ID ? String(tech.ENTERPRISE_ID).trim() : '',
          fullAddress,
        });
      }
    }
    
    technicianDataCache = newCache;
    technicianCacheLastUpdated = new Date();
    console.log(`[TechCache] Cached ${technicianDataCache.size} technician records at ${technicianCacheLastUpdated.toISOString()}`);
  } catch (error: any) {
    console.error("[TechCache] Error refreshing technician cache:", error.message);
  }
}

// Helper to get ISO week number
function getWeekNumber(date: Date): { weekNumber: number; weekYear: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { weekNumber, weekYear: d.getUTCFullYear() };
}

// Automatic BYOV weekly snapshot capture
async function autoCaptureByovSnapshot(): Promise<void> {
  try {
    const { weekNumber, weekYear } = getWeekNumber(new Date());
    
    // Check if snapshot already exists for this week
    const existingSnapshots = await fleetScopeStorage.getByovWeeklySnapshots(1);
    if (existingSnapshots.length > 0 && 
        existingSnapshots[0].weekNumber === weekNumber && 
        existingSnapshots[0].weekYear === weekYear) {
      return; // Already captured this week
    }
    
    // Fetch current BYOV data from external API
    const response = await fetch("https://byovdashboard.replit.app/api/external/technicians", {
      headers: { "Accept": "application/json" }
    });
    
    if (!response.ok) {
      console.error(`Auto BYOV capture failed: API returned ${response.status}`);
      return;
    }
    
    const data = await response.json();
    // Filter for only "Enrolled" status technicians
    const enrolledTechs = (data.technicians || []).filter(
      (t: any) => t.enrollmentStatus === "Enrolled"
    );
    const totalEnrolled = enrolledTechs.length;
    const byovTruckIds = enrolledTechs.map((t: any) => t.truckId?.toString().trim() || '').filter(Boolean);
    
    await fleetScopeStorage.createByovWeeklySnapshot({
      totalEnrolled,
      assignedInFleet: 0,
      notInFleet: totalEnrolled,
      capturedBy: "Auto",
      technicianIds: byovTruckIds,
    });
    
    console.log(`Auto-captured BYOV snapshot: Week ${weekNumber}, ${weekYear} - ${totalEnrolled} enrolled`);
  } catch (error: any) {
    console.error("Error in auto BYOV capture:", error.message);
  }
}

// Automatic Fleet weekly snapshot capture (from Snowflake REPLIT_ALL_VEHICLES)
async function autoCaptureFleetSnapshot(): Promise<void> {
  try {
    const { weekNumber, weekYear } = getWeekNumber(new Date());
    
    const existingSnapshots = await fleetScopeStorage.getFleetWeeklySnapshots(1);
    if (existingSnapshots.length > 0 && 
        existingSnapshots[0].weekNumber === weekNumber && 
        existingSnapshots[0].weekYear === weekYear) {
      return; // Already captured this week
    }
    
    // Query Snowflake for fleet counts
    const sql = `
      SELECT TRUCK_STATUS, COUNT(*) as cnt 
      FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES 
      GROUP BY TRUCK_STATUS
    `;
    const results = await executeQuery<{ TRUCK_STATUS: string; CNT: number }>(sql);
    
    let assignedCount = 0;
    let unassignedCount = 0;
    let totalFleet = 0;
    
    for (const row of results) {
      const status = (row.TRUCK_STATUS || '').toLowerCase();
      const count = Number(row.CNT) || 0;
      totalFleet += count;
      // "Assigned to Tech" and "In Use" are considered assigned
      if (status.includes('assigned') || status === 'in use') {
        assignedCount += count;
      } else {
        // Everything else (Spare, Reserved For New Hire, Tech On LOA, In Repair, Unknown) is unassigned
        unassignedCount += count;
      }
    }
    
    // Get PMF count from local database
    const pmfDataset = await fleetScopeStorage.getPmfDataset();
    const pmfCount = pmfDataset.rows?.length || 0;
    
    await fleetScopeStorage.createFleetWeeklySnapshot({
      totalFleet,
      assignedCount,
      unassignedCount,
      pmfCount,
      capturedBy: "Auto",
    });
    
    console.log(`Auto-captured Fleet snapshot: Week ${weekNumber}, ${weekYear} - ${totalFleet} total, ${assignedCount} assigned`);
  } catch (error: any) {
    console.error("Error in auto Fleet capture:", error.message);
  }
}

// Automatic PMF Status weekly snapshot capture
async function autoCapturePmfStatusSnapshot(): Promise<void> {
  try {
    const { weekNumber, weekYear } = getWeekNumber(new Date());
    
    const existingSnapshots = await fleetScopeStorage.getPmfStatusWeeklySnapshots(1);
    if (existingSnapshots.length > 0 && 
        existingSnapshots[0].weekNumber === weekNumber && 
        existingSnapshots[0].weekYear === weekYear) {
      return; // Already captured this week
    }
    
    // Get PMF data from local database
    const pmfDataset = await fleetScopeStorage.getPmfDataset();
    const rows = pmfDataset.rows || [];
    
    let pendingArrival = 0;
    let lockedDownLocal = 0;
    let available = 0;
    let pendingPickup = 0;
    let checkedOut = 0;
    let otherStatus = 0;
    
    for (const row of rows) {
      const status = (row.status || '').toLowerCase().replace(/[–—-]/g, '').replace(/\s+/g, ' ').trim();
      if (status.includes('pending arrival')) {
        pendingArrival++;
      } else if (status.includes('locked down') || status.includes('lockeddown')) {
        lockedDownLocal++;
      } else if (status === 'available') {
        available++;
      } else if (status.includes('pending pickup')) {
        pendingPickup++;
      } else if (status.includes('checked out') || status.includes('check out')) {
        checkedOut++;
      } else {
        otherStatus++;
      }
    }
    
    await fleetScopeStorage.createPmfStatusWeeklySnapshot({
      totalPmf: rows.length,
      pendingArrival,
      lockedDownLocal,
      available,
      pendingPickup,
      checkedOut,
      otherStatus,
      capturedBy: "Auto",
    });
    
    console.log(`Auto-captured PMF Status snapshot: Week ${weekNumber}, ${weekYear} - ${rows.length} total`);
  } catch (error: any) {
    console.error("Error in auto PMF Status capture:", error.message);
  }
}

// Automatic Repair weekly snapshot capture
async function autoCaptureRepairSnapshot(): Promise<void> {
  try {
    const { weekNumber, weekYear } = getWeekNumber(new Date());
    
    const existingSnapshots = await fleetScopeStorage.getRepairWeeklySnapshots(1);
    if (existingSnapshots.length > 0 && 
        existingSnapshots[0].weekNumber === weekNumber && 
        existingSnapshots[0].weekYear === weekYear) {
      return; // Already captured this week
    }
    
    // Get trucks from local database
    const trucks = await fleetScopeStorage.getAllTrucks();
    const totalInRepair = trucks.length;
    
    // Active repairs = not picked up yet (still in repair process)
    const activeRepairs = trucks.filter(t => !t.vanPickedUp).length;
    
    // Completed = vanPickedUp is true (repairs finished, vehicle returned)
    const completedThisWeek = trucks.filter(t => t.vanPickedUp).length;
    
    await fleetScopeStorage.createRepairWeeklySnapshot({
      totalInRepair,
      activeRepairs,
      completedThisWeek,
      capturedBy: "Auto",
    });
    
    console.log(`Auto-captured Repair snapshot: Week ${weekNumber}, ${weekYear} - ${totalInRepair} total, ${activeRepairs} active`);
  } catch (error: any) {
    console.error("Error in auto Repair capture:", error.message);
  }
}

// Automatic PMF data sync from PARQ API
async function autoSyncPmfFromParq(): Promise<void> {
  try {
    console.log(`[PMF Scheduler] Starting automatic PARQ API sync at ${new Date().toISOString()}`);
    
    // Fetch all data from PARQ API
    const data = await parqApi.fetchAllPmfData();
    
    // Transform vehicles into PMF row format
    // Include internal PARQ ID for activity log fetching
    const rows = data.vehicles.map(v => ({
      assetId: v.assetId,
      status: v.status,
      dateIn: v.dateIn,
      rawRow: {
        "id": v.id, // Internal PARQ vehicle ID for activity log API
        "Asset ID": v.assetId,
        "Status": v.status,
        "Status ID": String(v.statusId),
        "VIN/Descriptor": v.descriptor,
        "Year": v.year,
        "Make": v.make,
        "Model": v.model,
        "Location": v.location || "",
        "Location Address": v.locationDetails 
          ? `${v.locationDetails.addressLine1}, ${v.locationDetails.city}, ${v.locationDetails.state} ${v.locationDetails.zipCode}`
          : "",
        "Date In": v.dateIn || "",
        "Date Out": v.dateOut || "",
        "Mileage": v.mileage ? String(v.mileage) : "",
        "Created Date": v.createdDate,
        "Modified Date": v.modifiedDate || "",
      },
    }));
    
    // Define headers for the PMF table display
    const headers = [
      "Asset ID",
      "Status", 
      "VIN/Descriptor",
      "Year",
      "Make",
      "Model",
      "Location",
      "Location Address",
      "Date In",
      "Date Out",
      "Mileage",
    ];
    
    // Replace PMF data in database
    await fleetScopeStorage.replacePmfData({
      filename: `Auto PARQ Sync - ${new Date().toISOString()}`,
      headers,
      activityHeaders: { action: "", activity: "", activityDate: "" },
      rows,
      importedBy: "Auto Scheduler",
    });
    
    console.log(`[PMF Scheduler] Auto-synced ${data.vehicles.length} vehicles from PARQ API`);
  } catch (error: any) {
    console.error("[PMF Scheduler] Error in auto PARQ sync:", error.message);
  }
}

// Auto-sync PMF activity logs from PARQ API every 6 hours
async function autoSyncActivityLogs(): Promise<void> {
  try {
    console.log("[Activity Scheduler] Starting automatic activity log sync...");
    
    // Get all PMF vehicles with their internal PARQ IDs
    const pmfData = await fleetScopeStorage.getPmfDataset();
    const vehicleMap: Array<{ parqId: number; assetId: string }> = [];
    
    for (const row of pmfData.rows) {
      if (row.assetId && row.rawRow) {
        try {
          const rawData = JSON.parse(row.rawRow);
          // Use internal PARQ ID if available (from PARQ API sync)
          if (rawData.id && typeof rawData.id === 'number') {
            vehicleMap.push({ parqId: rawData.id, assetId: row.assetId });
          }
        } catch (e) {
          // Skip rows with invalid JSON
        }
      }
    }
    
    if (vehicleMap.length === 0) {
      console.log("[Activity Scheduler] No PMF vehicles with PARQ IDs found to sync");
      return;
    }
    
    console.log(`[Activity Scheduler] Found ${vehicleMap.length} vehicles with PARQ IDs to sync...`);
    
    // Clear existing logs and fetch fresh data
    await fleetScopeStorage.clearPmfActivityLogs();
    
    // Fetch using internal PARQ IDs
    const activityLogMap = await parqApi.fetchActivityLogsForVehicles(
      vehicleMap.map(v => v.parqId)
    );
    
    // Convert and insert logs
    let totalLogsFetched = 0;
    const allLogs: Array<{
      vehicleId: number;
      assetId: string;
      activityDate: Date;
      action: string;
      activityType: number;
      typeDescription: string;
      workOrderId: number | null;
    }> = [];
    
    for (const { parqId, assetId } of vehicleMap) {
      const logs = activityLogMap.get(parqId) || [];
      for (const log of logs) {
        allLogs.push({
          vehicleId: parqId,
          assetId,
          activityDate: new Date(log.date),
          action: log.action,
          activityType: log.type,
          typeDescription: log.typeDescription,
          workOrderId: log.workOrderId,
        });
      }
      totalLogsFetched += logs.length;
    }
    
    await fleetScopeStorage.upsertPmfActivityLogs(allLogs);
    await fleetScopeStorage.updatePmfActivitySyncMeta(vehicleMap.length, totalLogsFetched, 'success');
    
    console.log(`[Activity Scheduler] Auto-synced ${totalLogsFetched} logs for ${vehicleMap.length} vehicles`);
  } catch (error: any) {
    console.error("[Activity Scheduler] Error in auto activity sync:", error.message);
    await fleetScopeStorage.updatePmfActivitySyncMeta(0, 0, 'failed', error.message);
  }
}

// Run all auto-captures (and PMF sync)
async function runAllAutoCaptures(): Promise<void> {
  // First sync PMF data from PARQ API before capturing snapshots
  await autoSyncPmfFromParq();
  
  // Sync activity logs after PMF data is updated
  await autoSyncActivityLogs();
  
  await autoCaptureByovSnapshot();
  await autoCaptureFleetSnapshot();
  await autoCapturePmfStatusSnapshot();
  await autoCaptureRepairSnapshot();
}

// Start auto-capture scheduler (checks every 6 hours)
setInterval(runAllAutoCaptures, 6 * 60 * 60 * 1000);
// Also run once on startup after a short delay
setTimeout(runAllAutoCaptures, 10000);

// Pre-warm Fleet Finder cache on startup (with automatic retries if API is down)
setTimeout(() => {
  prewarmFleetFinderCache();
}, 5000);

// Email notification for pending PO approvals
async function sendPendingApprovalsEmail(pendingCount: number): Promise<void> {
  if (!process.env.FS_SENDGRID_API_KEY) {
    console.log("SendGrid API key not configured, skipping email notification");
    return;
  }

  const recipients = [
    "Samantha.Walsh@transformco.com",
    "Andrei.Daniliuc@transformco.com",
    "Howard.Anderson@transformco.com"
  ];

  const appUrl = "https://fleet-scope.replit.app";
  
  const msg = {
    to: recipients,
    from: "notifications@shs.com",
    subject: "PLEASE REVIEW POs = REDUCE RENTALS",
    text: `A new PO import has been completed.\n\nYou have ${pendingCount} purchase order(s) pending Final Approval.\n\nPlease review and approve them at your earliest convenience.\n\nHow to Access:\n1. Go to ${appUrl}\n2. Select your name from the profile dropdown\n3. Click the "POs" button in the dashboard header\n4. Find records with blank Final Approval (highlighted in yellow)\n5. Click on any Final Approval cell to select a value from the dropdown`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">PO Import Complete</h2>
        <p>A new purchase order import has been completed.</p>
        <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #856404;">Pending Final Approvals</p>
          <p style="margin: 10px 0 0 0; font-size: 36px; font-weight: bold; color: #856404;">${pendingCount}</p>
        </div>
        <p>Please review and approve them at your earliest convenience.</p>
        
        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">How to Access the PO Tab:</h3>
          <ol style="color: #555; line-height: 1.8;">
            <li>Click the button below to open Fleet Scope</li>
            <li>Select your name from the profile dropdown</li>
            <li>Click the <strong>"POs"</strong> button in the dashboard header</li>
            <li>Find records with blank Final Approval (highlighted in yellow)</li>
            <li>Click on any Final Approval cell to select a value from the dropdown</li>
          </ol>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}/pos" style="display: inline-block; background-color: #0066cc; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">Open PO Approvals</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">This is an automated notification from Fleet Scope.</p>
        <p style="color: #999; font-size: 11px;">App URL: <a href="${appUrl}" style="color: #0066cc;">${appUrl}</a></p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Pending approvals email sent to ${recipients.join(", ")}: ${pendingCount} pending`);
  } catch (error: any) {
    console.error("Failed to send email notification:", error.message);
    if (error.response) {
      console.error("SendGrid error details:", error.response.body);
    }
  }
}

async function sendTruckSwapEmail(truck: any): Promise<void> {
  if (!process.env.FS_SENDGRID_API_KEY) {
    console.log("SendGrid API key not configured, skipping Truck Swap email");
    return;
  }

  const recipients = [
    "jennifer.dyer@transformco.com",
    "tmotard@transformco.com"
  ];

  const appUrl = "https://fleet-scope.replit.app";
  const truckNumber = truck.truckNumber || truck.id;
  const truckDetailUrl = `${appUrl}/trucks/${encodeURIComponent(truckNumber)}`;

  const msg = {
    to: recipients,
    from: "notifications@shs.com",
    subject: `Declined Repair Truck Swap: Parts Swap and Decommissioning – Truck #${truckNumber}`,
    text: `Declined Repair Truck Swap: Parts Swap and Decommissioning\n\nThe following trucks, From Truck - To Truck, need to have the parts swapped (Tim Motard) and Jennifer can you help the technician decommission the truck including tools, Ref Tanks and Samsara Gateway and Camera.\n\nDetails:\n- Truck Number: ${truckNumber}\n- Repair Shop Location: ${truck.repairAddress || 'N/A'}\n- Tech Name: ${truck.techName || 'N/A'}\n- Tech Phone: ${truck.techPhone || 'N/A'}\n- Tech Lead Name: ${truck.techLeadName || 'N/A'}\n- Tech Lead Phone: ${truck.techLeadPhone || 'N/A'}\n- Pick Up Slot Booked: ${truck.pickUpSlotBooked ? 'Yes' : 'No'}\n- Scheduled Pick Up Time: ${truck.timeBlockedToPickUpVan || 'N/A'}\n\nView details: ${truckDetailUrl}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0891b2;">Declined Repair Truck Swap: Parts Swap and Decommissioning</h2>
        <p style="margin: 16px 0; line-height: 1.6;">The following trucks, From Truck - To Truck, need to have the parts swapped (Tim Motard) and Jennifer can you help the technician decommission the truck including tools, Ref Tanks and Samsara Gateway and Camera.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px;">
          <tr style="background-color: #f0fdfa;">
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb; width: 40%;">Truck Number</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truckNumber}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Repair Shop Location</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.repairAddress || 'N/A'}</td>
          </tr>
          <tr style="background-color: #f0fdfa;">
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Tech Name</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.techName || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Tech Phone</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.techPhone || 'N/A'}</td>
          </tr>
          <tr style="background-color: #f0fdfa;">
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Tech Lead Name</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.techLeadName || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Tech Lead Phone</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.techLeadPhone || 'N/A'}</td>
          </tr>
          <tr style="background-color: #f0fdfa;">
            <td style="padding: 12px 16px; font-weight: bold; color: #555; border-bottom: 1px solid #e5e7eb;">Pick Up Slot Booked</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">${truck.pickUpSlotBooked ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: bold; color: #555;">Scheduled Pick Up Time</td>
            <td style="padding: 12px 16px;">${truck.timeBlockedToPickUpVan || 'N/A'}</td>
          </tr>
        </table>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${truckDetailUrl}" style="display: inline-block; background-color: #0891b2; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Truck Details</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">This is an automated notification from Fleet Scope.</p>
        <p style="color: #999; font-size: 11px;">App URL: <a href="${appUrl}" style="color: #0891b2;">${appUrl}</a></p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Truck Swap email sent to ${recipients.join(", ")} for truck #${truckNumber}`);
  } catch (error: any) {
    console.error("Failed to send Truck Swap email:", error.message);
    if (error.response) {
      console.error("SendGrid error details:", error.response.body);
    }
  }
}

// Helper to track field changes with detailed old/new values
function trackChanges(existing: any, updates: any): string[] {
  const changes: string[] = [];
  
  const fieldLabels: Record<string, string> = {
    truckNumber: "Truck Number",
    mainStatus: "Main Status",
    subStatus: "Sub-Status",
    shsOwner: "SHS Owner",
    dateLastMarkedAsOwned: "Date Last Marked as Owned",
    registrationStickerValid: "Registration Sticker Valid",
    registrationExpiryDate: "Have Tags",
    holmanRegExpiry: "Reg. Expiry",
    registrationLastUpdate: "Registration Last Update",
    datePutInRepair: "Date Put in Repair",
    repairAddress: "Repair Address",
    repairPhone: "Repair Phone",
    contactName: "Local Repair Contact Name",
    confirmedSetOfExpiredTags: "Confirmed Set of Expired Tags",
    repairCompleted: "Repair Completed",
    inAms: "AMS Documented",
    vanPickedUp: "Van Picked Up",
    virtualComments: "Virtual Comments",
    comments: "Comments",
    techPhone: "Tech Phone",
    techName: "Tech Name",
    pickUpSlotBooked: "Pick Up Slot Booked",
    timeBlockedToPickUpVan: "Time Blocked To Pick Up Van",
    regTestSlotBooked: "Reg. Test Slot Booked",
    regTestSlotDetails: "Reg. Test Slot Details",
    rentalReturned: "Rental Returned",
    newTruckAssigned: "New Truck Assigned",
    confirmedDeclinedRepair: "Confirmed Declined Repair",
    registrationRenewalInProcess: "Registration Renewal In Process",
    spareVanAssignmentInProcess: "Spare Van Assignment In Process",
    spareVanInProcessToShip: "Spare Van In Process to Ship",
    notes: "Notes",
    gaveHolman: "Gave Holman",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    if (updates[key] !== undefined) {
      const oldVal = existing[key];
      const newVal = updates[key];
      
      // Normalize empty values: treat null, undefined, and "" as equivalent
      const normalizeEmpty = (val: any) => {
        if (val === null || val === undefined || val === "") return null;
        return val;
      };
      
      const normalizedOld = normalizeEmpty(oldVal);
      const normalizedNew = normalizeEmpty(newVal);
      
      // Only track if values actually differ after normalization
      if (normalizedOld !== normalizedNew) {
        if (typeof oldVal === "boolean" || typeof newVal === "boolean") {
          const oldDisplay = oldVal ? "Yes" : "No";
          const newDisplay = newVal ? "Yes" : "No";
          changes.push(`${label} changed from ${oldDisplay} to ${newDisplay}`);
        } else {
          const oldDisplay = normalizedOld || "(empty)";
          const newDisplay = normalizedNew || "(empty)";
          
          // For long fields, truncate display
          const maxLen = 50;
          const oldTrunc = oldDisplay.length > maxLen 
            ? oldDisplay.substring(0, maxLen) + "..." 
            : oldDisplay;
          const newTrunc = newDisplay.length > maxLen 
            ? newDisplay.substring(0, maxLen) + "..." 
            : newDisplay;
          
          changes.push(`${label} changed from "${oldTrunc}" to "${newTrunc}"`);
        }
      }
    }
  }

  return changes;
}

// Auth middleware for fleet-scope routes — validates session cookie using main storage
async function requireFsAuth(req: any, res: any, next: any): Promise<any> {
  const cookieHeader = req.headers.cookie;
  const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
  if (!sessionId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  try {
    const session = await storage.getSession(sessionId);
    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await storage.deleteSession(sessionId);
      }
      return res.status(401).json({ message: "Session expired" });
    }
    const user = await storage.getUser(session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    req.user = { id: user.id, username: user.username, role: user.role };
    return next();
  } catch (err: any) {
    console.error("[FS Auth] Auth error:", err.message);
    return res.status(401).json({ message: "Authentication failed" });
  }
}

export function registerFleetScopeRoutes(): Router {
  const app = Router();

  // Ensure MANUAL_EDIT_TIMESTAMP column exists in Snowflake SPARE_VEHICLE_ASSIGNMENT_STATUS
  (async () => {
    try {
      await executeQuery(`
        ALTER TABLE PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS 
        ADD COLUMN IF NOT EXISTS MANUAL_EDIT_TIMESTAMP TIMESTAMP_NTZ
      `);
      console.log("[Snowflake] MANUAL_EDIT_TIMESTAMP column ensured on SPARE_VEHICLE_ASSIGNMENT_STATUS");
    } catch (err: any) {
      console.log(`[Snowflake] Could not add MANUAL_EDIT_TIMESTAMP column (may already exist): ${err.message}`);
    }
  })();

  // GET all trucks (with UPS tracking status)
  app.get("/trucks", async (req, res) => {
    try {
      const trucks = await fleetScopeStorage.getAllTrucks();
      
      // Fetch all tracking records to augment trucks with UPS status
      const allTrackingRecords = await fleetScopeStorage.getTrackingRecords();
      
      // Create a map of truckId -> latest tracking record
      const trackingByTruck = new Map<string, { upsStatus: string | null; upsStatusDescription: string | null; upsLastCheckedAt: Date | null }>();
      
      for (const record of allTrackingRecords) {
        if (record.truckId) {
          const existing = trackingByTruck.get(record.truckId);
          // Use the first (most recent) record for each truck, or one with status if current doesn't have one
          if (!existing || (!existing.upsStatus && record.lastStatus)) {
            trackingByTruck.set(record.truckId, {
              upsStatus: record.lastStatus,
              upsStatusDescription: record.lastStatusDescription,
              upsLastCheckedAt: record.lastCheckedAt,
            });
          }
        }
      }
      
      // Augment trucks with UPS status
      const trucksWithUps = trucks.map(truck => ({
        ...truck,
        upsStatus: trackingByTruck.get(truck.id)?.upsStatus || null,
        upsStatusDescription: trackingByTruck.get(truck.id)?.upsStatusDescription || null,
        upsLastCheckedAt: trackingByTruck.get(truck.id)?.upsLastCheckedAt || null,
      }));
      
      res.json(trucksWithUps);
    } catch (error: any) {
      console.error("Error fetching trucks:", error);
      res.status(500).json({ message: "Failed to fetch trucks" });
    }
  });

  // GET pickups scheduled this week (Saturday to Friday)
  // Counts unique vehicles where Pick Up Slot Booked changed to Yes within the Sat-Fri window
  app.get("/pickups-scheduled-this-week", async (req, res) => {
    try {
      const now = new Date();
      const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      
      // Calculate the most recent Saturday (start of the Sat-Fri week)
      // If today is Saturday (6), start is today. Otherwise go back to last Saturday.
      const daysSinceSaturday = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
      const saturday = new Date(now);
      saturday.setUTCDate(now.getUTCDate() - daysSinceSaturday);
      saturday.setUTCHours(0, 0, 0, 0);
      
      // Friday end = Saturday + 7 days (exclusive)
      const fridayEnd = new Date(saturday);
      fridayEnd.setUTCDate(saturday.getUTCDate() + 7);
      
      const satStr = saturday.toISOString();
      const friStr = fridayEnd.toISOString();
      
      // Query action logs for "Pick Up Slot Booked changed from No to Yes" within this window
      // Fetch distinct truck numbers (not just count) so we can preserve them historically even if trucks are later removed
      const result = await getDb().execute(sql`
        SELECT DISTINCT t.truck_number
        FROM actions a
        JOIN trucks t ON a.truck_id = t.id
        WHERE a.action_time >= ${satStr}::timestamp
          AND a.action_time < ${friStr}::timestamp
          AND a.action_note ILIKE '%Pick Up Slot Booked changed from No to Yes%'
      `);
      
      const liveTruckNumbers: string[] = (result.rows || []).map((r: any) => r.truck_number).filter(Boolean);
      
      // Format dates for display (M/D)
      const formatShort = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      const fridayDisplay = new Date(fridayEnd);
      fridayDisplay.setUTCDate(fridayDisplay.getUTCDate() - 1);
      
      const { getISOWeek, getISOWeekYear } = await import("date-fns");
      const weekNumber = getISOWeek(fridayDisplay);
      const weekYear = getISOWeekYear(fridayDisplay);
      const weekLabel = `${formatShort(saturday)} - ${formatShort(fridayDisplay)}`;
      
      const existing = await getDb().execute(sql`
        SELECT id, pickups_scheduled, truck_numbers FROM pickup_weekly_snapshots
        WHERE week_number = ${weekNumber} AND week_year = ${weekYear}
        LIMIT 1
      `);
      
      let finalCount: number;
      let finalTruckNumbers: string[];
      
      if (existing.rows && existing.rows.length > 0) {
        const savedTruckNumbers: string[] = ((existing.rows[0] as Record<string, unknown>)).truck_numbers || [];
        const savedCount: number = Number(((existing.rows[0] as Record<string, unknown>)).pickups_scheduled) || 0;
        const mergedSet = new Set([...savedTruckNumbers, ...liveTruckNumbers]);
        finalTruckNumbers = Array.from(mergedSet);
        finalCount = Math.max(savedCount, finalTruckNumbers.length);
        
        const truckNumsJson = JSON.stringify(finalTruckNumbers);
        await getDb().execute(sql`
          UPDATE pickup_weekly_snapshots
          SET pickups_scheduled = ${finalCount}, 
              captured_at = now(), 
              week_label = ${weekLabel},
              truck_numbers = (SELECT array_agg(value::text) FROM jsonb_array_elements_text(${truckNumsJson}::jsonb))
          WHERE week_number = ${weekNumber} AND week_year = ${weekYear}
        `);
      } else {
        finalTruckNumbers = liveTruckNumbers;
        finalCount = liveTruckNumbers.length;
        await getDb().insert(pickupWeeklySnapshots).values({
          weekNumber,
          weekYear,
          pickupsScheduled: finalCount,
          weekLabel,
          capturedBy: "System",
          truckNumbers: finalTruckNumbers,
        });
      }
      
      res.json({
        count: finalCount,
        weekStart: satStr,
        weekEnd: friStr,
        label: weekLabel,
      });
    } catch (error: any) {
      console.error("Error fetching pickups scheduled this week:", error);
      res.status(500).json({ message: "Failed to fetch pickup schedule count" });
    }
  });

  app.get("/pickup-weekly-snapshots", async (req, res) => {
    try {
      const snapshots = await getDb().execute(sql`
        SELECT * FROM pickup_weekly_snapshots
        ORDER BY week_year DESC, week_number DESC
        LIMIT 52
      `);
      res.json(snapshots.rows || []);
    } catch (error: any) {
      console.error("Error fetching pickup weekly snapshots:", error);
      res.status(500).json({ message: "Failed to fetch pickup weekly snapshots" });
    }
  });

  // PATCH pickup weekly snapshot - manually correct a count or add truck numbers
  app.patch("/pickup-weekly-snapshots/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { pickupsScheduled, truckNumbers } = req.body;
      
      const existing = await getDb().execute(sql`
        SELECT * FROM pickup_weekly_snapshots WHERE id = ${id} LIMIT 1
      `);
      
      if (!existing.rows || existing.rows.length === 0) {
        return res.status(404).json({ message: "Snapshot not found" });
      }
      
      const currentRow = existing.rows[0] as Record<string, unknown>;
      const currentTruckNumbers: string[] = currentRow.truck_numbers || [];
      
      let updatedTruckNumbers = currentTruckNumbers;
      if (truckNumbers && Array.isArray(truckNumbers)) {
        const mergedSet = new Set([...currentTruckNumbers, ...truckNumbers]);
        updatedTruckNumbers = Array.from(mergedSet);
      }
      
      const updatedCount = pickupsScheduled !== undefined ? pickupsScheduled : updatedTruckNumbers.length;
      
      const patchTruckNumsJson = JSON.stringify(updatedTruckNumbers);
      await getDb().execute(sql`
        UPDATE pickup_weekly_snapshots
        SET pickups_scheduled = ${updatedCount},
            truck_numbers = (SELECT array_agg(value::text) FROM jsonb_array_elements_text(${patchTruckNumsJson}::jsonb)),
            captured_at = now()
        WHERE id = ${id}
      `);
      
      res.json({ 
        success: true, 
        pickupsScheduled: updatedCount, 
        truckNumbers: updatedTruckNumbers 
      });
    } catch (error: any) {
      console.error("Error updating pickup snapshot:", error);
      res.status(500).json({ message: "Failed to update snapshot" });
    }
  });

  // PUBLIC API: GET truck numbers and main status for external applications
  // This endpoint provides a simplified view of rental dashboard data
  app.get("/public/rentals", async (req, res) => {
    try {
      const trucks = await fleetScopeStorage.getAllTrucks();
      
      // Return simplified data with truck number, status, and repair shop phone
      const rentalData = trucks.map(truck => ({
        truckNumber: truck.truckNumber,
        mainStatus: truck.mainStatus || null,
        subStatus: truck.subStatus || null,
        shopPhone: truck.repairPhone || null,
      }));
      
      res.json({
        count: rentalData.length,
        data: rentalData,
      });
    } catch (error: any) {
      console.error("Error fetching public rental data:", error);
      res.status(500).json({ message: "Failed to fetch rental data" });
    }
  });

  // PUBLIC API: Rental summary (must be before :truckNumber route)
  app.get("/public/rentals/summary", async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.FS_PUBLIC_SPARES_API_KEY;
    if (!expectedApiKey) return res.status(503).json({ success: false, message: "API not configured." });
    if (!apiKey || apiKey !== expectedApiKey) return res.status(401).json({ success: false, message: "Unauthorized. Valid X-API-Key header required." });
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const rentalTrucks = allTrucks.filter(t => t.mainStatus === "NLWC - Return Rental");
      const now = new Date();
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      let totalDurationDays = 0;
      let durationsCount = 0;
      let overdueCount = 0;
      let returnedThisWeek = 0;
      const byRegion: Record<string, number> = {};
      for (const t of allTrucks) {
        if (t.datePutInRepair) {
          const start = new Date(t.datePutInRepair);
          if (!isNaN(start.getTime())) {
            totalDurationDays += Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            durationsCount++;
          }
        }
        const region = t.techState || 'Unknown';
        byRegion[region] = (byRegion[region] || 0) + 1;
      }
      for (const t of rentalTrucks) {
        if (t.expectedReturnDate) {
          const expected = new Date(t.expectedReturnDate);
          if (!isNaN(expected.getTime()) && expected < now && t.rentalStatus !== 'Returned') overdueCount++;
        }
        if (t.rentalStatus === 'Returned' && t.lastUpdatedAt) {
          if (new Date(t.lastUpdatedAt) >= oneWeekAgo) returnedThisWeek++;
        }
      }
      res.json({
        success: true,
        data: {
          totalActive: rentalTrucks.filter(t => t.rentalStatus !== 'Returned').length,
          totalRentals: allTrucks.length,
          averageDurationDays: durationsCount > 0 ? Math.round(totalDurationDays / durationsCount) : 0,
          overdueCount,
          returnedThisWeek,
          byRegion,
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // PUBLIC API: GET single truck status by truck number
  app.get("/public/rentals/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const trucks = await fleetScopeStorage.getAllTrucks();
      const truck = trucks.find(t => t.truckNumber === truckNumber);
      
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }
      
      res.json({
        truckNumber: truck.truckNumber,
        mainStatus: truck.mainStatus || null,
        subStatus: truck.subStatus || null,
        shopPhone: truck.repairPhone || null,
      });
    } catch (error: any) {
      console.error("Error fetching public truck data:", error);
      res.status(500).json({ message: "Failed to fetch truck data" });
    }
  });

  app.get("/public/registrations", async (req, res) => {
    try {
      const internalUrl = `${req.protocol}://${req.get('host')}/api/fs/registration`;
      const response = await fetch(internalUrl);
      if (!response.ok) {
        throw new Error(`Internal registration endpoint returned ${response.status}`);
      }
      const regData = await response.json() as { trucks: any[]; declinedTrucks: string[] };

      const data = regData.trucks
        .filter((t: any) => !t.truckNumber.startsWith('088'))
        .map((t: any) => ({
          truckNumber: t.truckNumber,
          assignmentStatus: t.assignmentStatus,
          regExpiryDate: t.regExpDate || null,
          tagState: t.tagState || null,
          state: t.state || null,
          district: t.district || null,
          techName: t.techName || null,
          techPhone: t.techPhone || null,
          techLeadName: t.techLeadName || null,
          techLeadPhone: t.techLeadPhone || null,
          inRepairShop: t.inRepairShop,
        }));

      res.json({
        count: data.length,
        data,
      });
    } catch (error: any) {
      console.error("Error fetching public registration data:", error);
      res.status(500).json({ message: "Failed to fetch registration data" });
    }
  });

  app.get("/public/registrations/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const normalized = truckNumber.padStart(6, '0');

      const internalUrl = `${req.protocol}://${req.get('host')}/api/fs/registration`;
      const response = await fetch(internalUrl);
      if (!response.ok) {
        throw new Error(`Internal registration endpoint returned ${response.status}`);
      }
      const regData = await response.json() as { trucks: any[] };

      const truck = regData.trucks.find((t: any) => t.truckNumber === normalized);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found in registration data" });
      }

      res.json({
        truckNumber: truck.truckNumber,
        assignmentStatus: truck.assignmentStatus,
        regExpiryDate: truck.regExpDate || null,
        tagState: truck.tagState || null,
        state: truck.state || null,
        district: truck.district || null,
        techName: truck.techName || null,
        techPhone: truck.techPhone || null,
        techLeadName: truck.techLeadName || null,
        techLeadPhone: truck.techLeadPhone || null,
        inRepairShop: truck.inRepairShop,
      });
    } catch (error: any) {
      console.error("Error fetching public registration data:", error);
      res.status(500).json({ message: "Failed to fetch registration data" });
    }
  });

  // PUBLIC API: Update spare vehicle data from external apps
  // POST /api/public/spares/:vehicleNumber
  // Accepts: keys, repaired, contact, confirmedAddress, fleetTeamComments
  // Requires X-API-Key header for authentication
  app.post("/public/spares/:vehicleNumber", async (req, res) => {
    try {
      // API Key authentication
      const apiKey = req.headers['x-api-key'];
      const expectedApiKey = process.env.FS_PUBLIC_SPARES_API_KEY;
      
      if (!expectedApiKey) {
        console.error("[Public API Spares] PUBLIC_SPARES_API_KEY not configured");
        return res.status(503).json({
          success: false,
          message: "API not configured. Please contact administrator."
        });
      }
      
      if (!apiKey || apiKey !== expectedApiKey) {
        console.warn(`[Public API Spares] Unauthorized access attempt`);
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Valid X-API-Key header required."
        });
      }
      
      const { vehicleNumber } = req.params;
      
      // Normalize vehicle number (pad with leading zeros to 6 digits)
      const normalizedVehicleNumber = vehicleNumber.padStart(6, '0');
      
      // Normalize input values to handle snake_case, lowercase, etc.
      const normalizeValue = (val: string): string => val.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Map external app values to Fleet Scope values (case-insensitive with snake_case support)
      const keysMapping: Record<string, string> = {};
      const keysValues = [
        { external: ["Present", "present"], mapped: "Yes" },
        { external: ["Not Present", "not present", "not_present", "notpresent"], mapped: "No" },
        { external: ["Unknown/would not check", "unknown/would not check", "unknown_would_not_check", "unknown"], mapped: "Unconfirmed" },
        { external: ["Yes", "yes"], mapped: "Yes" },
        { external: ["No", "no"], mapped: "No" },
        { external: ["Unconfirmed", "unconfirmed"], mapped: "Unconfirmed" }
      ];
      keysValues.forEach(({ external, mapped }) => {
        external.forEach(e => keysMapping[normalizeValue(e)] = mapped);
      });
      
      const repairedMapping: Record<string, string> = {};
      const repairedValues = [
        { external: ["Complete", "complete", "completed"], mapped: "Complete" },
        { external: ["In Process", "in process", "in_process", "inprocess"], mapped: "In Process" },
        { external: ["Unknown if needed", "unknown if needed", "unknown_if_needed", "unknownifneeded"], mapped: "Unknown if needed" },
        { external: ["Declined", "declined", "decline"], mapped: "Declined" }
      ];
      repairedValues.forEach(({ external, mapped }) => {
        external.forEach(e => repairedMapping[normalizeValue(e)] = mapped);
      });
      
      // Fleet Team Comments mapping - predefined options with flexible input handling
      const fleetTeamCommentsMapping: Record<string, string> = {};
      const fleetTeamOptions = [
        'Declined repair',
        'Sent to PMF', 
        'Available to assign or send to PMF',
        'Available to assign to Rental',
        'In repair',
        'In use',
        'Sent to auction',
        'LOA',
        'Reserved for new hire',
        'Assigned to tech',
        'Assigned to rental',
        'Not found',
        'Repaired But need registration'
      ];
      fleetTeamOptions.forEach(opt => {
        // Add normalized version mapping to proper display value
        fleetTeamCommentsMapping[normalizeValue(opt)] = opt;
      });
      
      // Add additional aliases from external app that use different phrasing
      // From the external app value → Fleet Scope display value
      fleetTeamCommentsMapping['available for rental pmf'] = 'Available to assign or send to PMF';
      fleetTeamCommentsMapping['assigned to tech in rental'] = 'Assigned to rental';
      fleetTeamCommentsMapping['reserved for new hire'] = 'Reserved for new hire';  // already covered, but explicit
      
      // Normalize request body to handle alternative field names from external apps
      // Important: null values from external apps should be treated as "not provided" (omit from normalized body)
      const normalizedBody: Record<string, any> = {};
      
      // Helper to check if a value is actually provided (not null/undefined)
      const isProvided = (val: any) => val !== null && val !== undefined;
      
      // Field name aliases: external app field name → our API field name
      // Only include if the value is not null (null means "not provided")
      if ('keys' in req.body && isProvided(req.body.keys)) normalizedBody.keys = req.body.keys;
      if ('repaired' in req.body && isProvided(req.body.repaired)) normalizedBody.repaired = req.body.repaired;
      // Contact aliases: contact, newLocationContact
      if ('contact' in req.body && isProvided(req.body.contact)) normalizedBody.contact = req.body.contact;
      else if ('newLocationContact' in req.body && isProvided(req.body.newLocationContact)) normalizedBody.contact = req.body.newLocationContact;
      // Address aliases: confirmedAddress, newLocation
      if ('confirmedAddress' in req.body && isProvided(req.body.confirmedAddress)) normalizedBody.confirmedAddress = req.body.confirmedAddress;
      else if ('newLocation' in req.body && isProvided(req.body.newLocation)) normalizedBody.confirmedAddress = req.body.newLocation;
      // Comments aliases: generalComments, comments
      if ('generalComments' in req.body && isProvided(req.body.generalComments)) normalizedBody.generalComments = req.body.generalComments;
      else if ('comments' in req.body && isProvided(req.body.comments)) normalizedBody.generalComments = req.body.comments;
      // Fleet Team Comments aliases: fleetTeamComments, postOffboardedStatus
      if ('fleetTeamComments' in req.body && isProvided(req.body.fleetTeamComments)) normalizedBody.fleetTeamComments = req.body.fleetTeamComments;
      else if ('postOffboardedStatus' in req.body && isProvided(req.body.postOffboardedStatus)) normalizedBody.fleetTeamComments = req.body.postOffboardedStatus;
      
      // Validate input
      const inputSchema = z.object({
        keys: z.string().min(1, "Keys value cannot be empty").optional(),
        repaired: z.string().min(1, "Repaired value cannot be empty").optional(),
        contact: z.string().max(60, "Contact info too long").optional(),
        confirmedAddress: z.string().max(500, "Address too long").optional(),
        generalComments: z.string().max(500, "General comments too long").optional(),
        fleetTeamComments: z.string().max(150, "Fleet team comments too long").optional()
      });
      
      const parseResult = inputSchema.safeParse(normalizedBody);
      if (!parseResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: parseResult.error.errors[0]?.message || "Invalid input" 
        });
      }
      
      const { keys, repaired, contact, confirmedAddress, generalComments, fleetTeamComments } = parseResult.data;
      
      // Track which fields were actually provided in the request body (check normalized body)
      const providedFields = {
        keys: 'keys' in normalizedBody && normalizedBody.keys !== '',
        repaired: 'repaired' in normalizedBody && normalizedBody.repaired !== '',
        contact: 'contact' in normalizedBody,
        confirmedAddress: 'confirmedAddress' in normalizedBody,
        generalComments: 'generalComments' in normalizedBody,
        fleetTeamComments: 'fleetTeamComments' in normalizedBody
      };
      
      // Check if at least one field is provided
      if (!providedFields.keys && !providedFields.repaired && !providedFields.contact && 
          !providedFields.confirmedAddress && !providedFields.generalComments && !providedFields.fleetTeamComments) {
        return res.status(400).json({
          success: false,
          message: "No fields provided. Include at least one of: keys, repaired, contact, confirmedAddress, generalComments, fleetTeamComments (or their aliases: newLocation, newLocationContact, comments, postOffboardedStatus)"
        });
      }
      
      // Validate and map keys value (using normalized lookup)
      let mappedKeys: string | undefined;
      if (providedFields.keys && keys) {
        mappedKeys = keysMapping[normalizeValue(keys)];
        if (!mappedKeys) {
          return res.status(400).json({
            success: false,
            message: `Invalid keys value: "${keys}". Valid values are: Present, Not Present, Unknown/would not check, Yes, No, Unconfirmed`
          });
        }
      }
      
      // Validate repaired value (using normalized lookup)
      let mappedRepaired: string | undefined;
      if (providedFields.repaired && repaired) {
        mappedRepaired = repairedMapping[normalizeValue(repaired)];
        if (!mappedRepaired) {
          return res.status(400).json({
            success: false,
            message: `Invalid repaired value: "${repaired}". Valid values are: Complete, In Process, Unknown if needed, Declined`
          });
        }
      }
      
      // Map fleetTeamComments to proper display value if it matches a predefined option
      let mappedFleetTeamComments: string | null = null;
      if (providedFields.fleetTeamComments && fleetTeamComments) {
        const normalizedInput = normalizeValue(fleetTeamComments);
        // Check if it matches a predefined option
        if (fleetTeamCommentsMapping[normalizedInput]) {
          mappedFleetTeamComments = fleetTeamCommentsMapping[normalizedInput];
        } else {
          // Accept custom values as-is (up to 150 chars already validated by schema)
          mappedFleetTeamComments = fleetTeamComments.trim();
        }
      } else if (providedFields.fleetTeamComments) {
        // Empty string provided - clear the value
        mappedFleetTeamComments = null;
      }
      
      console.log(`[Public API Spares] Updating vehicle ${normalizedVehicleNumber}: keys=${keys}→${mappedKeys}, repaired=${repaired}→${mappedRepaired}, fleetComments=${fleetTeamComments}→${mappedFleetTeamComments}, contact=${providedFields.contact ? 'provided' : 'not provided'}, address=${providedFields.confirmedAddress ? 'provided' : 'not provided'}, generalComments=${providedFields.generalComments ? 'provided' : 'not provided'}`);
      
      // Build updates for PostgreSQL - ONLY include fields that were actually provided
      const pgUpdates: Record<string, any> = { updatedAt: new Date() };
      if (providedFields.keys) pgUpdates.keysStatus = mappedKeys;
      if (providedFields.repaired) pgUpdates.repairCompleted = mappedRepaired;
      if (providedFields.contact) pgUpdates.contactNamePhone = contact?.trim() || null;
      if (providedFields.confirmedAddress) pgUpdates.physicalAddress = confirmedAddress?.trim() || null;
      if (providedFields.generalComments) pgUpdates.generalComments = generalComments?.trim() || null;
      if (providedFields.fleetTeamComments) pgUpdates.johnsComments = mappedFleetTeamComments;
      
      // Save to PostgreSQL
      await fleetScopeStorage.upsertSpareVehicleDetail(normalizedVehicleNumber, pgUpdates);
      console.log(`[Public API Spares] Saved to PostgreSQL for vehicle ${normalizedVehicleNumber}`);
      
      // Build response showing only what was updated
      const updatedFields: Record<string, any> = {};
      if (providedFields.keys) updatedFields.keys = mappedKeys;
      if (providedFields.repaired) updatedFields.repaired = mappedRepaired;
      if (providedFields.contact) updatedFields.contact = contact?.trim() || null;
      if (providedFields.confirmedAddress) updatedFields.confirmedAddress = confirmedAddress?.trim() || null;
      if (providedFields.generalComments) updatedFields.generalComments = generalComments?.trim() || null;
      if (providedFields.fleetTeamComments) updatedFields.fleetTeamComments = mappedFleetTeamComments;
      
      // Return success response immediately
      res.json({
        success: true,
        message: "Spare vehicle data updated successfully",
        vehicleNumber: normalizedVehicleNumber,
        updated: updatedFields
      });
      
      // Sync to Snowflake in background - ONLY include fields that were actually provided
      try {
        const insertFields = ["VEHICLE_NUMBER"];
        const insertValues = ["source.VEHICLE_NUMBER"];
        const sourceFields: string[] = ["? AS VEHICLE_NUMBER"];
        const sourceValues: any[] = [normalizedVehicleNumber];
        const updateSetClauses: string[] = [];
        
        if (providedFields.keys) {
          insertFields.push("KEYS_STATUS");
          insertValues.push("source.KEYS_STATUS");
          sourceFields.push("? AS KEYS_STATUS");
          sourceValues.push(mappedKeys);
          updateSetClauses.push("KEYS_STATUS = source.KEYS_STATUS");
        }
        if (providedFields.repaired) {
          insertFields.push("REPAIRED_STATUS");
          insertValues.push("source.REPAIRED_STATUS");
          sourceFields.push("? AS REPAIRED_STATUS");
          sourceValues.push(mappedRepaired);
          updateSetClauses.push("REPAIRED_STATUS = source.REPAIRED_STATUS");
        }
        if (providedFields.contact) {
          insertFields.push("CONFIRMED_CONTACT");
          insertValues.push("source.CONFIRMED_CONTACT");
          sourceFields.push("? AS CONFIRMED_CONTACT");
          sourceValues.push(contact?.trim() || null);
          updateSetClauses.push("CONFIRMED_CONTACT = source.CONFIRMED_CONTACT");
        }
        if (providedFields.confirmedAddress) {
          insertFields.push("CONFIRMED_ADDRESS");
          insertValues.push("source.CONFIRMED_ADDRESS");
          sourceFields.push("? AS CONFIRMED_ADDRESS");
          sourceValues.push(confirmedAddress?.trim() || null);
          insertFields.push("ADDRESS_UPDATED_AT");
          insertValues.push("CURRENT_TIMESTAMP()");
          updateSetClauses.push("CONFIRMED_ADDRESS = source.CONFIRMED_ADDRESS");
          updateSetClauses.push("ADDRESS_UPDATED_AT = CURRENT_TIMESTAMP()");
        }
        if (providedFields.generalComments) {
          insertFields.push("ONGOING_COMMENTS");
          insertValues.push("source.ONGOING_COMMENTS");
          sourceFields.push("? AS ONGOING_COMMENTS");
          sourceValues.push(generalComments?.trim() || null);
          updateSetClauses.push("ONGOING_COMMENTS = source.ONGOING_COMMENTS");
        }
        if (providedFields.fleetTeamComments) {
          insertFields.push("FLEET_TEAM_FINAL_COMMENTS");
          insertValues.push("source.FLEET_TEAM_FINAL_COMMENTS");
          sourceFields.push("? AS FLEET_TEAM_FINAL_COMMENTS");
          sourceValues.push(fleetTeamComments?.trim() || null);
          updateSetClauses.push("FLEET_TEAM_FINAL_COMMENTS = source.FLEET_TEAM_FINAL_COMMENTS");
        }
        
        // Set MANUAL_EDIT_TIMESTAMP when confirmedAddress, generalComments, or fleetTeamComments are updated
        if (providedFields.confirmedAddress || providedFields.generalComments || providedFields.fleetTeamComments) {
          insertFields.push("MANUAL_EDIT_TIMESTAMP");
          insertValues.push("CURRENT_TIMESTAMP()");
          updateSetClauses.push("MANUAL_EDIT_TIMESTAMP = CURRENT_TIMESTAMP()");
        }
        
        insertFields.push("UPDATED_AT");
        insertValues.push("CURRENT_TIMESTAMP()");
        updateSetClauses.push("UPDATED_AT = CURRENT_TIMESTAMP()");
        
        if (updateSetClauses.length > 0) {
          const sql = `
            MERGE INTO PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS AS target
            USING (SELECT ${sourceFields.join(", ")}) AS source
            ON target.VEHICLE_NUMBER = source.VEHICLE_NUMBER
            WHEN MATCHED THEN
              UPDATE SET ${updateSetClauses.join(", ")}
            WHEN NOT MATCHED THEN
              INSERT (${insertFields.join(", ")})
              VALUES (${insertValues.join(", ")})
          `;
          
          await executeQuery(sql, sourceValues);
          console.log(`[Public API Spares] Synced to Snowflake for vehicle ${normalizedVehicleNumber}`);
        }
      } catch (snowflakeError: any) {
        console.error(`[Public API Spares] Snowflake sync failed (PostgreSQL save succeeded): ${snowflakeError.message}`);
      }
    } catch (error: any) {
      console.error("[Public API Spares] Error updating spare vehicle:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // PUBLIC API: Get all spare vehicle data
  // Requires X-API-Key header for authentication
  app.get("/public/spares", async (req, res) => {
    try {
      // API Key authentication
      const apiKey = req.headers['x-api-key'];
      const expectedApiKey = process.env.FS_PUBLIC_SPARES_API_KEY;
      
      if (!expectedApiKey) {
        console.error("[Public API Spares] PUBLIC_SPARES_API_KEY not configured");
        return res.status(503).json({
          success: false,
          message: "API not configured. Please contact administrator."
        });
      }
      
      if (!apiKey || apiKey !== expectedApiKey) {
        console.warn(`[Public API Spares] Unauthorized access attempt to GET all`);
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Valid X-API-Key header required."
        });
      }
      
      // Get all spare vehicle details from PostgreSQL
      const allDetails = await fleetScopeStorage.getAllSpareVehicleDetails();
      
      // Format response
      const vehicles = allDetails.map(detail => ({
        vehicleNumber: detail.vehicleNumber,
        keys: detail.keysStatus,
        repaired: detail.repairCompleted,
        contact: detail.contactNamePhone,
        confirmedAddress: detail.physicalAddress,
        generalComments: detail.ongoingComments,
        fleetTeamComments: detail.johnsComments,
        registrationRenewalDate: detail.registrationRenewalDate,
        updatedAt: detail.updatedAt
      }));
      
      res.json({
        success: true,
        count: vehicles.length,
        vehicles
      });
    } catch (error: any) {
      console.error("[Public API Spares] Error fetching all spare vehicles:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // PUBLIC API: Get single spare vehicle data
  // Requires X-API-Key header for authentication
  app.get("/public/spares/:vehicleNumber", async (req, res) => {
    try {
      // API Key authentication
      const apiKey = req.headers['x-api-key'];
      const expectedApiKey = process.env.FS_PUBLIC_SPARES_API_KEY;
      
      if (!expectedApiKey) {
        console.error("[Public API Spares] PUBLIC_SPARES_API_KEY not configured");
        return res.status(503).json({
          success: false,
          message: "API not configured. Please contact administrator."
        });
      }
      
      if (!apiKey || apiKey !== expectedApiKey) {
        console.warn(`[Public API Spares] Unauthorized access attempt`);
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Valid X-API-Key header required."
        });
      }
      
      const { vehicleNumber } = req.params;
      const normalizedVehicleNumber = vehicleNumber.padStart(6, '0');
      
      // Get from PostgreSQL
      const detail = await fleetScopeStorage.getSpareVehicleDetail(normalizedVehicleNumber);
      
      if (!detail) {
        return res.status(404).json({ 
          success: false, 
          message: `Vehicle ${normalizedVehicleNumber} not found` 
        });
      }
      
      res.json({
        success: true,
        vehicleNumber: normalizedVehicleNumber,
        data: {
          keys: detail.keysStatus,
          repaired: detail.repairCompleted,
          contact: detail.contactNamePhone,
          confirmedAddress: detail.physicalAddress,
          generalComments: detail.ongoingComments,
          fleetTeamComments: detail.johnsComments,
          registrationRenewalDate: detail.registrationRenewalDate
        }
      });
    } catch (error: any) {
      console.error("[Public API Spares] Error fetching spare vehicle:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ===== PUBLIC API: Comprehensive Module Endpoints =====
  // All require X-API-Key header (validated against PUBLIC_SPARES_API_KEY)

  const requirePublicApiKey = (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = process.env.FS_PUBLIC_SPARES_API_KEY;
    if (!expectedApiKey) {
      return res.status(503).json({ success: false, message: "API not configured. Please contact administrator." });
    }
    if (!apiKey || apiKey !== expectedApiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized. Valid X-API-Key header required." });
    }
    next();
  };

  app.get("/public", (_req, res) => {
    res.json({
      success: true,
      endpoints: [
        { method: "GET", path: "/api/public/rentals", description: "Rental dashboard trucks with status and repair shop info", auth: false },
        { method: "GET", path: "/api/public/rentals/:truckNumber", description: "Single truck rental status", auth: false },
        { method: "GET", path: "/api/public/rentals/summary", description: "Rental summary metrics (active, overdue, by region)", auth: true },
        { method: "GET", path: "/api/public/registrations", description: "Vehicle registration tracking data", auth: false },
        { method: "GET", path: "/api/public/registrations/:truckNumber", description: "Single truck registration data", auth: false },
        { method: "GET", path: "/api/public/spares", description: "Spare vehicle details with status tracking", auth: true },
        { method: "GET", path: "/api/public/spares/:vehicleNumber", description: "Single spare vehicle data", auth: true },
        { method: "GET", path: "/api/public/all-vehicles", description: "Full fleet vehicle list from Snowflake with location data", auth: true },
        { method: "GET", path: "/api/public/pmf", description: "Park My Fleet vehicles and statuses", auth: true },
        { method: "GET", path: "/api/public/pos", description: "Purchase orders with approval status", auth: true },
        { method: "GET", path: "/api/public/po-priority", description: "Priority POs from Snowflake Holman ETL", auth: true },
        { method: "GET", path: "/api/public/decommissioning", description: "Vehicles in decommissioning workflow", auth: true },
        { method: "GET", path: "/api/public/fleet-cost", description: "Fleet cost analytics (paid POs)", auth: true },
        { method: "GET", path: "/api/public/executive-summary", description: "Executive summary with status counts", auth: true },
        { method: "GET", path: "/api/public/metrics", description: "Current and historical KPI metrics", auth: true },
        { method: "GET", path: "/api/public/action-tracker", description: "Owner-based workload view", auth: true },
        { method: "GET", path: "/api/public/call-logs", description: "Batch caller call history and outcomes", auth: true },
        { method: "GET", path: "/api/public/follow-ups", description: "Scheduled follow-up calls", auth: true },
      ],
    });
  });

  app.get("/public/all-vehicles", requirePublicApiKey, async (_req, res) => {
    try {
      const port = process.env.PORT || 5000;
      const internalUrl = `http://localhost:${port}/api/fs/all-vehicles`;
      const response = await fetch(internalUrl);
      if (!response.ok) throw new Error(`Internal all-vehicles endpoint returned ${response.status}`);
      const data = await response.json();
      res.json({ success: true, count: Array.isArray(data) ? data.length : (data.vehicles?.length || 0), data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/pmf", requirePublicApiKey, async (_req, res) => {
    try {
      const dataset = await fleetScopeStorage.getPmfDataset();
      if (!dataset.import) {
        return res.json({ success: true, count: 0, data: [] });
      }
      const rows = dataset.rows.map(row => ({
        ...row,
        rawRow: row.rawRow ? JSON.parse(row.rawRow) : {},
      }));
      res.json({
        success: true,
        count: rows.length,
        uniqueStatuses: dataset.uniqueStatuses,
        data: rows,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/pos", requirePublicApiKey, async (_req, res) => {
    try {
      const orders = await fleetScopeStorage.getAllPurchaseOrders();
      const parsedOrders = orders.map(order => ({
        ...order,
        rawData: order.rawData ? JSON.parse(order.rawData) : {},
      }));
      res.json({ success: true, count: parsedOrders.length, data: parsedOrders });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/po-priority", requirePublicApiKey, async (_req, res) => {
    try {
      const port = process.env.PORT || 5000;
      const internalUrl = `http://localhost:${port}/api/fs/po-priority`;
      const response = await fetch(internalUrl);
      if (!response.ok) throw new Error(`Internal po-priority endpoint returned ${response.status}`);
      const data = await response.json();
      res.json({ success: true, ...data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/decommissioning", requirePublicApiKey, async (_req, res) => {
    try {
      const vehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const rentalTruckNumbers = new Set<string>();
      for (const truck of allTrucks) {
        if (truck.truckNumber) rentalTruckNumbers.add(truck.truckNumber.toString().replace(/^0+/, '') || '0');
      }
      const vehiclesWithRental = vehicles.map(v => ({
        ...v,
        withRental: rentalTruckNumbers.has((v.truckNumber || '').replace(/^0+/, '') || '0'),
      }));
      res.json({ success: true, count: vehiclesWithRental.length, data: vehiclesWithRental });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/fleet-cost", requirePublicApiKey, async (_req, res) => {
    try {
      const port = process.env.PORT || 5000;
      const internalUrl = `http://localhost:${port}/api/fs/fleet-cost/analytics`;
      const response = await fetch(internalUrl);
      if (!response.ok) throw new Error(`Internal fleet-cost endpoint returned ${response.status}`);
      const data = await response.json();
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/executive-summary", requirePublicApiKey, async (_req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const statusCounts: Record<string, number> = {};
      const subStatusCounts: Record<string, Record<string, number>> = {};
      for (const truck of allTrucks) {
        const main = truck.mainStatus || 'Unknown';
        statusCounts[main] = (statusCounts[main] || 0) + 1;
        if (truck.subStatus) {
          if (!subStatusCounts[main]) subStatusCounts[main] = {};
          subStatusCounts[main][truck.subStatus] = (subStatusCounts[main][truck.subStatus] || 0) + 1;
        }
      }
      res.json({
        success: true,
        data: {
          totalTrucks: allTrucks.length,
          byMainStatus: statusCounts,
          bySubStatus: subStatusCounts,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/metrics", requirePublicApiKey, async (req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const current = {
        metricDate: new Date().toISOString().split('T')[0],
        trucksOnRoad: allTrucks.filter(t => t.mainStatus === "On Road").length,
        trucksScheduled: allTrucks.filter(t => t.mainStatus === "Scheduling").length,
        regContactedTech: allTrucks.filter(t => t.registrationStickerValid === "Contacted tech").length,
        regMailedTag: allTrucks.filter(t => t.registrationStickerValid === "Mailed Tag").length,
        regOrderedDuplicates: allTrucks.filter(t => t.registrationStickerValid === "Ordered duplicates").length,
        totalTrucks: allTrucks.length,
        trucksRepairing: allTrucks.filter(t => t.mainStatus === "Repairing").length,
        trucksConfirmingStatus: allTrucks.filter(t => t.mainStatus === "Confirming Status").length,
      };
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const historical = await fleetScopeStorage.getMetricsSnapshots(startDate, endDate);
      res.json({ success: true, data: { current, historical } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/action-tracker", requirePublicApiKey, async (_req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const byOwner: Record<string, any[]> = {};
      for (const truck of allTrucks) {
        const owner = truck.owner || 'Unassigned';
        if (!byOwner[owner]) byOwner[owner] = [];
        byOwner[owner].push({
          truckNumber: truck.truckNumber,
          mainStatus: truck.mainStatus,
          subStatus: truck.subStatus,
          techName: truck.techName,
          repairAddress: truck.repairAddress,
          notes: truck.notes,
          pickUpSlotBooked: truck.pickUpSlotBooked,
          repairCompleted: truck.repairCompleted,
          registrationRenewalInProcess: truck.registrationRenewalInProcess,
        });
      }
      const ownerSummary = Object.entries(byOwner).map(([owner, trucks]) => ({
        owner,
        truckCount: trucks.length,
        trucks,
      }));
      res.json({ success: true, count: allTrucks.length, data: ownerSummary });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/call-logs", requirePublicApiKey, async (_req, res) => {
    try {
      const logs = await fleetScopeStorage.getRecentCallLogs(200);
      res.json({ success: true, count: logs.length, data: logs });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/public/follow-ups", requirePublicApiKey, async (_req, res) => {
    try {
      const followUps = await fleetScopeStorage.getPendingFollowUps();
      res.json({ success: true, count: followUps.length, data: followUps });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ===== END PUBLIC API Module Endpoints =====

  // GET tech specialty (JOBTITLE) via TPMS_EXTRACT_LAST_ASSIGNED -> ORA_TECH_HIRE_ROSTER_VW
  app.get("/tech-specialty", async (req, res) => {
    try {
      const truckNumber = req.query.truckNumber as string;
      if (!truckNumber || !truckNumber.trim()) {
        return res.json({ jobTitle: null });
      }

      const rawTruck = truckNumber.trim();
      const paddedTruck = rawTruck.padStart(6, '0');
      const unpadded = rawTruck.replace(/^0+/, '') || rawTruck;

      const step1Sql = `
        SELECT ENTERPRISE_ID
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED
        WHERE TRUCK_LU IN (?, ?)
        ORDER BY FILE_DATE DESC
        LIMIT 1
      `;
      const step1 = await executeQuery<{ ENTERPRISE_ID: string | number | null }>(step1Sql, [paddedTruck, unpadded]);

      if (step1.length === 0 || !step1[0].ENTERPRISE_ID) {
        return res.json({ jobTitle: null, enterpriseId: null });
      }

      const enterpriseId = String(step1[0].ENTERPRISE_ID).trim();

      const step2Sql = `
        SELECT JOBTITLE
        FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_HIRE_ROSTER_VW
        WHERE UPPER(ENTERPRISE_ID) = UPPER(?)
        ORDER BY LAST_HIRE_DT DESC
        LIMIT 1
      `;
      const step2 = await executeQuery<{ JOBTITLE: string | null }>(step2Sql, [enterpriseId]);

      if (step2.length > 0 && step2[0].JOBTITLE) {
        res.json({ jobTitle: step2[0].JOBTITLE, enterpriseId });
      } else {
        const fallbackSql = `
          SELECT JOBTITLE
          FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_ACTIVE_ROSTER_FWE_VW_VIEW
          WHERE UPPER(ENTERPRISE_ID) = UPPER(?)
          ORDER BY LAST_HIRE_DT DESC
          LIMIT 1
        `;
        const fallback = await executeQuery<{ JOBTITLE: string | null }>(fallbackSql, [enterpriseId]);
        if (fallback.length > 0 && fallback[0].JOBTITLE) {
          res.json({ jobTitle: fallback[0].JOBTITLE, enterpriseId });
        } else {
          res.json({ jobTitle: null, enterpriseId });
        }
      }
    } catch (error: any) {
      console.error("Error fetching tech specialty:", error.message);
      res.json({ jobTitle: null, enterpriseId: null });
    }
  });

  app.post("/tech-specialty/batch", async (req, res) => {
    try {
      const { truckNumbers } = req.body as { truckNumbers: string[] };
      if (!truckNumbers || !Array.isArray(truckNumbers) || truckNumbers.length === 0) {
        return res.json({ specialties: {} });
      }

      const allLookups: string[] = [];
      const truckToKeys = new Map<string, string[]>();
      for (const tn of truckNumbers) {
        const raw = tn.trim();
        const padded = raw.padStart(6, '0');
        const unpadded = raw.replace(/^0+/, '') || raw;
        const keys = [padded, unpadded];
        truckToKeys.set(tn, keys);
        allLookups.push(padded, unpadded);
      }
      const uniqueLookups = Array.from(new Set(allLookups));
      const placeholders = uniqueLookups.map(() => '?').join(',');

      const step1Sql = `
        SELECT TRUCK_LU, ENTERPRISE_ID, FILE_DATE
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED
        WHERE TRUCK_LU IN (${placeholders})
        QUALIFY ROW_NUMBER() OVER (PARTITION BY TRUCK_LU ORDER BY FILE_DATE DESC) = 1
      `;
      const step1Results = await executeQuery<{ TRUCK_LU: string; ENTERPRISE_ID: string | number | null }>(step1Sql, uniqueLookups);

      const truckLuToEntId = new Map<string, string>();
      const enterpriseIds = new Set<string>();
      for (const row of step1Results) {
        if (row.TRUCK_LU && row.ENTERPRISE_ID) {
          const entId = String(row.ENTERPRISE_ID).trim();
          truckLuToEntId.set(row.TRUCK_LU.trim(), entId);
          enterpriseIds.add(entId);
        }
      }

      const specialties: Record<string, string | null> = {};
      const enterpriseIdMap: Record<string, string | null> = {};
      for (const tn of truckNumbers) {
        specialties[tn] = null;
        enterpriseIdMap[tn] = null;
      }

      // Map enterprise IDs to truck numbers
      for (const tn of truckNumbers) {
        const keys = truckToKeys.get(tn) || [];
        for (const key of keys) {
          const entId = truckLuToEntId.get(key);
          if (entId) {
            enterpriseIdMap[tn] = entId;
            break;
          }
        }
      }

      if (enterpriseIds.size === 0) {
        return res.json({ specialties, enterpriseIds: enterpriseIdMap });
      }

      const entIdArr = Array.from(enterpriseIds);
      const entPlaceholders = entIdArr.map(() => '?').join(',');

      const step2Sql = `
        SELECT ENTERPRISE_ID, JOBTITLE, LAST_HIRE_DT
        FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_HIRE_ROSTER_VW
        WHERE UPPER(ENTERPRISE_ID) IN (${entIdArr.map(() => 'UPPER(?)').join(',')})
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ENTERPRISE_ID ORDER BY LAST_HIRE_DT DESC) = 1
      `;
      const step2Results = await executeQuery<{ ENTERPRISE_ID: string | number; JOBTITLE: string | null }>(step2Sql, entIdArr);

      const entIdToJob = new Map<string, string>();
      for (const row of step2Results) {
        if (row.ENTERPRISE_ID && row.JOBTITLE) {
          entIdToJob.set(String(row.ENTERPRISE_ID).trim().toUpperCase(), row.JOBTITLE);
        }
      }

      // Find enterprise IDs that didn't match in the first roster view
      const missingEntIds = entIdArr.filter(id => !entIdToJob.has(id.toUpperCase()));
      if (missingEntIds.length > 0) {
        const fallbackSql = `
          SELECT ENTERPRISE_ID, JOBTITLE, LAST_HIRE_DT
          FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_ACTIVE_ROSTER_FWE_VW_VIEW
          WHERE UPPER(ENTERPRISE_ID) IN (${missingEntIds.map(() => 'UPPER(?)').join(',')})
          QUALIFY ROW_NUMBER() OVER (PARTITION BY ENTERPRISE_ID ORDER BY LAST_HIRE_DT DESC) = 1
        `;
        const fallbackResults = await executeQuery<{ ENTERPRISE_ID: string | number; JOBTITLE: string | null }>(fallbackSql, missingEntIds);
        for (const row of fallbackResults) {
          if (row.ENTERPRISE_ID && row.JOBTITLE) {
            entIdToJob.set(String(row.ENTERPRISE_ID).trim().toUpperCase(), row.JOBTITLE);
          }
        }
      }

      for (const tn of truckNumbers) {
        const keys = truckToKeys.get(tn) || [];
        for (const key of keys) {
          const entId = truckLuToEntId.get(key);
          if (entId) {
            specialties[tn] = entIdToJob.get(entId.toUpperCase()) || null;
            break;
          }
        }
      }

      res.json({ specialties, enterpriseIds: enterpriseIdMap });
    } catch (error: any) {
      console.error("Error fetching batch tech specialties:", error.message);
      res.json({ specialties: {}, enterpriseIds: {} });
    }
  });

  // ===== PO Status per Truck (from Snowflake HOLMAN_ETL_PO_DETAILS) =====
  let poStatusCache: { data: any; timestamp: number } | null = null;
  const PO_STATUS_CACHE_TTL = 5 * 60 * 1000;

  app.get("/trucks/po-status", async (req, res) => {
    try {
      const now = Date.now();
      if (poStatusCache && (now - poStatusCache.timestamp) < PO_STATUS_CACHE_TTL) {
        return res.json(poStatusCache.data);
      }

      console.log("[PO Status] Fetching from Snowflake HOLMAN_ETL_PO_DETAILS...");

      const poSql = `
        SELECT HOLMAN_VEHICLE_NUMBER, PO_STATUS, PO_DATE
        FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
        WHERE UPPER(REPAIR_TYPE_DESCRIPTION) IN ('PARTS', 'LABOR', 'PREVENTATIVE MAINT.')
          AND UPPER(ATA_GROUP_DESC) != 'RENTALS'
          AND HOLMAN_VEHICLE_NUMBER IS NOT NULL
        ORDER BY PO_DATE DESC
      `;
      const rawRows = await executeQuery<{ HOLMAN_VEHICLE_NUMBER: string; PO_STATUS: string; PO_DATE: string }>(poSql);
      console.log(`[PO Status] Fetched ${rawRows.length} rows from Snowflake`);

      const statusMap: Record<string, { poStatus: string; poDate: string }> = {};
      for (const row of rawRows) {
        const num = (row.HOLMAN_VEHICLE_NUMBER || '').toString().replace(/\D/g, '').padStart(6, '0');
        if (!num || num === '000000') continue;
        if (!statusMap[num]) {
          statusMap[num] = {
            poStatus: (row.PO_STATUS || '').toString(),
            poDate: (row.PO_DATE || '').toString(),
          };
        }
      }

      console.log(`[PO Status] Built status map for ${Object.keys(statusMap).length} vehicles`);
      poStatusCache = { data: statusMap, timestamp: Date.now() };
      res.json(statusMap);
    } catch (error: any) {
      console.error("[PO Status] Error:", error);
      res.status(500).json({ message: "Failed to fetch PO status data" });
    }
  });

  // API: Get all scraper statuses (for dashboard column)
  app.get("/trucks/scraper-status", async (_req, res) => {
    try {
      const data = await fetchAllScraperData();
      const statusMap: Record<string, { status: string; lastScraped: string; location: string; primaryIssue: string; priority: string; repairVendorPhone: string; repairVendorAddress: string; recommendation: string }> = {};
      
      for (const [num, v] of Object.entries(data)) {
        if (v.status) {
          statusMap[num] = {
            status: v.status || '',
            lastScraped: v.last_scraped || '',
            location: v.location || '',
            primaryIssue: v.primary_issue || '',
            priority: v.priority || '',
            repairVendorPhone: v.repair_vendor?.phone || '',
            repairVendorAddress: v.repair_vendor?.address || '',
            recommendation: v.recommendation || '',
          };
        }
      }
      
      res.json(statusMap);
    } catch (error: any) {
      console.error("[Scraper Status] Error:", error);
      res.status(500).json({ message: "Failed to fetch scraper status data" });
    }
  });

  // API: Get full scraper detail for a single truck
  app.get("/trucks/scraper-detail/:truckNumber", async (req, res) => {
    try {
      const truckNumber = req.params.truckNumber.replace(/^0+/, '');
      
      const [publicRes, detailRes] = await Promise.all([
        fetch(`${SCRAPER_BASE_URL}/api/public/vehicle/${truckNumber}`),
        fetch(`${SCRAPER_BASE_URL}/api/vehicles/${truckNumber}`),
      ]);
      
      if (!publicRes.ok) {
        return res.status(publicRes.status).json({ message: "Vehicle not found in scraper" });
      }
      
      const publicData = await publicRes.json();
      
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        const detailPOs = detailData.pos || [];
        
        const poMap = new Map<string, any>();
        for (const po of detailPOs) {
          poMap.set(po.po_number, po);
        }
        
        const enrichPO = (po: any) => {
          const detail = poMap.get(po.po_number);
          if (detail) {
            return {
              ...po,
              event_id: detail.event_id || po.event_id,
              odometer: detail.odometer || po.odometer,
              vendor_type: detail.vendor_type || po.vendor_type,
              line_items: detail.line_items || [],
              notes: detail.notes || [],
            };
          }
          return po;
        };
        
        publicData.repair_pos = (publicData.repair_pos || []).map(enrichPO);
        publicData.rental_pos = (publicData.rental_pos || []).map(enrichPO);
        
        if (detailData.event_messages?.length) {
          publicData.event_messages = detailData.event_messages;
        }
        if (detailData.vehicle) {
          publicData.total_maintenance_cost = detailData.vehicle.total_maintenance_cost;
          publicData.total_pos = detailData.vehicle.total_pos;
        }
      }
      
      res.json(publicData);
    } catch (error: any) {
      console.error("[Scraper Detail] Error:", error);
      res.status(500).json({ message: "Failed to fetch scraper detail" });
    }
  });

  // GET single truck by ID
  app.get("/trucks/:id", async (req, res) => {
    try {
      const truck = await fleetScopeStorage.getTruck(req.params.id);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }
      const tNum = (truck.truckNumber || '').toString().padStart(6, '0');
      const techCacheEntry = technicianDataCache.get(tNum);
      res.json({ ...truck, techAddress: techCacheEntry?.fullAddress || '' });
    } catch (error: any) {
      console.error("Error fetching truck:", error);
      res.status(500).json({ message: "Failed to fetch truck" });
    }
  });

  // POST call repair shop via ElevenLabs outbound call
  app.post("/trucks/:id/call-repair-shop", async (req, res) => {
    try {
      if (!process.env.FS_ELEVENLABS_API_KEY) {
        return res.status(500).json({ message: "ElevenLabs API key not configured" });
      }

      const truck = await fleetScopeStorage.getTruck(req.params.id);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      if (!truck.repairPhone || truck.repairPhone.trim() === "") {
        return res.status(400).json({ message: "No repair shop phone number on file for this truck" });
      }

      // Normalize phone: strip non-digits, ensure +1 prefix
      const digits = truck.repairPhone.replace(/\D/g, "");
      const toNumber = digits.startsWith("1") && digits.length === 11
        ? `+${digits}`
        : `+1${digits}`;

      // Fetch vehicle details from Snowflake
      const vehicleNum = truck.truckNumber?.toString() || "";
      const paddedVehicleNum = vehicleNum.startsWith("0") ? vehicleNum : `0${vehicleNum}`;
      let vin = "";
      let make = "";
      let model = "";
      let licensePlate = "";

      try {
        const vehicleQuery = `
          SELECT VIN, MAKE_NAME, MODEL_NAME
          FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
          WHERE TRIM(VEHICLE_NUMBER) = '${paddedVehicleNum}'
          LIMIT 1
        `;
        const vehicleData = await executeQuery<{ VIN: string; MAKE_NAME: string; MODEL_NAME: string }>(vehicleQuery);
        if (vehicleData.length > 0) {
          vin = vehicleData[0].VIN?.toString().trim() || "";
          make = vehicleData[0].MAKE_NAME?.toString().trim() || "";
          model = vehicleData[0].MODEL_NAME?.toString().trim() || "";
        }
      } catch (err: any) {
        console.warn("[CallRepairShop] Could not fetch vehicle data from Snowflake:", err.message);
      }

      if (vin) {
        try {
          const holmanQuery = `
            SELECT LICENSE_PLATE
            FROM PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES
            WHERE TRIM(VIN) = '${vin}'
            LIMIT 1
          `;
          const holmanData = await executeQuery<{ LICENSE_PLATE: string | null }>(holmanQuery);
          if (holmanData.length > 0) {
            licensePlate = holmanData[0].LICENSE_PLATE?.toString().trim() || "";
          }
        } catch (err: any) {
          console.warn("[CallRepairShop] Could not fetch license plate from Holman:", err.message);
        }
      }

      const last8Vin = vin.length >= 8 ? vin.slice(-8) : vin;
      const todaysDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      const payload = {
        agent_id: "agent_7901kgj8m0w8ep6ar78fzthzr9jv",
        agent_phone_number_id: "phnum_0401khxk7pknfafb4nb08kzfdkr0",
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: {
            vin_number: vin,
            last_8_vin: last8Vin,
            license_plate: licensePlate,
            make,
            model,
            tech_name: truck.techName || "",
            today_s_date: todaysDate,
            phone_number: truck.repairPhone.trim(),
          },
        },
      };

      const apiKey = (process.env.FS_ELEVENLABS_API_KEY || "").trim();
      console.log(`[CallRepairShop] Calling ${toNumber} for truck ${vehicleNum} (VIN: ${vin}), API key length: ${apiKey.length}, starts with: ${apiKey.substring(0, 4)}...`);

      const response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CallRepairShop] ElevenLabs API error ${response.status}:`, errorText);
        try {
          await fleetScopeStorage.updateTruck(truck.id, {
            lastCallDate: new Date(),
            lastCallStatus: "Call Failed",
            lastCallSummary: `API error ${response.status}: ${errorText}`,
          });
        } catch (e) {}
        return res.status(response.status).json({ message: `ElevenLabs API error: ${errorText}` });
      }

      const result = await response.json();
      console.log(`[CallRepairShop] Call initiated successfully. Full response:`, JSON.stringify(result));

      // Save conversation ID and call date to truck record
      // ElevenLabs may return conversation_id or callSid — log all keys to identify the correct field
      const conversationId = result?.conversation_id || result?.conversationId || result?.call_sid || result?.callSid || null;
      console.log(`[CallRepairShop] Extracted conversationId: ${conversationId} (keys: ${Object.keys(result || {}).join(', ')})`);

      try {
        await fleetScopeStorage.updateTruck(truck.id, {
          lastCallDate: new Date(),
          lastCallConversationId: conversationId,
          lastCallSummary: null,
        });
      } catch (saveErr: any) {
        console.warn("[CallRepairShop] Could not save call metadata:", saveErr.message);
      }

      res.json({ success: true, toNumber, conversationId, result });
    } catch (error: any) {
      console.error("[CallRepairShop] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // POST call technician for vehicle pickup via ElevenLabs outbound call
  app.post("/trucks/:id/call-technician", async (req, res) => {
    try {
      if (!process.env.FS_ELEVENLABS_API_KEY) {
        return res.status(500).json({ message: "ElevenLabs API key not configured" });
      }

      const truck = await fleetScopeStorage.getTruck(req.params.id);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      if (!truck.techPhone || truck.techPhone.trim() === "") {
        return res.status(400).json({ message: "No technician phone number on file for this truck" });
      }

      const digits = truck.techPhone.replace(/\D/g, "");
      const toNumber = digits.startsWith("1") && digits.length === 11
        ? `+${digits}`
        : `+1${digits}`;

      const vehicleNum = truck.truckNumber?.toString() || "";
      const shopAddress = truck.repairAddress || "";
      const shopName = shopAddress.split(",")[0].split(" - ").pop()?.trim() || shopAddress;
      const shopPhone = truck.repairPhone || "";

      const payload = {
        agent_id: "agent_9401kk2njc6veajaecs89wtbh840",
        agent_phone_number_id: "phnum_0401khxk7pknfafb4nb08kzfdkr0",
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: {
            TECH_NAME: truck.techName || "",
            VEHICLE_NUMBER: vehicleNum,
            SHOP_NAME: shopName,
            SHOP_ADDRESS: shopAddress,
            SHOP_PHONE: shopPhone,
            SCHEDULED_PICKUP_TIME: truck.timeBlockedToPickUpVan || "",
          },
        },
      };

      const apiKey = (process.env.FS_ELEVENLABS_API_KEY || "").trim();
      console.log(`[CallTechnician] Calling tech ${truck.techName || 'unknown'} at ${toNumber} for truck ${vehicleNum}`);

      const response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CallTechnician] ElevenLabs API error ${response.status}:`, errorText);
        try {
          await fleetScopeStorage.updateTruck(truck.id, {
            lastTechCallDate: new Date(),
            lastTechCallStatus: "Call Failed",
            lastTechCallSummary: `API error ${response.status}: ${errorText}`,
          });
        } catch (e) {}
        return res.status(response.status).json({ message: `ElevenLabs API error: ${errorText}` });
      }

      const result = await response.json();
      console.log(`[CallTechnician] Call initiated successfully. Full response:`, JSON.stringify(result));

      const conversationId = result?.conversation_id || result?.conversationId || result?.call_sid || result?.callSid || null;
      console.log(`[CallTechnician] Extracted conversationId: ${conversationId}`);

      try {
        await fleetScopeStorage.updateTruck(truck.id, {
          lastTechCallDate: new Date(),
          lastTechCallConversationId: conversationId,
          lastTechCallSummary: null,
        });
      } catch (saveErr: any) {
        console.warn("[CallTechnician] Could not save call metadata:", saveErr.message);
      }

      res.json({ success: true, toNumber, conversationId, result });
    } catch (error: any) {
      console.error("[CallTechnician] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // POST ElevenLabs webhook — receives call transcript and generates GPT summary
  // ===== BATCH CALLING ENGINE =====
  const batchJobs = new Map<string, {
    id: string;
    truckIds: string[];
    callType: string;
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    cancelled: boolean;
    results: Array<{ truckId: string; truckNumber: string; status: string; conversationId?: string; error?: string }>;
    startedAt: Date;
  }>();

  app.post("/batch-call/start", async (req, res) => {
    try {
      const { truckIds, callType } = req.body;
      if (!truckIds?.length || !callType) {
        return res.status(400).json({ message: "truckIds and callType are required" });
      }
      if (!process.env.FS_ELEVENLABS_API_KEY) {
        return res.status(500).json({ message: "ElevenLabs API key not configured" });
      }

      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const job = {
        id: batchId,
        truckIds,
        callType,
        total: truckIds.length,
        completed: 0,
        failed: 0,
        inProgress: 0,
        cancelled: false,
        results: [] as Array<{ truckId: string; truckNumber: string; status: string; conversationId?: string; error?: string }>,
        startedAt: new Date(),
      };
      batchJobs.set(batchId, job);

      // Process in background
      (async () => {
        const BATCH_SIZE = 2;
        const apiKey = (process.env.FS_ELEVENLABS_API_KEY || "").trim();

        for (let i = 0; i < truckIds.length; i += BATCH_SIZE) {
          if (job.cancelled) break;
          const batch = truckIds.slice(i, i + BATCH_SIZE);
          job.inProgress = batch.length;

          const withTimeout = (promise: Promise<void>, ms: number): Promise<void> =>
            Promise.race([promise, new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Call timeout")), ms))]);

          const promises = batch.map(async (truckId: string) => {
            try {
              const truck = await fleetScopeStorage.getTruck(truckId);
              if (!truck) {
                job.results.push({ truckId, truckNumber: "?", status: "failed", error: "Truck not found" });
                job.failed++;
                return;
              }

              const phoneNumber = callType === "tech" ? truck.techPhone : truck.repairPhone;
              if (!phoneNumber || phoneNumber.trim() === "") {
                job.results.push({ truckId, truckNumber: truck.truckNumber || "?", status: "failed", error: "No phone number" });
                job.failed++;
                return;
              }

              const digits = phoneNumber.replace(/\D/g, "");
              if (digits.length < 10 || digits.length > 11) {
                job.results.push({ truckId, truckNumber: truck.truckNumber || "?", status: "failed", error: "Invalid phone number length" });
                job.failed++;
                return;
              }
              const toNumber = digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
              const vehicleNum = truck.truckNumber?.toString() || "";

              let payload: any;
              if (callType === "tech") {
                payload = {
                  agent_id: "agent_9401kk2njc6veajaecs89wtbh840",
                  agent_phone_number_id: "phnum_0401khxk7pknfafb4nb08kzfdkr0",
                  to_number: toNumber,
                  conversation_initiation_client_data: {
                    dynamic_variables: {
                      TECH_NAME: truck.techName || "",
                      VEHICLE_NUMBER: vehicleNum,
                      SHOP_NAME: (truck.repairAddress || "").split(",")[0].split(" - ").pop()?.trim() || "",
                      SHOP_ADDRESS: truck.repairAddress || "",
                      SHOP_PHONE: truck.repairPhone || "",
                      SCHEDULED_PICKUP_TIME: truck.timeBlockedToPickUpVan || "",
                    },
                  },
                };
              } else {
                // Shop call - fetch vehicle details from Snowflake
                const paddedVehicleNum = vehicleNum.startsWith("0") ? vehicleNum : `0${vehicleNum}`;
                let vin = "", make = "", model = "", licensePlate = "";
                try {
                  const vehicleQuery = `SELECT VIN, MAKE_NAME, MODEL_NAME FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES WHERE TRIM(VEHICLE_NUMBER) = '${paddedVehicleNum}' LIMIT 1`;
                  const vehicleData = await executeQuery<{ VIN: string; MAKE_NAME: string; MODEL_NAME: string }>(vehicleQuery);
                  if (vehicleData.length > 0) {
                    vin = vehicleData[0].VIN?.toString().trim() || "";
                    make = vehicleData[0].MAKE_NAME?.toString().trim() || "";
                    model = vehicleData[0].MODEL_NAME?.toString().trim() || "";
                  }
                } catch (e) {}

                if (vin) {
                  try {
                    const holmanQuery = `SELECT LICENSE_PLATE FROM PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES WHERE TRIM(VIN) = '${vin}' LIMIT 1`;
                    const holmanData = await executeQuery<{ LICENSE_PLATE: string | null }>(holmanQuery);
                    if (holmanData.length > 0) licensePlate = holmanData[0].LICENSE_PLATE?.toString().trim() || "";
                  } catch (e) {}
                }

                const last8Vin = vin.length >= 8 ? vin.slice(-8) : vin;
                const todaysDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

                payload = {
                  agent_id: "agent_7901kgj8m0w8ep6ar78fzthzr9jv",
                  agent_phone_number_id: "phnum_0401khxk7pknfafb4nb08kzfdkr0",
                  to_number: toNumber,
                  conversation_initiation_client_data: {
                    dynamic_variables: {
                      vin_number: vin, last_8_vin: last8Vin, license_plate: licensePlate,
                      make, model, tech_name: truck.techName || "",
                      today_s_date: todaysDate, phone_number: phoneNumber.trim(),
                    },
                  },
                };
              }

              console.log(`[BatchCaller] Calling ${toNumber} for truck ${vehicleNum} (${callType})`);
              const response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
                method: "POST",
                headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });

              if (!response.ok) {
                const errText = await response.text();
                console.error(`[BatchCaller] API error for truck ${vehicleNum}:`, errText);

                await fleetScopeStorage.createCallLog({
                  truckId, truckNumber: vehicleNum, batchId, callType,
                  phoneNumber: toNumber, status: "failed", outcome: "CALL_FAILED",
                  shopNotes: `API error ${response.status}: ${errText}`,
                });

                if (callType === "tech") {
                  await fleetScopeStorage.updateTruck(truck.id, { lastTechCallDate: new Date(), lastTechCallStatus: "Call Failed", lastTechCallSummary: `Batch call API error` });
                } else {
                  await fleetScopeStorage.updateTruck(truck.id, { lastCallDate: new Date(), lastCallStatus: "Call Failed", lastCallSummary: `Batch call API error` });
                }

                job.results.push({ truckId, truckNumber: vehicleNum, status: "failed", error: `API ${response.status}` });
                job.failed++;
                return;
              }

              const result = await response.json();
              const conversationId = result?.conversation_id || result?.conversationId || result?.call_sid || null;

              await fleetScopeStorage.createCallLog({
                truckId, truckNumber: vehicleNum, batchId, callType,
                phoneNumber: toNumber, elevenLabsConversationId: conversationId, status: "in_progress",
              });

              if (callType === "tech") {
                await fleetScopeStorage.updateTruck(truck.id, { lastTechCallDate: new Date(), lastTechCallConversationId: conversationId, lastTechCallSummary: null });
              } else {
                await fleetScopeStorage.updateTruck(truck.id, { lastCallDate: new Date(), lastCallConversationId: conversationId, lastCallSummary: null });
              }

              job.results.push({ truckId, truckNumber: vehicleNum, status: "in_progress", conversationId });
              job.completed++;
            } catch (err: any) {
              job.results.push({ truckId, truckNumber: "?", status: "failed", error: err.message });
              job.failed++;
            }
          });

          await Promise.all(promises.map(p => withTimeout(p, 720000).catch((err) => {
            console.warn(`[BatchCaller] Call timeout or error in batch:`, err.message);
          })));
          job.inProgress = 0;

          // Wait 5 seconds between batches to avoid rate limiting
          if (i + BATCH_SIZE < truckIds.length && !job.cancelled) {
            await new Promise(r => setTimeout(r, 5000));
          }
        }
        console.log(`[BatchCaller] Batch ${batchId} complete: ${job.completed} called, ${job.failed} failed out of ${job.total}`);
      })();

      res.json({ batchId, total: truckIds.length, message: "Batch calling started" });
    } catch (error: any) {
      console.error("[BatchCaller] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/batch-call/status/:batchId", async (req, res) => {
    const job = batchJobs.get(req.params.batchId);
    if (!job) return res.status(404).json({ message: "Batch not found" });
    res.json({
      id: job.id, total: job.total, completed: job.completed, failed: job.failed,
      inProgress: job.inProgress, cancelled: job.cancelled, results: job.results,
      done: job.completed + job.failed >= job.total || job.cancelled,
    });
  });

  app.post("/batch-call/cancel/:batchId", async (req, res) => {
    const job = batchJobs.get(req.params.batchId);
    if (!job) return res.status(404).json({ message: "Batch not found" });
    job.cancelled = true;
    res.json({ message: "Batch cancelled" });
  });

  app.get("/call-logs", async (_req, res) => {
    try {
      const logs = await fleetScopeStorage.getRecentCallLogs(200);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/call-logs/:truckId", async (req, res) => {
    try {
      const logs = await fleetScopeStorage.getCallLogsByTruckId(req.params.truckId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/follow-ups", async (_req, res) => {
    try {
      const followUps = await fleetScopeStorage.getPendingFollowUps();
      res.json(followUps);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== ELEVENLABS WEBHOOK =====
  app.post("/elevenlabs/webhook", async (req, res) => {
    try {
      const body = req.body;
      const conversationId = body?.conversation_id || body?.data?.conversation_id;
      if (!conversationId) {
        return res.status(400).json({ message: "Missing conversation_id" });
      }

      console.log(`[ElevenLabs Webhook] Received event for conversation: ${conversationId}`, JSON.stringify(body).slice(0, 500));

      // Find the truck with this conversation ID — check both repair shop and tech call fields
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      let truck = allTrucks.find((t: any) => t.lastCallConversationId === conversationId);
      let callType: "repair" | "tech" = "repair";
      if (!truck) {
        truck = allTrucks.find((t: any) => t.lastTechCallConversationId === conversationId);
        if (truck) callType = "tech";
      }
      if (!truck) {
        console.warn(`[ElevenLabs Webhook] No truck found for conversation ${conversationId}`);
        return res.status(200).json({ received: true, matched: false });
      }

      console.log(`[ElevenLabs Webhook] Matched truck ${truck.truckNumber} (${callType} call)`);

      // Extract transcript from the webhook payload
      const transcript = body?.transcript || body?.data?.transcript || body?.conversation?.transcript;
      if (!transcript) {
        console.log(`[ElevenLabs Webhook] No transcript yet for ${conversationId}`);
        return res.status(200).json({ received: true, matched: true, transcriptReady: false });
      }

      // Build transcript string
      let transcriptText = "";
      if (Array.isArray(transcript)) {
        transcriptText = transcript
          .map((turn: any) => `${turn.role || turn.speaker || "Unknown"}: ${turn.message || turn.text || ""}`)
          .join("\n");
      } else if (typeof transcript === "string") {
        transcriptText = transcript;
      } else {
        transcriptText = JSON.stringify(transcript);
      }

      // Generate summary with OpenAI
      if (!process.env.FS_OPENAI_API_KEY) {
        console.warn("[ElevenLabs Webhook] No OPENAI_API_KEY, skipping summary");
        return res.status(200).json({ received: true, matched: true, summarized: false });
      }

      const systemPrompt = callType === "tech"
        ? `You are a fleet coordinator assistant. Analyze technician pickup call transcripts. Respond in JSON with these fields:
"status": one of these exact values: "Will Pick Up", "No Answer", "Call Failed", "Other Issues"
"summary": 2-3 sentence factual summary of the call
"estimated_ready_date": if a pickup date was mentioned, return it as YYYY-MM-DD, otherwise null
"blockers": any issues preventing pickup, or null
Respond ONLY with valid JSON, no other text.`
        : `You are a fleet coordinator assistant. Analyze repair shop call transcripts. Respond in JSON with these fields:
"status": one of these exact values: "Ready", "In Repair", "In Authorization", "Parts Ordered", "No Answer", "Call Failed", "Failed"
"summary": 2-3 sentence factual summary of the call
"estimated_ready_date": if a completion/ready date was mentioned, return it as YYYY-MM-DD, otherwise null
"blockers": any issues blocking repair completion (e.g. parts on order, awaiting authorization), or null
Respond ONLY with valid JSON, no other text.`;

      const userPrompt = callType === "tech"
        ? `Analyze this technician pickup call transcript:\n\n${transcriptText}`
        : `Analyze this repair shop call transcript:\n\n${transcriptText}`;

      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.FS_OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
      });

      let summary = "";
      let status = "";
      let estimatedReadyDate: string | null = null;
      let blockers: string | null = null;
      if (openaiRes.ok) {
        const openaiData = await openaiRes.json();
        const raw = openaiData.choices?.[0]?.message?.content?.trim() || "";
        console.log(`[ElevenLabs Webhook] GPT response (${callType}) for truck ${truck.truckNumber}: ${raw}`);
        try {
          const parsed = JSON.parse(raw);
          status = parsed.status || "";
          summary = parsed.summary || "";
          estimatedReadyDate = parsed.estimated_ready_date || null;
          blockers = parsed.blockers || null;
        } catch {
          summary = raw;
          status = "Unknown";
        }
      } else {
        const errText = await openaiRes.text();
        console.error(`[ElevenLabs Webhook] OpenAI error:`, errText);
        summary = "Summary unavailable — analysis failed.";
        status = "Error";
      }

      console.log(`[ElevenLabs Webhook] Status: "${status}", Summary: "${summary}"`);

      if (callType === "tech") {
        await fleetScopeStorage.updateTruck(truck.id, { lastTechCallSummary: summary, lastTechCallStatus: status });
      } else {
        await fleetScopeStorage.updateTruck(truck.id, { lastCallSummary: summary, lastCallStatus: status });
      }

      // Update call_log if one exists for this conversation
      try {
        const callLog = await fleetScopeStorage.getCallLogByConversationId(conversationId);
        if (callLog) {
          const mappedOutcome = status === "Ready" || status === "Will Pick Up" ? "VEHICLE_READY"
            : (status === "No Answer" || status === "Call Failed" || status === "Failed") ? "CALL_FAILED"
            : "VEHICLE_NOT_READY";

          const currentAttempt = callLog.attemptNumber || 1;
          let nextFollowUp: string | undefined;

          if (mappedOutcome === "VEHICLE_NOT_READY" && estimatedReadyDate) {
            const eta = new Date(estimatedReadyDate);
            eta.setDate(eta.getDate() - 1);
            nextFollowUp = eta.toISOString().split("T")[0];
          } else if (mappedOutcome === "VEHICLE_NOT_READY") {
            const d = new Date();
            d.setDate(d.getDate() + 3);
            nextFollowUp = d.toISOString().split("T")[0];
          }

          if (mappedOutcome === "CALL_FAILED" && currentAttempt < 3) {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            nextFollowUp = d.toISOString().split("T")[0];
          }

          await fleetScopeStorage.updateCallLog(callLog.id, {
            status: "completed",
            outcome: mappedOutcome,
            shopNotes: summary,
            transcript: transcriptText,
            estimatedReadyDate: estimatedReadyDate || callLog.estimatedReadyDate,
            blockers: blockers || callLog.blockers,
            attemptNumber: mappedOutcome === "CALL_FAILED" ? currentAttempt + 1 : currentAttempt,
            nextFollowUpDate: nextFollowUp || callLog.nextFollowUpDate,
          });
          console.log(`[ElevenLabs Webhook] Updated call_log ${callLog.id} with outcome ${mappedOutcome}`);

          // Auto-trigger tech call DISABLED — previously called tech automatically when shop reported VEHICLE_READY
          // To re-enable, uncomment the block below:
          /*
          if (mappedOutcome === "VEHICLE_READY" && callLog.callType === "shop") {
            const truckForAutoCall = await fleetScopeStorage.getTruck(callLog.truckId);
            if (truckForAutoCall?.techPhone && truckForAutoCall.techPhone.trim()) {
              console.log(`[ElevenLabs Webhook] Auto-triggering tech call for truck ${truckForAutoCall.truckNumber}`);
              const techDigits = truckForAutoCall.techPhone.replace(/\D/g, "");
              const techToNumber = techDigits.startsWith("1") && techDigits.length === 11 ? `+${techDigits}` : `+1${techDigits}`;
              const apiKey = (process.env.FS_ELEVENLABS_API_KEY || "").trim();
              try {
                const techResponse = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
                  method: "POST",
                  headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    agent_id: "agent_9401kk2njc6veajaecs89wtbh840",
                    agent_phone_number_id: "phnum_0401khxk7pknfafb4nb08kzfdkr0",
                    to_number: techToNumber,
                    conversation_initiation_client_data: {
                      dynamic_variables: {
                        TECH_NAME: truckForAutoCall.techName || "",
                        VEHICLE_NUMBER: truckForAutoCall.truckNumber || "",
                        SHOP_NAME: (truckForAutoCall.repairAddress || "").split(",")[0].split(" - ").pop()?.trim() || "",
                        SHOP_ADDRESS: truckForAutoCall.repairAddress || "",
                        SHOP_PHONE: truckForAutoCall.repairPhone || "",
                        SCHEDULED_PICKUP_TIME: truckForAutoCall.timeBlockedToPickUpVan || "",
                      },
                    },
                  }),
                });
                if (techResponse.ok) {
                  const techResult = await techResponse.json();
                  const techConvId = techResult?.conversation_id || techResult?.conversationId || null;
                  await fleetScopeStorage.createCallLog({
                    truckId: callLog.truckId, truckNumber: callLog.truckNumber, batchId: callLog.batchId,
                    callType: "tech", phoneNumber: techToNumber, elevenLabsConversationId: techConvId, status: "in_progress",
                  });
                  await fleetScopeStorage.updateTruck(truckForAutoCall.id, {
                    lastTechCallDate: new Date(), lastTechCallConversationId: techConvId, lastTechCallSummary: null,
                  });
                  console.log(`[ElevenLabs Webhook] Auto-triggered tech call: ${techConvId}`);
                }
              } catch (autoErr: any) {
                console.error(`[ElevenLabs Webhook] Auto-trigger tech call failed:`, autoErr.message);
              }
            }
          }
          */
        }
      } catch (logErr: any) {
        console.warn(`[ElevenLabs Webhook] Could not update call_log:`, logErr.message);
      }

      res.status(200).json({ received: true, matched: true, summarized: true });
    } catch (error: any) {
      console.error("[ElevenLabs Webhook] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // GET actions for a specific truck
  app.get("/trucks/:id/actions", async (req, res) => {
    try {
      const actions = await fleetScopeStorage.getTruckActions(req.params.id);
      res.json(actions);
    } catch (error: any) {
      console.error("Error fetching actions:", error);
      res.status(500).json({ message: "Failed to fetch actions" });
    }
  });

  // POST create new truck
  app.post("/trucks", async (req, res) => {
    try {
      const validated = insertTruckSchema.parse(req.body);
      
      // Check for duplicate truck number before creating
      const existingTruck = await fleetScopeStorage.getTruckByNumber(validated.truckNumber);
      if (existingTruck) {
        return res.status(409).json({ 
          message: `Truck number ${validated.truckNumber} already exists in the system. Please use a different truck number or edit the existing truck.`,
          existingTruckId: existingTruck.id
        });
      }
      
      const truck = await fleetScopeStorage.createTruck(validated);
      
      // Log creation action
      await fleetScopeStorage.createAction({
        truckId: truck.id,
        actionBy: validated.lastUpdatedBy || "System",
        actionType: "Created",
        actionNote: `Truck ${truck.truckNumber} added to system with status: ${truck.status}`,
      });

      res.status(201).json(truck);
    } catch (error: any) {
      console.error("Error creating truck:", error);
      console.error("Error details:", error.message, error.code, error.detail);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: error.errors 
        });
      }
      // Check for database unique constraint violation
      if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        return res.status(409).json({ 
          message: `Truck number already exists. Please use a different truck number.`
        });
      }
      res.status(500).json({ message: "Failed to create truck", error: error.message || "Unknown error" });
    }
  });

  // Shared handler for PUT/PATCH update truck
  const updateTruckHandler = async (req: any, res: any) => {
    try {
      const existing = await fleetScopeStorage.getTruck(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const validated = updateTruckSchema.parse(req.body);
      
      // Auto-update registrationLastUpdate when registrationStickerValid changes
      if (validated.registrationStickerValid !== undefined && 
          validated.registrationStickerValid !== existing.registrationStickerValid) {
        // Format: YYYY-MM-DD HH:MM (24-hour format)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        validated.registrationLastUpdate = `${year}-${month}-${day} ${hours}:${minutes}`;
        
        // Auto-update subStatus to "Ordering duplicate tags" when registrationStickerValid changes to "Ordered duplicates"
        if (validated.registrationStickerValid === "Ordered duplicates") {
          // Only auto-update subStatus if not explicitly being set to something else in this request
          if (validated.subStatus === undefined) {
            validated.subStatus = "Ordering duplicate tags";
          }
        }
      }
      
      // Auto-update gaveHolmanUpdatedAt when gaveHolman changes
      if (validated.gaveHolman !== undefined && 
          validated.gaveHolman !== existing.gaveHolman) {
        validated.gaveHolmanUpdatedAt = new Date();
      }
      
      // Auto-update status to "On Road, Delivered to technician" when both vanPickedUp AND spareVanAssignmentInProcess are true
      const willHaveVanPickedUp = validated.vanPickedUp !== undefined ? validated.vanPickedUp : existing.vanPickedUp;
      const willHaveSpareVan = validated.spareVanAssignmentInProcess !== undefined ? validated.spareVanAssignmentInProcess : existing.spareVanAssignmentInProcess;
      
      if (willHaveVanPickedUp === true && willHaveSpareVan === true) {
        // Only auto-update if not already "On Road, Delivered to technician"
        if (existing.mainStatus !== "On Road" || existing.subStatus !== "Delivered to technician") {
          validated.mainStatus = "On Road";
          validated.subStatus = "Delivered to technician";
        }
      }
      
      // Track all field changes by comparing against existing data
      const changes = trackChanges(existing, validated);

      // If no changes, return success but don't update or log
      if (changes.length === 0) {
        return res.status(200).json({ 
          ...existing,
          noChanges: true,
        });
      }

      // Perform update only if there are changes
      const truck = await fleetScopeStorage.updateTruck(req.params.id, validated);

      // Log update action with detailed change notes
      await fleetScopeStorage.createAction({
        truckId: truck.id,
        actionBy: validated.lastUpdatedBy || "User",
        actionType: "Updated",
        actionNote: changes.join("; "),
      });

      const truckSwapTriggerFieldChanged = 
        validated.mainStatus !== undefined ||
        validated.repairCompleted !== undefined ||
        validated.pickUpSlotBooked !== undefined ||
        validated.timeBlockedToPickUpVan !== undefined;

      if (
        truckSwapTriggerFieldChanged &&
        truck.mainStatus === "Truck Swap" &&
        truck.repairCompleted === true &&
        truck.pickUpSlotBooked === true &&
        truck.timeBlockedToPickUpVan
      ) {
        const wasAlreadyMet =
          existing.mainStatus === "Truck Swap" &&
          existing.repairCompleted === true &&
          existing.pickUpSlotBooked === true &&
          existing.timeBlockedToPickUpVan;

        if (!wasAlreadyMet) {
          sendTruckSwapEmail(truck).catch(err => 
            console.error("Truck Swap email error:", err)
          );
        }
      }

      // Log assignment history entry for this truck edit
      try {
        const { vehicleAssignmentService } = await import("./vehicle-assignment-service");
        await vehicleAssignmentService.logTruckInfoUpdate(
          truck.truckNumber,
          validated.lastUpdatedBy || undefined,
          `Truck details edited in Fleet-Scope: ${changes.join("; ")}`
        );
      } catch (historyErr) {
        console.error("[FleetScope] Failed to log assignment history for truck edit:", historyErr);
      }

      res.json(truck);
    } catch (error: any) {
      console.error("Error updating truck:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to update truck" });
    }
  };

  // PUT update truck
  app.put("/trucks/:id", updateTruckHandler);
  
  // PATCH update truck (alias for PUT)
  app.patch("/trucks/:id", updateTruckHandler);

  app.post("/trucks/call-import", async (req, res) => {
    try {
      const { rows } = req.body;
      
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ 
          message: "Invalid request: rows array is required and must not be empty" 
        });
      }

      console.log(`[CALL IMPORT] Received ${rows.length} rows to import`);

      const results = {
        updated: 0,
        notFound: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const rawTruckNumber = typeof row.truckNumber === "string" ? row.truckNumber.trim() : String(row.truckNumber || "").trim();
          
          if (!rawTruckNumber) {
            results.errors.push(`Row ${i + 1}: Truck number is required`);
            continue;
          }

          const stripped = rawTruckNumber.replace(/^0+/, "") || rawTruckNumber;
          const existing = await fleetScopeStorage.getTruckByNumber(rawTruckNumber) || await fleetScopeStorage.getTruckByNumber(stripped);
          if (!existing) {
            results.notFound++;
            results.errors.push(`Row ${i + 1}: Truck ${rawTruckNumber} not found in dashboard`);
            continue;
          }

          const updates: Record<string, any> = {};
          if (row.callStatus !== undefined && row.callStatus !== null && row.callStatus !== "") {
            updates.callStatus = String(row.callStatus).substring(0, 50);
          }
          if (row.eta !== undefined && row.eta !== null && row.eta !== "") {
            updates.eta = String(row.eta);
          }
          if (row.lastDateCalled !== undefined && row.lastDateCalled !== null && row.lastDateCalled !== "") {
            updates.lastDateCalled = String(row.lastDateCalled);
          }

          if (Object.keys(updates).length > 0) {
            await fleetScopeStorage.updateTruck(existing.id, updates);
            results.updated++;
          }
        } catch (rowErr: any) {
          results.errors.push(`Row ${i + 1}: ${rowErr.message}`);
        }
      }

      console.log(`[CALL IMPORT] Complete: ${results.updated} updated, ${results.notFound} not found, ${results.errors.length} errors`);
      res.json(results);
    } catch (error: any) {
      console.error("[CALL IMPORT] Error:", error);
      res.status(500).json({ message: error.message || "Call import failed" });
    }
  });

  // POST bulk import trucks from CSV
  app.post("/trucks/bulk-import", async (req, res) => {
    try {
      const { trucks } = req.body;
      
      if (!Array.isArray(trucks) || trucks.length === 0) {
        return res.status(400).json({ 
          message: "Invalid request: trucks array is required and must not be empty" 
        });
      }

      console.log(`[BULK IMPORT] Received ${trucks.length} trucks to import`);

      const results = {
        imported: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < trucks.length; i++) {
        try {
          const truckData = trucks[i];
          
          const trimmedTruckNumber = typeof truckData.truckNumber === "string" 
            ? truckData.truckNumber.trim() 
            : truckData.truckNumber;
          const trimmedDate = typeof truckData.datePutInRepair === "string"
            ? truckData.datePutInRepair.trim()
            : truckData.datePutInRepair;
          
          console.log(`[BULK IMPORT] Row ${i + 1}: truckNumber="${truckData.truckNumber}" (trimmed="${trimmedTruckNumber}"), date="${truckData.datePutInRepair}" (trimmed="${trimmedDate}")`);
          
          if (!trimmedTruckNumber) {
            console.log(`[BULK IMPORT] Row ${i + 1}: REJECTED - missing truck number`);
            results.errors.push(`Row ${i + 1}: Truck number is required`);
            continue;
          }
          
          if (!trimmedDate) {
            console.log(`[BULK IMPORT] Row ${i + 1}: REJECTED - missing date`);
            results.errors.push(`Row ${i + 1}: Date put in repair is required`);
            continue;
          }

          // Handle status: if mainStatus is provided use it, otherwise parse from legacy status field
          let parsedMain = truckData.mainStatus;
          let parsedSub = truckData.subStatus || null;
          
          if (!parsedMain && truckData.status) {
            // Parse legacy combined status into mainStatus + subStatus
            const parsed = parseStatus(truckData.status);
            parsedMain = parsed.mainStatus;
            parsedSub = parsed.subStatus;
          }
          
          // For CSV import with legacy data, use lenient normalization
          // For direct mainStatus/subStatus fields, use strict validation
          let mainStatus: string;
          let subStatus: string | null;
          
          if (truckData.mainStatus) {
            // Strict validation when mainStatus is explicitly provided
            try {
              const validated = validateStatus(parsedMain, parsedSub);
              mainStatus = validated.mainStatus;
              subStatus = validated.subStatus;
            } catch (err: any) {
              results.errors.push(`Row ${i + 1}: ${err.message}`);
              continue;
            }
          } else {
            // Legacy status parsing - use lenient normalization
            const normalized = normalizeStatusLegacy(parsedMain, parsedSub);
            mainStatus = normalized.mainStatus;
            subStatus = normalized.subStatus;
          }

          const sanitizedData = {
            ...truckData,
            truckNumber: trimmedTruckNumber,
            datePutInRepair: trimmedDate,
            mainStatus,
            subStatus,
          };
          
          // Remove legacy status field from data
          delete ((sanitizedData as Record<string, unknown>)).status;

          const validated = insertTruckSchema.parse(sanitizedData);
          const truck = await fleetScopeStorage.createTruck(validated);
          
          await fleetScopeStorage.createAction({
            truckId: truck.id,
            actionBy: validated.lastUpdatedBy || "CSV Import",
            actionType: "Imported",
            actionNote: `Bulk import from CSV - Truck ${truck.truckNumber}`,
          });

          console.log(`[BULK IMPORT] Row ${i + 1}: SUCCESS - imported truck ${truck.truckNumber}`);
          results.imported++;
        } catch (error: any) {
          if (error instanceof z.ZodError) {
            const errorMsg = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(", ");
            results.errors.push(`Row ${i + 1} (${trucks[i].truckNumber || 'unknown'}): ${errorMsg}`);
          } else if (error.code === "23505") {
            results.errors.push(`Row ${i + 1}: Truck ${trucks[i].truckNumber} already exists`);
          } else {
            results.errors.push(`Row ${i + 1}: ${error.message || 'Unknown error'}`);
          }
        }
      }

      res.status(201).json(results);
    } catch (error: any) {
      console.error("Error in bulk import:", error);
      res.status(500).json({ message: "Failed to process bulk import" });
    }
  });

  // POST bulk sync trucks - remove non-matching, add missing with default status
  app.post("/trucks/bulk-sync", async (req, res) => {
    try {
      const { truckNumbers, syncedBy } = req.body;
      
      if (!Array.isArray(truckNumbers) || truckNumbers.length === 0) {
        return res.status(400).json({ 
          message: "Invalid request: truckNumbers array is required and must not be empty" 
        });
      }

      console.log(`[BULK SYNC] Received ${truckNumbers.length} truck numbers to sync`);

      const result = await fleetScopeStorage.bulkSyncTrucks(truckNumbers, syncedBy);

      console.log(`[BULK SYNC] Complete - Added: ${result.added}, Removed: ${result.removed}, Kept: ${result.kept}`);

      res.json({
        success: true,
        added: result.added,
        removed: result.removed,
        kept: result.kept,
        message: `Sync complete: ${result.added} added, ${result.removed} removed, ${result.kept} kept`
      });
    } catch (error: any) {
      console.error("Error in bulk sync:", error);
      res.status(500).json({ message: "Failed to process bulk sync" });
    }
  });

  // POST consolidate trucks - compare pasted list with dashboard and sync
  app.post("/trucks/consolidate", async (req, res) => {
    try {
      const { entries, consolidatedBy } = req.body;
      
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ 
          message: "Invalid request: entries array is required and must not be empty" 
        });
      }

      // Validate entries format
      const validatedEntries = entries.map((entry: any) => ({
        truckNumber: String(entry.truckNumber || '').trim(),
        dateInRepair: entry.dateInRepair ? String(entry.dateInRepair).trim() : undefined,
      })).filter(e => e.truckNumber);

      if (validatedEntries.length === 0) {
        return res.status(400).json({ 
          message: "No valid truck numbers found in the submitted data" 
        });
      }

      console.log(`[CONSOLIDATE] Received ${validatedEntries.length} trucks to consolidate`);

      const result = await fleetScopeStorage.consolidateTrucks(validatedEntries, consolidatedBy || 'System');

      console.log(`[CONSOLIDATE] Complete - Added: ${result.added.length}, Removed: ${result.removed.length}, Updated: ${result.updated}, Unchanged: ${result.unchanged}`);

      res.json({
        success: true,
        added: result.added,
        removed: result.removed,
        addedCount: result.added.length,
        removedCount: result.removed.length,
        updatedCount: result.updated,
        unchangedCount: result.unchanged,
        consolidationId: result.consolidationId,
        message: `Consolidation complete: ${result.added.length} added, ${result.removed.length} removed, ${result.updated} updated`
      });
    } catch (error: any) {
      console.error("Error in truck consolidation:", error);
      res.status(500).json({ message: "Failed to process truck consolidation" });
    }
  });

  // POST update registration expiry dates for matching trucks
  app.post("/trucks/update-reg-expiry", async (req, res) => {
    try {
      const { entries } = req.body;
      
      if (!entries || !Array.isArray(entries)) {
        return res.status(400).json({ message: "Entries array is required" });
      }
      
      // Get all trucks to match against
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const truckMap = new Map<string, number>();
      allTrucks.forEach(truck => {
        truckMap.set(truck.truckNumber.toUpperCase().replace(/\s+/g, ''), truck.id);
      });
      
      let updatedCount = 0;
      let notFoundCount = 0;
      const notFound: string[] = [];
      
      for (const entry of entries) {
        const truckNum = entry.truckNumber?.toString().toUpperCase().replace(/\s+/g, '') || '';
        const regExpiry = entry.renewalDate || '';
        
        if (!truckNum || !regExpiry) continue;
        
        const truckId = truckMap.get(truckNum);
        if (truckId) {
          await fleetScopeStorage.updateTruck(truckId, { holmanRegExpiry: regExpiry });
          updatedCount++;
        } else {
          notFoundCount++;
          if (notFound.length < 20) {
            notFound.push(truckNum);
          }
        }
      }
      
      console.log(`[REG-EXPIRY] Updated ${updatedCount} trucks, ${notFoundCount} not found in dashboard`);
      
      res.json({
        success: true,
        updatedCount,
        notFoundCount,
        notFoundSample: notFound,
        message: `Updated registration expiry for ${updatedCount} trucks`
      });
    } catch (error: any) {
      console.error("Error updating registration expiry:", error);
      res.status(500).json({ message: "Failed to update registration expiry dates" });
    }
  });

  // POST update bill paid dates for matching trucks
  app.post("/trucks/update-bill-paid", async (req, res) => {
    try {
      const { entries } = req.body;
      
      if (!entries || !Array.isArray(entries)) {
        return res.status(400).json({ message: "Entries array is required" });
      }
      
      // Get all trucks to match against
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const truckMap = new Map<string, number>();
      allTrucks.forEach(truck => {
        // Normalize: remove leading zeros and whitespace
        const normalized = truck.truckNumber.replace(/^0+/, '').toUpperCase().replace(/\s+/g, '');
        truckMap.set(normalized, truck.id);
      });
      
      // Group by vehicle number and find latest date for each
      const latestDates = new Map<string, Date>();
      
      for (const entry of entries) {
        const vehicleNo = entry.vehicleNo?.toString().replace(/^0+/, '').toUpperCase().replace(/\s+/g, '') || '';
        const dateStr = entry.billPaidDate || '';
        
        if (!vehicleNo || !dateStr) continue;
        
        // Parse date: "10-24-2025 22:10:12" format (MM-DD-YYYY HH:MM:SS)
        const dateParts = dateStr.split(' ')[0]; // Get just the date part
        const [month, day, year] = dateParts.split('-').map(Number);
        const entryDate = new Date(year, month - 1, day);
        
        if (isNaN(entryDate.getTime())) continue;
        
        const existing = latestDates.get(vehicleNo);
        if (!existing || entryDate > existing) {
          latestDates.set(vehicleNo, entryDate);
        }
      }
      
      let updatedCount = 0;
      let notFoundCount = 0;
      const notFound: string[] = [];
      
      for (const [vehicleNo, latestDate] of latestDates) {
        const truckId = truckMap.get(vehicleNo);
        if (truckId) {
          // Format date as MM/DD/YYYY for display
          const formattedDate = `${latestDate.getMonth() + 1}/${latestDate.getDate()}/${latestDate.getFullYear()}`;
          await fleetScopeStorage.updateTruck(truckId, { billPaidDate: formattedDate });
          updatedCount++;
        } else {
          notFoundCount++;
          if (notFound.length < 20) {
            notFound.push(vehicleNo);
          }
        }
      }
      
      console.log(`[BILL-PAID] Updated ${updatedCount} trucks, ${notFoundCount} not found in dashboard`);
      
      res.json({
        success: true,
        updatedCount,
        notFoundCount,
        uniqueVehicles: latestDates.size,
        totalEntries: entries.length,
        notFoundSample: notFound,
        message: `Updated bill paid date for ${updatedCount} trucks`
      });
    } catch (error: any) {
      console.error("Error updating bill paid dates:", error);
      res.status(500).json({ message: "Failed to update bill paid dates" });
    }
  });

  // GET consolidation history
  app.get("/truck-consolidations", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const consolidations = await fleetScopeStorage.getTruckConsolidations(limit);
      res.json(consolidations);
    } catch (error: any) {
      console.error("Error fetching consolidation history:", error);
      res.status(500).json({ message: "Failed to fetch consolidation history" });
    }
  });

  // POST import CSV data (seed initial 5 rows) - Uses parseStatus for legacy status parsing
  app.post("/csv-import", async (req, res) => {
    try {
      const seedData = [
        {
          truckNumber: "46249",
          status: "Research required",
          datePutInRepair: "5/19/2025",
          repairAddress: "No tech assigned to truck / research location",
          repairPhone: "",
          contactName: "",
          virtualComments: "",
          lastUpdatedBy: "CSV Import",
        },
        {
          truckNumber: "61460",
          status: "Location confirmed – needs tag",
          datePutInRepair: "6/9/2025",
          repairAddress: "LEXINGTON PARK FORD, 22659 THREE NOTCH RD, CAL...",
          repairPhone: "",
          contactName: "",
          virtualComments: "",
          lastUpdatedBy: "CSV Import",
        },
        {
          truckNumber: "23456",
          status: "Location confirmed – waiting on repair completion",
          datePutInRepair: "6/11/2025",
          repairAddress: "AAMCO TOTAL CAR CARE 1047 BRAGG BLVD FAYETTEVI...",
          repairPhone: "",
          contactName: "",
          virtualComments: "",
          lastUpdatedBy: "CSV Import",
        },
        {
          truckNumber: "22101",
          status: "Location confirmed – needs tag",
          datePutInRepair: "6/13/2025",
          repairAddress: "MR TIRE, 1317 W PATRICK ST, FREDERICK MD 21702",
          repairPhone: "",
          contactName: "",
          virtualComments: "",
          lastUpdatedBy: "CSV Import",
        },
        {
          truckNumber: "46961",
          status: "Research required",
          datePutInRepair: "6/18/2025",
          repairAddress: "",
          repairPhone: "",
          contactName: "",
          virtualComments: "",
          lastUpdatedBy: "CSV Import",
        },
      ];

      const importedTrucks = [];
      for (const data of seedData) {
        // Parse legacy combined status into mainStatus + subStatus
        const parsed = parseStatus(data.status);
        
        // Create validated truck data
        const truckData = {
          ...data,
          mainStatus: parsed.mainStatus,
          subStatus: parsed.subStatus,
        };
        
        // Remove legacy status field and validate
        const { status, ...rest } = truckData;
        const validated = insertTruckSchema.parse(rest);
        
        const truck = await fleetScopeStorage.createTruck(validated);
        await fleetScopeStorage.createAction({
          truckId: truck.id,
          actionBy: "CSV Import",
          actionType: "Imported",
          actionNote: `Initial data import from spreadsheet`,
        });
        importedTrucks.push(truck);
      }

      res.status(201).json({ 
        message: `Successfully imported ${importedTrucks.length} trucks`,
        trucks: importedTrucks 
      });
    } catch (error: any) {
      console.error("Error importing CSV data:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: error.errors 
        });
      }
      res.status(500).json({ message: "Failed to import CSV data" });
    }
  });

  // Snowflake API routes
  app.get("/snowflake/test", async (_req, res) => {
    try {
      const success = await testConnection();
      if (success) {
        res.json({ success: true, message: "Successfully connected to Snowflake" });
      } else {
        res.status(500).json({ success: false, message: "Failed to connect to Snowflake" });
      }
    } catch (error: any) {
      console.error("Snowflake connection test error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/snowflake/schema", async (_req, res) => {
    try {
      const schema = await getTableSchema();
      res.json({ schema });
    } catch (error: any) {
      console.error("Error fetching Snowflake schema:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/snowflake/data", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const data = await getTableData(undefined, limit);
      res.json({ data, count: data.length });
    } catch (error: any) {
      console.error("Error fetching Snowflake data:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/snowflake/query", async (req, res) => {
    try {
      const { sql } = req.body;
      if (!sql) {
        return res.status(400).json({ message: "SQL query is required" });
      }
      const data = await executeQuery(sql);
      res.json({ data, count: data.length });
    } catch (error: any) {
      console.error("Error executing Snowflake query:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync tech data from Snowflake TPMS_EXTRACT
  // Refreshes ALL trucks with latest tech name and phone from Snowflake (overwrites existing values)
  app.post("/snowflake/sync-tech-data", async (req, res) => {
    try {
      // Get all trucks from our database
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      if (allTrucks.length === 0) {
        return res.json({ 
          message: "No trucks to update", 
          updated: 0,
          details: [] 
        });
      }
      
      // Get all truck numbers
      const truckNumbers = allTrucks.map(t => t.truckNumber);
      
      // Build query for Snowflake using TRUCK_LU column (matches our 5-digit format)
      const snowflakeTruckNumbers = truckNumbers.map(num => `'${num}'`);
      
      // First query: Get all records for manager phone lookup
      const allRecordsQuery = `
        SELECT ENTERPRISE_ID, MOBILEPHONENUMBER 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE ENTERPRISE_ID IS NOT NULL AND MOBILEPHONENUMBER IS NOT NULL
      `;
      
      const allRecordsData = await executeQuery<{
        ENTERPRISE_ID: string | number;
        MOBILEPHONENUMBER: number | string;
      }>(allRecordsQuery);
      
      // Build ENTERPRISE_ID -> phone lookup for manager phone
      const enterpriseIdToPhone = new Map<string, string>();
      for (const row of allRecordsData) {
        if (row.ENTERPRISE_ID) {
          enterpriseIdToPhone.set(String(row.ENTERPRISE_ID).trim(), String(row.MOBILEPHONENUMBER));
        }
      }
      
      const snowflakeQuery = `
        SELECT TRUCK_LU, FULL_NAME, MOBILEPHONENUMBER, MANAGER_NAME, MANAGER_ENT_ID 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const snowflakeData = await executeQuery<{
        TRUCK_LU: string;
        FULL_NAME: string;
        MOBILEPHONENUMBER: number | null;
        MANAGER_NAME: string | null;
        MANAGER_ENT_ID: string | number | null;
      }>(snowflakeQuery);
      
      // Create lookup map from Snowflake data using TRUCK_LU (already matches our format)
      const snowflakeLookup = new Map<string, { fullName: string; phone: string | null; managerName: string | null; managerPhone: string | null }>();
      for (const row of snowflakeData) {
        // Look up manager phone using MANAGER_ENT_ID
        let managerPhone: string | null = null;
        if (row.MANAGER_ENT_ID) {
          const managerEntId = String(row.MANAGER_ENT_ID).trim();
          managerPhone = enterpriseIdToPhone.get(managerEntId) || null;
        }
        
        snowflakeLookup.set(row.TRUCK_LU, {
          fullName: row.FULL_NAME,
          phone: row.MOBILEPHONENUMBER ? String(row.MOBILEPHONENUMBER) : null,
          managerName: row.MANAGER_NAME || null,
          managerPhone
        });
      }
      
      // Update trucks with Snowflake data (tech info + assignment status)
      const updateResults: Array<{
        truckNumber: string;
        techNameUpdated: boolean;
        techPhoneUpdated: boolean;
        oldTechName: string | null;
        oldTechPhone: string | null;
        newTechName: string | null;
        newTechPhone: string | null;
      }> = [];
      let assignedStatusUpdated = 0;
      
      for (const truck of allTrucks) {
        // Look up using truck number directly (TRUCK_LU matches our format)
        const snowflakeRecord = snowflakeLookup.get(truck.truckNumber);
        const isAssigned = !!snowflakeRecord;
        
        const updates: Partial<{ techName: string; techPhone: string; techLeadName: string; techLeadPhone: string; snowflakeAssigned: boolean }> = {};
        let techNameUpdated = false;
        let techPhoneUpdated = false;
        let techLeadNameUpdated = false;
        let techLeadPhoneUpdated = false;
        const oldTechName = truck.techName || null;
        const oldTechPhone = truck.techPhone || null;
        
        if (truck.snowflakeAssigned !== isAssigned) {
          updates.snowflakeAssigned = isAssigned;
          assignedStatusUpdated++;
        }
        
        if (!snowflakeRecord) {
          if (Object.keys(updates).length > 0) {
            await fleetScopeStorage.updateTruck(truck.id, updates);
          }
          continue;
        }
        
        // Update tech_name if different from Snowflake
        if (snowflakeRecord.fullName && truck.techName !== snowflakeRecord.fullName) {
          updates.techName = snowflakeRecord.fullName;
          techNameUpdated = true;
        }
        
        // Update tech_phone if different from Snowflake
        if (snowflakeRecord.phone && truck.techPhone !== snowflakeRecord.phone) {
          updates.techPhone = snowflakeRecord.phone;
          techPhoneUpdated = true;
        }
        
        // Update tech_lead_name if different from Snowflake
        if (snowflakeRecord.managerName && truck.techLeadName !== snowflakeRecord.managerName) {
          updates.techLeadName = snowflakeRecord.managerName;
          techLeadNameUpdated = true;
        }
        
        // Update tech_lead_phone if different from Snowflake
        if (snowflakeRecord.managerPhone && truck.techLeadPhone !== snowflakeRecord.managerPhone) {
          updates.techLeadPhone = snowflakeRecord.managerPhone;
          techLeadPhoneUpdated = true;
        }
        
        if (Object.keys(updates).length > 0) {
          await fleetScopeStorage.updateTruck(truck.id, updates);
          
          const changeDetails: string[] = [];
          if (techNameUpdated) {
            changeDetails.push(`Tech Name: "${oldTechName || '(blank)'}" → "${updates.techName}"`);
          }
          if (techPhoneUpdated) {
            changeDetails.push(`Tech Phone: "${oldTechPhone || '(blank)'}" → "${updates.techPhone}"`);
          }
          if (techLeadNameUpdated) {
            changeDetails.push(`Tech Lead Name: → "${updates.techLeadName}"`);
          }
          if (techLeadPhoneUpdated) {
            changeDetails.push(`Tech Lead Phone: → "${updates.techLeadPhone}"`);
          }
          
          if (changeDetails.length > 0) {
            await fleetScopeStorage.createAction({
              truckId: truck.id,
              actionBy: "Snowflake Sync",
              actionType: "Updated",
              actionNote: `Auto-synced from Snowflake TPMS_EXTRACT: ${changeDetails.join(', ')}`,
            });
          }
          
          if (techNameUpdated || techPhoneUpdated) {
            updateResults.push({
              truckNumber: truck.truckNumber,
              techNameUpdated,
              techPhoneUpdated,
              oldTechName,
              oldTechPhone,
              newTechName: updates.techName || null,
              newTechPhone: updates.techPhone || null,
            });
          }
        }
      }
      
      res.json({
        message: `Successfully synced ${updateResults.length} trucks from Snowflake, ${assignedStatusUpdated} assignment status updates`,
        updated: updateResults.length,
        assignedStatusUpdated,
        trucksChecked: allTrucks.length,
        snowflakeRecordsFound: snowflakeData.length,
        details: updateResults
      });
    } catch (error: any) {
      console.error("Error syncing tech data from Snowflake:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync Snowflake assigned status (Y/N) for all trucks
  // Checks which trucks exist in TPMS_EXTRACT and updates snowflakeAssigned field
  app.post("/snowflake/sync-assigned-status", async (req, res) => {
    try {
      // Get all trucks from our database
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      if (allTrucks.length === 0) {
        return res.json({ 
          message: "No trucks to check", 
          updated: 0,
          details: [] 
        });
      }
      
      // Get all truck numbers
      const truckNumbers = allTrucks.map(t => t.truckNumber);
      
      // Query Snowflake for all TRUCK_LU values
      const snowflakeTruckNumbers = truckNumbers.map(num => `'${num}'`);
      
      const snowflakeQuery = `
        SELECT DISTINCT TRUCK_LU 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const snowflakeData = await executeQuery<{
        TRUCK_LU: string;
      }>(snowflakeQuery);
      
      // Create set of truck numbers found in Snowflake
      const snowflakeTruckSet = new Set(snowflakeData.map(row => row.TRUCK_LU));
      
      // Update each truck's assigned status
      let updatedCount = 0;
      const updateDetails: Array<{ truckNumber: string; assigned: boolean }> = [];
      
      for (const truck of allTrucks) {
        const isAssigned = snowflakeTruckSet.has(truck.truckNumber);
        
        // Only update if the value is different
        if (truck.snowflakeAssigned !== isAssigned) {
          await fleetScopeStorage.updateTruck(truck.id, { snowflakeAssigned: isAssigned });
          updatedCount++;
          updateDetails.push({ truckNumber: truck.truckNumber, assigned: isAssigned });
        }
      }
      
      res.json({
        message: `Checked ${allTrucks.length} trucks, found ${snowflakeData.length} in Snowflake, updated ${updatedCount} records`,
        totalTrucks: allTrucks.length,
        foundInSnowflake: snowflakeData.length,
        updated: updatedCount,
        details: updateDetails.slice(0, 50) // Limit details to first 50
      });
    } catch (error: any) {
      console.error("Error syncing assigned status from Snowflake:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync tech state from Snowflake TPMS_EXTRACT PRIMARY_STATE column with AMS fallback
  app.post("/snowflake/sync-tech-state", async (req, res) => {
    try {
      // Get all trucks from our database
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      if (allTrucks.length === 0) {
        return res.json({ 
          message: "No trucks to check", 
          updated: 0,
          details: [] 
        });
      }
      
      // Get all truck numbers
      const truckNumbers = allTrucks.map(t => t.truckNumber);
      const snowflakeTruckNumbers = truckNumbers.map(num => `'${num}'`);
      
      // Query Snowflake for PRIMARYSTATE from TPMS_EXTRACT
      const tpmsQuery = `
        SELECT TRUCK_LU, PRIMARYSTATE 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const tpmsData = await executeQuery<{
        TRUCK_LU: string;
        PRIMARYSTATE: string | null;
      }>(tpmsQuery);
      
      // Create lookup map from TPMS data
      const tpmsStateLookup = new Map<string, string | null>();
      for (const row of tpmsData) {
        tpmsStateLookup.set(row.TRUCK_LU, row.PRIMARYSTATE);
      }
      
      // Query REPLIT_ALL_VEHICLES for AMS_CUR_STATE as fallback for trucks not in TPMS
      // Note: VEHICLE_NUMBER may have leading zeros, so we fetch all and normalize
      const amsQuery = `
        SELECT VEHICLE_NUMBER, AMS_CUR_STATE 
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES 
        WHERE AMS_CUR_STATE IS NOT NULL
          AND AMS_CUR_STATE != ''
      `;
      
      const amsData = await executeQuery<{
        VEHICLE_NUMBER: string;
        AMS_CUR_STATE: string | null;
      }>(amsQuery);
      
      // Create lookup map from AMS data, normalizing vehicle numbers
      const amsStateLookup = new Map<string, string | null>();
      for (const row of amsData) {
        if (row.VEHICLE_NUMBER) {
          // Remove non-digits and leading zeros to match our truck number format
          const digits = row.VEHICLE_NUMBER.replace(/\D/g, '');
          const normalizedNum = digits.replace(/^0+/, '') || '0';
          amsStateLookup.set(normalizedNum, row.AMS_CUR_STATE);
        }
      }
      
      // Query AMS_XLS_EXPORTS for STATE parsed from CURRENT_ADDRESS as third-tier fallback
      // Get latest record per VEHICLE using FILE_DATE, parse state from 3rd comma-separated value
      const xlsQuery = `
        WITH latest_records AS (
          SELECT 
            VEHICLE,
            CURRENT_ADDRESS,
            TRIM(SPLIT_PART(CURRENT_ADDRESS, ',', 3)) AS PARSED_STATE,
            ROW_NUMBER() OVER (PARTITION BY VEHICLE ORDER BY FILE_DATE DESC) as rn
          FROM PARTS_SUPPLYCHAIN.FLEET.AMS_XLS_EXPORTS 
          WHERE CURRENT_ADDRESS IS NOT NULL
            AND CURRENT_ADDRESS != ''
            AND CURRENT_ADDRESS NOT LIKE ', , ,%'
        )
        SELECT VEHICLE, CURRENT_ADDRESS, PARSED_STATE
        FROM latest_records
        WHERE rn = 1
          AND PARSED_STATE IS NOT NULL
          AND LENGTH(TRIM(PARSED_STATE)) = 2
      `;
      
      const xlsData = await executeQuery<{
        VEHICLE: string;
        CURRENT_ADDRESS: string;
        PARSED_STATE: string | null;
      }>(xlsQuery);
      
      // Valid US state abbreviations
      const validStates = new Set([
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
      ]);
      
      // Create lookup map from AMS_XLS_EXPORTS data, normalizing vehicle numbers
      const xlsStateLookup = new Map<string, string | null>();
      for (const row of xlsData) {
        if (row.VEHICLE && row.PARSED_STATE) {
          const state = row.PARSED_STATE.toUpperCase().trim();
          // Only use valid US state abbreviations
          if (validStates.has(state)) {
            const digits = row.VEHICLE.replace(/\D/g, '');
            const normalizedNum = digits.replace(/^0+/, '') || '0';
            xlsStateLookup.set(normalizedNum, state);
          }
        }
      }
      
      // Update each truck's state with TPMS first, then AMS, then AMS_XLS_EXPORTS fallback
      let updatedCount = 0;
      let tpmsCount = 0;
      let amsCount = 0;
      let xlsCount = 0;
      const updateDetails: Array<{ truckNumber: string; state: string | null; source: string }> = [];
      
      for (const truck of allTrucks) {
        let state: string | null = null;
        let source: string | null = null;
        
        // Normalize truck number for AMS lookup
        const truckDigits = truck.truckNumber.replace(/\D/g, '');
        const normalizedTruckNum = truckDigits.replace(/^0+/, '') || '0';
        
        // First try TPMS_EXTRACT - only use if state is non-empty
        const tpmsState = tpmsStateLookup.get(truck.truckNumber);
        if (tpmsState && tpmsState.trim() !== '') {
          state = tpmsState;
          source = "TPMS";
        }
        // Fallback to AMS if no TPMS state or TPMS state is empty
        else if (amsStateLookup.has(normalizedTruckNum)) {
          const amsState = amsStateLookup.get(normalizedTruckNum);
          if (amsState && amsState.trim() !== '') {
            state = amsState;
            source = "AMS";
          }
        }
        // Third fallback to AMS_XLS_EXPORTS
        if (!state && xlsStateLookup.has(normalizedTruckNum)) {
          const xlsState = xlsStateLookup.get(normalizedTruckNum);
          if (xlsState && xlsState.trim() !== '') {
            state = xlsState;
            source = "XLS";
          }
        }
        
        // Only update if we found a state and it's different
        if (state && source) {
          const stateChanged = truck.techState !== state;
          const sourceChanged = truck.techStateSource !== source;
          
          if (stateChanged || sourceChanged) {
            await fleetScopeStorage.updateTruck(truck.id, { 
              techState: state,
              techStateSource: source 
            });
            updatedCount++;
            if (source === "TPMS") tpmsCount++;
            if (source === "AMS") amsCount++;
            if (source === "XLS") xlsCount++;
            updateDetails.push({ truckNumber: truck.truckNumber, state, source });
          }
        }
      }
      
      res.json({
        message: `Synced tech state for ${updatedCount} trucks (${tpmsCount} from TPMS, ${amsCount} from AMS, ${xlsCount} from XLS)`,
        totalTrucks: allTrucks.length,
        foundInTpms: tpmsData.length,
        foundInAms: amsData.length,
        foundInXls: xlsData.length,
        updated: updatedCount,
        tpmsUpdates: tpmsCount,
        amsUpdates: amsCount,
        xlsUpdates: xlsCount,
        details: updateDetails.slice(0, 50)
      });
    } catch (error: any) {
      console.error("Error syncing tech state from Snowflake:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================
  // SPARE VEHICLES ROUTES
  // =====================

  // Get unassigned vehicles from Snowflake
  app.get("/snowflake/unassigned-vehicles", async (req, res) => {
    try {
      const sql = `
        SELECT * 
        FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
        ORDER BY TRUCK_LU
      `;
      const data = await executeQuery(sql);
      res.json({ data, count: data.length });
    } catch (error: any) {
      console.error("Error fetching unassigned vehicles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get spare vehicle assignment statuses from Snowflake
  app.get("/snowflake/spare-assignment-status", async (req, res) => {
    try {
      const sql = `
        SELECT * 
        FROM PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS
        ORDER BY UPDATED_AT DESC
      `;
      const data = await executeQuery(sql);
      res.json({ data, count: data.length });
    } catch (error: any) {
      console.error("Error fetching spare assignment status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get combined spare vehicles data (unassigned vehicles with their latest status)
  app.get("/spares", async (req, res) => {
    try {
      // Query that joins unassigned vehicles with their latest assignment status
      const sql = `
        WITH LatestStatus AS (
          SELECT 
            VEHICLE_NUMBER,
            ASSIGNMENT_STATUS,
            UPDATED_AT,
            UPDATED_BY,
            ROW_NUMBER() OVER (PARTITION BY VEHICLE_NUMBER ORDER BY UPDATED_AT DESC) as rn
          FROM PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS
        )
        SELECT 
          uv.VEHICLE_NUMBER,
          uv.VIN,
          uv.MAKE_NAME,
          uv.MODEL_NAME,
          uv.TRUCK_DISTRICT,
          uv.TRUCK_STATUS,
          uv.AMS_CUR_ADDRESS,
          uv.AMS_CUR_CITY,
          uv.AMS_CUR_STATE,
          uv.AMS_CUR_ZIP,
          ls.ASSIGNMENT_STATUS,
          ls.UPDATED_AT as STATUS_UPDATED_AT,
          ls.UPDATED_BY as STATUS_UPDATED_BY
        FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES uv
        LEFT JOIN LatestStatus ls ON uv.VEHICLE_NUMBER = ls.VEHICLE_NUMBER AND ls.rn = 1
        ORDER BY uv.VEHICLE_NUMBER
      `;
      const data = await executeQuery(sql);
      
      // Get unique statuses for filtering
      const statuses = Array.from(new Set(data.map((row: any) => row.ASSIGNMENT_STATUS).filter(Boolean)));
      
      // Count by status
      const statusCounts: Record<string, number> = {};
      for (const row of data) {
        const status = (row as Record<string, unknown>).ASSIGNMENT_STATUS || 'No Status';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
      
      // Count unique vehicles with known locations directly from SPARE_VEHICLE_ASSIGNMENT_STATUS table
      // Get the latest status for each unique vehicle and count those NOT "unknown location - not found"
      const knownLocationsSql = `
        WITH LatestStatus AS (
          SELECT 
            VEHICLE_NUMBER,
            ASSIGNMENT_STATUS,
            ROW_NUMBER() OVER (PARTITION BY VEHICLE_NUMBER ORDER BY UPDATED_AT DESC) as rn
          FROM PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS
        )
        SELECT COUNT(*) as count
        FROM LatestStatus
        WHERE rn = 1 
          AND ASSIGNMENT_STATUS IS NOT NULL 
          AND LOWER(ASSIGNMENT_STATUS) NOT LIKE '%unknown location%'
      `;
      const knownLocationsResult = await executeQuery<Record<string, any>>(knownLocationsSql);
      const knownLocationsCount = knownLocationsResult[0]?.COUNT || knownLocationsResult[0]?.count || 0;
      
      // Fetch local editable details for all vehicles
      const vehicleNumbers = data.map((row: any) => row.VEHICLE_NUMBER).filter(Boolean);
      const localDetails = await fleetScopeStorage.getSpareVehicleDetails(vehicleNumbers);
      
      // Create a map for quick lookup
      const detailsMap: Record<string, any> = {};
      for (const detail of localDetails) {
        detailsMap[detail.vehicleNumber] = detail;
      }
      
      // Merge local details with Snowflake data
      const mergedData = data.map((row: any) => ({
        ...row,
        localDetails: detailsMap[row.VEHICLE_NUMBER] || null
      }));
      
      res.json({ 
        data: mergedData, 
        count: data.length,
        statuses,
        statusCounts,
        knownLocationsCount
      });
    } catch (error: any) {
      console.error("Error fetching spare vehicles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get spare vehicle details for a single vehicle
  app.get("/spares/:vehicleNumber/details", async (req, res) => {
    try {
      const { vehicleNumber } = req.params;
      const detail = await fleetScopeStorage.getSpareVehicleDetail(vehicleNumber);
      res.json(detail || null);
    } catch (error: any) {
      console.error("Error fetching spare vehicle details:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get unassigned vehicles with location data for Spares page
  app.get("/spares/locations", async (req, res) => {
    try {
      console.log("[Spares Locations] Fetching unassigned vehicles with location data...");
      
      // 0. Daily cleanup: Remove manually-added trucks that are now assigned in TPMS_EXTRACT
      const now = new Date();
      const shouldRunCleanup = !lastManualTruckCleanup || 
        (now.getTime() - lastManualTruckCleanup.getTime()) > CLEANUP_INTERVAL_MS;
      
      if (shouldRunCleanup) {
        try {
          console.log("[Spares Cleanup] Running daily cleanup of manually-added trucks...");
          
          // Get all manually-added trucks from PostgreSQL
          const manualTrucks = await getDb().select().from(spareVehicleDetails);
          
          if (manualTrucks.length > 0) {
            // Query TPMS_EXTRACT for assigned trucks (TRUCK_LU column)
            // A truck in TPMS_EXTRACT means it has a technician assigned to it
            const tpmsSql = `
              SELECT DISTINCT TRUCK_LU 
              FROM PARTS_SUPPLYCHAIN.FLEET.TPMS_EXTRACT 
              WHERE TRUCK_LU IS NOT NULL
            `;
            const tpmsAssigned = await executeQuery<{ TRUCK_LU: string }>(tpmsSql);
            
            // Also get the current UNASSIGNED_VEHICLES for double-confirmation
            const unassignedSql = `
              SELECT DISTINCT VEHICLE_NUMBER 
              FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES 
              WHERE VEHICLE_NUMBER IS NOT NULL
            `;
            const unassignedVehicles = await executeQuery<{ VEHICLE_NUMBER: string }>(unassignedSql);
            
            // Create normalized sets for fast lookup
            const assignedSet = new Set<string>();
            for (const row of tpmsAssigned) {
              if (row.TRUCK_LU) {
                const normalized = row.TRUCK_LU.toString().replace(/^0+/, '') || '0';
                assignedSet.add(normalized);
              }
            }
            
            const unassignedSet = new Set<string>();
            for (const row of unassignedVehicles) {
              if (row.VEHICLE_NUMBER) {
                const normalized = row.VEHICLE_NUMBER.toString().replace(/^0+/, '') || '0';
                unassignedSet.add(normalized);
              }
            }
            
            console.log(`[Spares Cleanup] Found ${assignedSet.size} assigned trucks in TPMS_EXTRACT, ${unassignedSet.size} in UNASSIGNED_VEHICLES`);
            
            // Find and delete manually-added trucks that are:
            // 1. Found in TPMS_EXTRACT (assigned to a tech), AND
            // 2. NOT in UNASSIGNED_VEHICLES (no longer unassigned)
            let deletedCount = 0;
            for (const truck of manualTrucks) {
              const normalized = truck.vehicleNumber.replace(/^0+/, '') || '0';
              const isAssigned = assignedSet.has(normalized);
              const isUnassigned = unassignedSet.has(normalized);
              
              // Only delete if confirmed assigned AND not in unassigned list
              if (isAssigned && !isUnassigned) {
                await getDb().delete(spareVehicleDetails)
                  .where(eq(spareVehicleDetails.vehicleNumber, truck.vehicleNumber));
                deletedCount++;
                console.log(`[Spares Cleanup] Removed truck ${truck.vehicleNumber} (confirmed assigned in TPMS, not in UNASSIGNED_VEHICLES)`);
              }
            }
            
            if (deletedCount > 0) {
              console.log(`[Spares Cleanup] Cleaned up ${deletedCount} manually-added trucks that are now assigned`);
            } else {
              console.log("[Spares Cleanup] No manually-added trucks needed cleanup");
            }
          }
          
          lastManualTruckCleanup = now;
        } catch (cleanupError: any) {
          console.error("[Spares Cleanup] Error during cleanup:", cleanupError.message);
          // Don't fail the whole request if cleanup fails
        }
      }
      
      // 1. Get all unassigned vehicles with VINs
      const unassignedSql = `
        SELECT 
          VEHICLE_NUMBER,
          VIN,
          MAKE_NAME,
          MODEL_NAME,
          TRUCK_DISTRICT,
          TRUCK_STATUS,
          AMS_CUR_ADDRESS,
          AMS_CUR_CITY,
          AMS_CUR_STATE,
          AMS_CUR_ZIP
        FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
        ORDER BY VEHICLE_NUMBER
      `;
      const unassignedVehicles = await executeQuery<{
        VEHICLE_NUMBER: string;
        VIN: string;
        MAKE_NAME: string;
        MODEL_NAME: string;
        TRUCK_DISTRICT: string;
        TRUCK_STATUS: string;
        AMS_CUR_ADDRESS: string;
        AMS_CUR_CITY: string;
        AMS_CUR_STATE: string;
        AMS_CUR_ZIP: string;
      }>(unassignedSql);
      console.log(`[Spares Locations] Found ${unassignedVehicles.length} unassigned vehicles`);
      
      // 2. Get confirmed addresses and status fields from SPARE_VEHICLE_ASSIGNMENT_STATUS
      // First, try to get all fields including new status columns
      // If the new columns don't exist yet, fall back to just confirmed address
      interface VehicleStatusData {
        address: string;
        updatedAt: string;
        keysStatus: string | null;
        repairedStatus: string | null;
        registrationRenewalDate: string | null;
        contactNamePhone: string | null;
        generalComments: string | null;
        fleetTeamComments: string | null;
        manualEditTimestamp: string | null;
      }
      const vehicleStatusMap = new Map<string, VehicleStatusData>();
      
      try {
        // Query Snowflake for all editable fields with correct column names:
        //   KEYS_STATUS, REPAIRED_STATUS, REGISTRATION_RENEWAL_DATE, CONFIRMED_CONTACT, 
        //   ONGOING_COMMENTS (general comments), FLEET_TEAM_FINAL_COMMENTS
        const statusFieldsSql = `
          WITH LatestStatus AS (
            SELECT 
              VEHICLE_NUMBER,
              CONFIRMED_ADDRESS,
              ADDRESS_UPDATED_AT,
              KEYS_STATUS,
              REPAIRED_STATUS,
              REGISTRATION_RENEWAL_DATE,
              CONFIRMED_CONTACT,
              ONGOING_COMMENTS,
              FLEET_TEAM_FINAL_COMMENTS,
              UPDATED_AT,
              MANUAL_EDIT_TIMESTAMP,
              ROW_NUMBER() OVER (PARTITION BY VEHICLE_NUMBER ORDER BY COALESCE(ADDRESS_UPDATED_AT, UPDATED_AT) DESC NULLS LAST) as rn
            FROM PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS
          )
          SELECT VEHICLE_NUMBER, CONFIRMED_ADDRESS, ADDRESS_UPDATED_AT, 
                 KEYS_STATUS, REPAIRED_STATUS, REGISTRATION_RENEWAL_DATE,
                 CONFIRMED_CONTACT, ONGOING_COMMENTS, FLEET_TEAM_FINAL_COMMENTS, UPDATED_AT,
                 MANUAL_EDIT_TIMESTAMP
          FROM LatestStatus
          WHERE rn = 1
        `;
        const statusFields = await executeQuery<{ 
          VEHICLE_NUMBER: string; 
          CONFIRMED_ADDRESS: string; 
          ADDRESS_UPDATED_AT: string;
          KEYS_STATUS: string | null;
          REPAIRED_STATUS: string | null;
          REGISTRATION_RENEWAL_DATE: string | null;
          CONFIRMED_CONTACT: string | null;
          ONGOING_COMMENTS: string | null;
          FLEET_TEAM_FINAL_COMMENTS: string | null;
          UPDATED_AT: string;
          MANUAL_EDIT_TIMESTAMP: string | null;
        }>(statusFieldsSql);
        
        for (const row of statusFields) {
          if (row.VEHICLE_NUMBER) {
            const normalized = row.VEHICLE_NUMBER.toString().replace(/^0+/, '') || '0';
            vehicleStatusMap.set(normalized, {
              address: row.CONFIRMED_ADDRESS || '',
              updatedAt: row.ADDRESS_UPDATED_AT || '',
              keysStatus: row.KEYS_STATUS || null,
              repairedStatus: row.REPAIRED_STATUS || null,
              registrationRenewalDate: row.REGISTRATION_RENEWAL_DATE || null,
              contactNamePhone: row.CONFIRMED_CONTACT || null,
              generalComments: row.ONGOING_COMMENTS || null,
              fleetTeamComments: row.FLEET_TEAM_FINAL_COMMENTS || null,
              manualEditTimestamp: row.MANUAL_EDIT_TIMESTAMP || null
            });
          }
        }
        console.log(`[Spares Locations] Found ${vehicleStatusMap.size} vehicle status records from Snowflake`);
      } catch (statusError: any) {
        // If Snowflake table doesn't exist or connection fails, continue without Snowflake data
        console.log(`[Spares Locations] Could not fetch Snowflake status data: ${statusError.message}`);
      }
      
      // 2b. Also load local PostgreSQL spare_vehicle_details to merge with Snowflake data
      // This ensures bulk-imported data (registration dates, etc.) is displayed
      try {
        const allLocalDetails = await getDb().select().from(spareVehicleDetails);
        console.log(`[Spares Locations] Found ${allLocalDetails.length} local spare vehicle details`);
        
        for (const detail of allLocalDetails) {
          const normalized = detail.vehicleNumber.replace(/^0+/, '') || '0';
          const existing = vehicleStatusMap.get(normalized) || {
            address: '',
            updatedAt: '',
            keysStatus: null,
            repairedStatus: null,
            registrationRenewalDate: null,
            contactNamePhone: null,
            generalComments: null,
            fleetTeamComments: null,
            manualEditTimestamp: null
          };
          
          // Merge local PostgreSQL data - local data takes precedence for these fields
          vehicleStatusMap.set(normalized, {
            address: detail.physicalAddress || existing.address,
            updatedAt: detail.updatedAt?.toISOString() || existing.updatedAt,
            keysStatus: detail.keysStatus || existing.keysStatus,
            repairedStatus: detail.repairCompleted || existing.repairedStatus,
            registrationRenewalDate: detail.registrationRenewalDate?.toISOString().split('T')[0] || existing.registrationRenewalDate,
            contactNamePhone: detail.contactNamePhone || existing.contactNamePhone,
            generalComments: detail.generalComments || existing.generalComments,
            fleetTeamComments: detail.johnsComments || existing.fleetTeamComments,
            manualEditTimestamp: existing.manualEditTimestamp
          });
        }
        console.log(`[Spares Locations] Merged local data, vehicleStatusMap now has ${vehicleStatusMap.size} entries`);
      } catch (localError: any) {
        console.log(`[Spares Locations] Could not fetch local spare vehicle details: ${localError.message}`);
      }
      
      // 3. Get Samsara locations
      const samsaraLocationMap = await fetchSamsaraLocations();
      console.log(`[Spares Locations] Found ${samsaraLocationMap.size} Samsara locations`);
      
      // 4. Get repair shop vehicle numbers (from trucks table)
      const repairShopTrucks = await fleetScopeStorage.getAllTrucks();
      const repairShopVehicleNumbers = new Set<string>();
      for (const truck of repairShopTrucks) {
        const normalized = truck.truckNumber.toString().replace(/^0+/, '') || '0';
        repairShopVehicleNumbers.add(normalized);
      }
      console.log(`[Spares Locations] Found ${repairShopVehicleNumbers.size} vehicles in repair shops`);
      
      // 4b. Get PMF vehicle asset_ids to exclude from spares
      const pmfVehiclesData = await getDb().select({ assetId: pmfRows.assetId }).from(pmfRows);
      const pmfVehicleNumbers = new Set<string>();
      for (const pmfRow of pmfVehiclesData) {
        if (pmfRow.assetId) {
          const normalized = pmfRow.assetId.toString().replace(/^0+/, '') || '0';
          pmfVehicleNumbers.add(normalized);
        }
      }
      console.log(`[Spares Locations] Found ${pmfVehicleNumbers.size} PMF vehicles to exclude`);
      
      // 5a. Get declined status from multiple sources
      // Source 1: Rentals Dashboard - trucks with mainStatus = "Declined Repair"
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const declinedFromDashboard = new Set<string>();
      for (const truck of allTrucks) {
        if (truck.mainStatus === 'Declined Repair') {
          const normalized = truck.truckNumber?.toString().replace(/^0+/, '') || '0';
          declinedFromDashboard.add(normalized);
        }
      }
      console.log(`[Spares Locations] Found ${declinedFromDashboard.size} declined trucks from Dashboard`);
      
      // Source 2: Decommissioning table
      const decommissioningVehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
      const declinedFromDecommissioning = new Set<string>();
      for (const vehicle of decommissioningVehicles) {
        if (vehicle.truckNumber) {
          const normalized = vehicle.truckNumber.toString().replace(/^0+/, '') || '0';
          declinedFromDecommissioning.add(normalized);
        }
      }
      console.log(`[Spares Locations] Found ${declinedFromDecommissioning.size} trucks in Decommissioning`);
      
      // Source 3: POs with "Decline and Submit for Sale"
      const allPOs = await fleetScopeStorage.getAllPurchaseOrders();
      const declinedFromPOs = new Set<string>();
      for (const po of allPOs) {
        if (po.finalApproval?.toLowerCase().includes('decline') && 
            po.finalApproval?.toLowerCase().includes('sale')) {
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const vehicleNo = rawData["Vehicle_No"] || rawData["Vehicle No"] || rawData["VEHICLE_NO"] || "";
            if (vehicleNo) {
              const normalized = vehicleNo.toString().replace(/^0+/, '') || '0';
              declinedFromPOs.add(normalized);
            }
          } catch (e) {}
        }
      }
      console.log(`[Spares Locations] Found ${declinedFromPOs.size} declined trucks from POs`);
      
      // 5. Calculate one month ago for Samsara recency
      const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      
      // 7. Build the result arrays
      const otherLocations: any[] = [];
      const repairShopLocations: any[] = [];
      
      let pmfExcludedCount = 0;
      for (const vehicle of unassignedVehicles) {
        const vehicleNum = vehicle.VEHICLE_NUMBER?.toString().trim() || '';
        const normalized = vehicleNum.replace(/^0+/, '') || '0';
        
        // Skip vehicles that are in the PMF table
        if (pmfVehicleNumbers.has(normalized)) {
          pmfExcludedCount++;
          continue;
        }
        
        // Get vehicle status data (confirmed address + new fields)
        const statusData = vehicleStatusMap.get(normalized);
        
        // Get Samsara data - only show if within 30 days
        const samsaraInfo = samsaraLocationMap.get(normalized);
        let samsaraAddress = '';
        let samsaraTimestamp = '';
        let hasRecentSamsara = false;
        
        if (samsaraInfo && samsaraInfo.timestamp) {
          const parsed = new Date(samsaraInfo.timestamp);
          if (!isNaN(parsed.getTime()) && parsed.getTime() > oneMonthAgo) {
            // Only include Samsara data if it's within the last 30 days
            samsaraAddress = samsaraInfo.address || '';
            samsaraTimestamp = samsaraInfo.timestamp || '';
            hasRecentSamsara = true;
          }
          // If timestamp is older than 30 days, we leave samsaraAddress empty
        }
        
        const hasConfirmedAddress = !!statusData?.address;
        
        // Determine declined source(s)
        const declinedSources: string[] = [];
        if (declinedFromDashboard.has(normalized)) declinedSources.push('Dashboard');
        if (declinedFromDecommissioning.has(normalized)) declinedSources.push('Decommissioning');
        if (declinedFromPOs.has(normalized)) declinedSources.push('Repairs');
        
        const vehicleData = {
          vehicleNumber: vehicleNum,
          vin: vehicle.VIN || '',
          make: vehicle.MAKE_NAME || '',
          model: vehicle.MODEL_NAME || '',
          district: vehicle.TRUCK_DISTRICT || '',
          truckStatus: vehicle.TRUCK_STATUS || '',
          amsAddress: [vehicle.AMS_CUR_ADDRESS, vehicle.AMS_CUR_CITY, vehicle.AMS_CUR_STATE, vehicle.AMS_CUR_ZIP].filter(Boolean).join(', '),
          confirmedAddress: statusData?.address || '',
          confirmedAddressUpdatedAt: statusData?.updatedAt || '',
          samsaraAddress: samsaraAddress,
          samsaraTimestamp: samsaraTimestamp,
          hasConfirmedAddress: hasConfirmedAddress,
          hasRecentSamsara: hasRecentSamsara,
          locationSource: hasConfirmedAddress && hasRecentSamsara ? 'both' : (hasConfirmedAddress ? 'confirmed' : 'samsara'),
          // New status fields
          keysStatus: statusData?.keysStatus || null,
          repairedStatus: statusData?.repairedStatus || null,
          registrationRenewalDate: statusData?.registrationRenewalDate || null,
          contactNamePhone: statusData?.contactNamePhone || null,
          generalComments: statusData?.generalComments || null,
          fleetTeamComments: statusData?.fleetTeamComments || null,
          manualEditTimestamp: statusData?.manualEditTimestamp || null,
          // Declined status from cross-referencing
          isDeclined: declinedSources.length > 0,
          declinedSources: declinedSources
        };
        
        // Categorize as repair shop or other location
        if (repairShopVehicleNumbers.has(normalized)) {
          repairShopLocations.push(vehicleData);
        } else {
          otherLocations.push(vehicleData);
        }
      }
      
      // 8. Include manually-added trucks that don't exist in Snowflake UNASSIGNED_VEHICLES
      // These are trucks added via the "Add Truck" button that might not be in the Snowflake source
      const processedVehicleNumbers = new Set<string>();
      for (const vehicle of unassignedVehicles) {
        const normalized = (vehicle.VEHICLE_NUMBER?.toString().trim() || '').replace(/^0+/, '') || '0';
        processedVehicleNumbers.add(normalized);
      }
      
      // Find manual additions that weren't in the Snowflake list
      // Only include records that have substantive spare vehicle data (not just registration dates)
      const allLocalDetails = await getDb().select().from(spareVehicleDetails);
      let manuallyAddedCount = 0;
      for (const detail of allLocalDetails) {
        const normalized = detail.vehicleNumber.replace(/^0+/, '') || '0';
        
        // Skip if already processed from Snowflake
        if (processedVehicleNumbers.has(normalized)) continue;
        
        // Skip PMF vehicles
        if (pmfVehicleNumbers.has(normalized)) continue;
        
        // Skip repair shop vehicles
        if (repairShopVehicleNumbers.has(normalized)) continue;
        
        // Only include if the record has actual spare vehicle data (not just registration date)
        // This prevents registration-only imports from polluting the Spares list
        // Also include trucks explicitly marked as manual entries
        const hasSpareData = detail.isManualEntry || detail.physicalAddress || detail.keysStatus || 
          detail.repairCompleted || detail.contactNamePhone || 
          detail.generalComments || detail.johnsComments || detail.vin;
        if (!hasSpareData) continue;
        
        manuallyAddedCount++;
        
        // Get Samsara data if available
        const samsaraData = samsaraLocationMap.get(normalized);
        const samsaraAddress = samsaraData?.address || '';
        const samsaraTimestamp = samsaraData?.timestamp || '';
        const hasRecentSamsara = samsaraTimestamp ? new Date(samsaraTimestamp).getTime() > oneMonthAgo : false;
        
        // Determine declined source(s) for manually-added trucks
        const manualDeclinedSources: string[] = [];
        if (declinedFromDashboard.has(normalized)) manualDeclinedSources.push('Dashboard');
        if (declinedFromDecommissioning.has(normalized)) manualDeclinedSources.push('Decommissioning');
        if (declinedFromPOs.has(normalized)) manualDeclinedSources.push('Repairs');
        
        const vehicleData = {
          vehicleNumber: detail.vehicleNumber,
          vin: detail.vin || '',
          make: '',
          model: '',
          district: '',
          status: 'Manually Added',
          amsAddress: '',
          confirmedAddress: detail.physicalAddress || '',
          confirmedAddressUpdatedAt: detail.updatedAt?.toISOString() || '',
          samsaraAddress: samsaraAddress,
          samsaraTimestamp: samsaraTimestamp,
          hasConfirmedAddress: !!detail.physicalAddress,
          hasRecentSamsara: hasRecentSamsara,
          locationSource: detail.physicalAddress ? 'confirmed' : (hasRecentSamsara ? 'samsara' : 'none'),
          keysStatus: detail.keysStatus || null,
          repairedStatus: detail.repairCompleted || null,
          registrationRenewalDate: detail.registrationRenewalDate?.toISOString().split('T')[0] || null,
          contactNamePhone: detail.contactNamePhone || null,
          generalComments: detail.generalComments || null,
          fleetTeamComments: detail.johnsComments || null,
          manualEditTimestamp: null,
          // Declined status from cross-referencing
          isDeclined: manualDeclinedSources.length > 0,
          declinedSources: manualDeclinedSources
        };
        
        otherLocations.push(vehicleData);
      }
      
      if (manuallyAddedCount > 0) {
        console.log(`[Spares Locations] Added ${manuallyAddedCount} manually-added trucks not in Snowflake`);
      }
      
      console.log(`[Spares Locations] Result: ${otherLocations.length} at other locations, ${repairShopLocations.length} in repair shops (${pmfExcludedCount} PMF vehicles excluded)`);
      
      // Calculate address breakdown counts across all vehicles
      const allVehicles = [...otherLocations, ...repairShopLocations];
      const withConfirmedOnly = allVehicles.filter(v => v.hasConfirmedAddress && !v.hasRecentSamsara).length;
      const withSamsaraOnly = allVehicles.filter(v => !v.hasConfirmedAddress && v.hasRecentSamsara).length;
      const withBoth = allVehicles.filter(v => v.hasConfirmedAddress && v.hasRecentSamsara).length;
      const withNeither = allVehicles.filter(v => !v.hasConfirmedAddress && !v.hasRecentSamsara).length;
      
      res.json({
        success: true,
        otherLocations,
        repairShopLocations,
        counts: {
          otherLocations: otherLocations.length,
          repairShop: repairShopLocations.length,
          total: otherLocations.length + repairShopLocations.length
        },
        addressBreakdown: {
          confirmedOnly: withConfirmedOnly,
          samsaraOnly: withSamsaraOnly,
          both: withBoth,
          neither: withNeither,
          totalWithConfirmed: withConfirmedOnly + withBoth,
          totalWithSamsara: withSamsaraOnly + withBoth
        }
      });
    } catch (error: any) {
      console.error("[Spares Locations] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Update spare vehicle status fields in Snowflake
  app.patch("/spares/status", async (req, res) => {
    try {
      // Define enum values for validation
      const keysStatusEnum = z.enum(["Present", "Not Present", "Unknown/would not check", "Yes", "No", "Unconfirmed"]);
      const repairedStatusEnum = z.enum(["Complete", "In Process", "Unknown if needed", "Declined"]);
      // fleetTeamComments now accepts any string up to 150 chars (predefined options + custom input)
      
      const inputSchema = z.object({
        vehicleNumber: z.string().min(1, "Vehicle number is required").max(10, "Vehicle number too long"),
        keysStatus: keysStatusEnum.nullable().optional(),
        repairedStatus: repairedStatusEnum.nullable().optional(),
        registrationRenewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
        contactNamePhone: z.string().max(60, "Contact info too long").nullable().optional().transform(val => val?.trim() || null),
        generalComments: z.string().max(500, "Comments too long").nullable().optional().transform(val => val?.trim() || null),
        fleetTeamComments: z.string().max(150, "Fleet team comments too long (max 150 characters)").nullable().optional().transform(val => val?.trim() || null)
      });
      
      const parseResult = inputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: parseResult.error.errors[0]?.message || "Invalid input" 
        });
      }
      
      const { vehicleNumber, keysStatus, repairedStatus, registrationRenewalDate, contactNamePhone, generalComments, fleetTeamComments } = parseResult.data;
      
      // Normalize vehicle number (pad with leading zeros to 6 digits)
      const normalizedVehicleNumber = vehicleNumber.padStart(6, '0');
      
      // IMPORTANT: Check which fields were actually provided in the request body (before Zod transform)
      // The Zod transform converts undefined to null, so we need to check the raw body
      const providedFields = {
        keysStatus: 'keysStatus' in req.body,
        repairedStatus: 'repairedStatus' in req.body,
        registrationRenewalDate: 'registrationRenewalDate' in req.body,
        contactNamePhone: 'contactNamePhone' in req.body,
        generalComments: 'generalComments' in req.body,
        fleetTeamComments: 'fleetTeamComments' in req.body
      };
      
      console.log(`[Spares] Updating status fields for vehicle ${normalizedVehicleNumber}`);
      console.log(`[Spares] Provided fields: ${JSON.stringify(providedFields)}`);
      console.log(`[Spares] Parsed values: keys=${keysStatus}, repaired=${repairedStatus}, regDate=${registrationRenewalDate}, contact=${contactNamePhone}, generalComments=${generalComments}, fleetComments=${fleetTeamComments}`);
      
      // Step 1: Save ONLY the provided fields to PostgreSQL (don't overwrite fields that weren't sent)
      const pgUpdates: Record<string, any> = {};
      if (providedFields.keysStatus) pgUpdates.keysStatus = keysStatus;
      if (providedFields.repairedStatus) pgUpdates.repairCompleted = repairedStatus;
      if (providedFields.registrationRenewalDate) pgUpdates.registrationRenewalDate = registrationRenewalDate ? new Date(registrationRenewalDate) : null;
      if (providedFields.contactNamePhone) pgUpdates.contactNamePhone = contactNamePhone;
      if (providedFields.generalComments) pgUpdates.generalComments = generalComments;
      if (providedFields.fleetTeamComments) pgUpdates.johnsComments = fleetTeamComments;
      
      if (Object.keys(pgUpdates).length > 0) {
        pgUpdates.updatedAt = new Date();
        console.log(`[Spares] About to save to PostgreSQL: ${JSON.stringify(pgUpdates)}`);
        const savedResult = await fleetScopeStorage.upsertSpareVehicleDetail(normalizedVehicleNumber, pgUpdates);
        console.log(`[Spares] Saved to PostgreSQL. Result ID: ${savedResult?.id}, contact: ${savedResult?.contactNamePhone}, generalComments: ${savedResult?.generalComments}`);
      }
      
      // Return response immediately after PostgreSQL save (fast path)
      res.json({ 
        success: true, 
        message: "Status fields updated successfully",
        vehicleNumber: normalizedVehicleNumber
      });
      
      // Step 2: Sync ALL editable fields to Snowflake (background - fire and forget)
      // Snowflake column mapping:
      //   generalComments -> ONGOING_COMMENTS
      //   keysStatus -> KEYS_STATUS  
      //   repairedStatus -> REPAIRED_STATUS
      //   registrationRenewalDate -> REGISTRATION_RENEWAL_DATE
      //   contactNamePhone -> CONFIRMED_CONTACT
      //   fleetTeamComments -> FLEET_TEAM_FINAL_COMMENTS
      const hasSnowflakeFields = providedFields.keysStatus || providedFields.repairedStatus || 
        providedFields.registrationRenewalDate || providedFields.contactNamePhone || 
        providedFields.generalComments || providedFields.fleetTeamComments;
      
      if (hasSnowflakeFields) {
        const insertFields = ["VEHICLE_NUMBER"];
        const insertValues = ["source.VEHICLE_NUMBER"];
        const sourceFields: string[] = ["? AS VEHICLE_NUMBER"];
        const sourceValues: any[] = [normalizedVehicleNumber];
        const updateSetClauses: string[] = [];
        
        if (providedFields.keysStatus) {
          insertFields.push("KEYS_STATUS");
          insertValues.push("source.KEYS_STATUS");
          sourceFields.push("? AS KEYS_STATUS");
          sourceValues.push(keysStatus);
          updateSetClauses.push("KEYS_STATUS = source.KEYS_STATUS");
        }
        if (providedFields.repairedStatus) {
          insertFields.push("REPAIRED_STATUS");
          insertValues.push("source.REPAIRED_STATUS");
          sourceFields.push("? AS REPAIRED_STATUS");
          sourceValues.push(repairedStatus);
          updateSetClauses.push("REPAIRED_STATUS = source.REPAIRED_STATUS");
        }
        if (providedFields.registrationRenewalDate) {
          insertFields.push("REGISTRATION_RENEWAL_DATE");
          insertValues.push("source.REGISTRATION_RENEWAL_DATE");
          sourceFields.push("? AS REGISTRATION_RENEWAL_DATE");
          sourceValues.push(registrationRenewalDate);
          updateSetClauses.push("REGISTRATION_RENEWAL_DATE = source.REGISTRATION_RENEWAL_DATE");
        }
        if (providedFields.contactNamePhone) {
          insertFields.push("CONFIRMED_CONTACT");
          insertValues.push("source.CONFIRMED_CONTACT");
          sourceFields.push("? AS CONFIRMED_CONTACT");
          sourceValues.push(contactNamePhone);
          updateSetClauses.push("CONFIRMED_CONTACT = source.CONFIRMED_CONTACT");
        }
        if (providedFields.generalComments) {
          insertFields.push("ONGOING_COMMENTS");
          insertValues.push("source.ONGOING_COMMENTS");
          sourceFields.push("? AS ONGOING_COMMENTS");
          sourceValues.push(generalComments);
          updateSetClauses.push("ONGOING_COMMENTS = source.ONGOING_COMMENTS");
        }
        if (providedFields.fleetTeamComments) {
          insertFields.push("FLEET_TEAM_FINAL_COMMENTS");
          insertValues.push("source.FLEET_TEAM_FINAL_COMMENTS");
          sourceFields.push("? AS FLEET_TEAM_FINAL_COMMENTS");
          sourceValues.push(fleetTeamComments);
          updateSetClauses.push("FLEET_TEAM_FINAL_COMMENTS = source.FLEET_TEAM_FINAL_COMMENTS");
        }
        
        // Set MANUAL_EDIT_TIMESTAMP when confirmedAddress, generalComments, or fleetTeamComments are updated
        const hasManualEditFields = providedFields.generalComments || providedFields.fleetTeamComments;
        if (hasManualEditFields) {
          insertFields.push("MANUAL_EDIT_TIMESTAMP");
          insertValues.push("CURRENT_TIMESTAMP()");
          updateSetClauses.push("MANUAL_EDIT_TIMESTAMP = CURRENT_TIMESTAMP()");
        }
        
        insertFields.push("UPDATED_AT");
        insertValues.push("CURRENT_TIMESTAMP()");
        updateSetClauses.push("UPDATED_AT = CURRENT_TIMESTAMP()");
        
        const sql = `
          MERGE INTO PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS AS target
          USING (SELECT ${sourceFields.join(", ")}) AS source
          ON target.VEHICLE_NUMBER = source.VEHICLE_NUMBER
          WHEN MATCHED THEN
            UPDATE SET ${updateSetClauses.join(", ")}
          WHEN NOT MATCHED THEN
            INSERT (${insertFields.join(", ")})
            VALUES (${insertValues.join(", ")})
        `;
        
        try {
          await executeQuery(sql, sourceValues);
          console.log(`[Spares] Synced to Snowflake: keys=${providedFields.keysStatus}, repaired=${providedFields.repairedStatus}, regDate=${providedFields.registrationRenewalDate}, contact=${providedFields.contactNamePhone}, comments=${providedFields.generalComments}, fleetComments=${providedFields.fleetTeamComments}`);
        } catch (snowflakeError: any) {
          console.error(`[Spares] Snowflake sync failed (PostgreSQL save succeeded): ${snowflakeError.message}`);
        }
      }
      
      console.log(`[Spares] Completed background Snowflake sync for vehicle ${normalizedVehicleNumber}`);
    } catch (error: any) {
      console.error("[Spares] Error updating status fields:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Update confirmed address for a spare vehicle in Snowflake
  app.patch("/spares/confirmed-address", async (req, res) => {
    try {
      // Validate input with Zod
      const inputSchema = z.object({
        vehicleNumber: z.string().min(1, "Vehicle number is required").max(10, "Vehicle number too long"),
        confirmedAddress: z.string().max(500, "Address too long").nullable().transform(val => val?.trim() || null)
      });
      
      const parseResult = inputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: parseResult.error.errors[0]?.message || "Invalid input" 
        });
      }
      
      const { vehicleNumber, confirmedAddress } = parseResult.data;
      
      // Normalize vehicle number (pad with leading zeros to 6 digits)
      const normalizedVehicleNumber = vehicleNumber.padStart(6, '0');
      
      console.log(`[Spares] Updating confirmed address for vehicle ${normalizedVehicleNumber}: ${confirmedAddress}`);
      
      // Step 1: Save to PostgreSQL first (fast, reliable local storage)
      const pgUpdates = {
        physicalAddress: confirmedAddress,
        updatedAt: new Date()
      };
      await fleetScopeStorage.upsertSpareVehicleDetail(normalizedVehicleNumber, pgUpdates);
      console.log(`[Spares] Saved confirmed address to PostgreSQL for vehicle ${normalizedVehicleNumber}`);
      
      // Return response immediately after PostgreSQL save
      res.json({ 
        success: true, 
        message: "Confirmed address updated successfully",
        vehicleNumber: normalizedVehicleNumber,
        confirmedAddress
      });
      
      // Step 2: Sync to Snowflake in background (fire and forget)
      try {
        const sql = `
          MERGE INTO PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS AS target
          USING (SELECT ? AS VEHICLE_NUMBER, ? AS CONFIRMED_ADDRESS, CURRENT_TIMESTAMP() AS ADDRESS_UPDATED_AT) AS source
          ON target.VEHICLE_NUMBER = source.VEHICLE_NUMBER
          WHEN MATCHED THEN
            UPDATE SET 
              CONFIRMED_ADDRESS = source.CONFIRMED_ADDRESS,
              ADDRESS_UPDATED_AT = source.ADDRESS_UPDATED_AT,
              MANUAL_EDIT_TIMESTAMP = CURRENT_TIMESTAMP()
          WHEN NOT MATCHED THEN
            INSERT (VEHICLE_NUMBER, CONFIRMED_ADDRESS, ADDRESS_UPDATED_AT, MANUAL_EDIT_TIMESTAMP)
            VALUES (source.VEHICLE_NUMBER, source.CONFIRMED_ADDRESS, source.ADDRESS_UPDATED_AT, CURRENT_TIMESTAMP())
        `;
        
        await executeQuery(sql, [normalizedVehicleNumber, confirmedAddress || null]);
        console.log(`[Spares] Synced confirmed address to Snowflake for vehicle ${normalizedVehicleNumber}`);
      } catch (snowflakeError: any) {
        console.error(`[Spares] Snowflake sync failed (PostgreSQL save succeeded): ${snowflakeError.message}`);
      }
    } catch (error: any) {
      console.error("[Spares] Error updating confirmed address:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Bulk import spare vehicle data
  app.post("/spares/bulk-import", async (req, res) => {
    try {
      const importSchema = z.object({
        data: z.array(z.object({
          truckNumber: z.string(),
          registrationRenewalDate: z.string().nullable().optional(),
          keys: z.string().nullable().optional(),
          repaired: z.string().nullable().optional(),
          confirmedAddress: z.string().nullable().optional(),
          contactNamePhone: z.string().nullable().optional(),
          generalComments: z.string().nullable().optional(),
          fleetTeamComments: z.string().nullable().optional(),
        }))
      });

      const { data } = importSchema.parse(req.body);
      console.log(`[Spares Bulk Import] Processing ${data.length} records...`);

      const results = {
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: [] as string[]
      };

      // Collect Snowflake updates to batch them
      const snowflakeUpdates: Array<{
        vehicleNumber: string;
        physicalAddress?: string;
        contactNamePhone?: string;
        keysStatus?: string;
        repairedStatus?: string;
        registrationRenewalDate?: Date;
        generalComments?: string;
        fleetTeamComments?: string;
      }> = [];

      // Phase 1: Process all PostgreSQL updates (fast)
      for (const row of data) {
        try {
          // Normalize truck number: strip non-digits and pad to 6 digits with leading zeros
          const digitsOnly = row.truckNumber.toString().replace(/\D/g, '');
          if (!digitsOnly) {
            results.errors.push(`${row.truckNumber}: Invalid truck number`);
            results.processed++;
            continue;
          }
          const normalizedTruckNumber = digitsOnly.padStart(6, '0');
          
          // Map Keys values: Yes -> Present, No -> Not Present, empty -> null
          let keysStatus: string | null = null;
          if (row.keys) {
            const keysLower = row.keys.toLowerCase().trim();
            if (keysLower === 'yes') keysStatus = 'Present';
            else if (keysLower === 'no') keysStatus = 'Not Present';
            else if (row.keys.trim()) keysStatus = row.keys.trim();
          }

          // Map Repaired values: Yes/yes -> Complete, No -> null (leave empty)
          let repairedStatus: string | null = null;
          if (row.repaired) {
            const repairedLower = row.repaired.toLowerCase().trim();
            if (repairedLower === 'yes') repairedStatus = 'Complete';
            // If "No", leave as null (user requested to not input an answer)
            else if (repairedLower !== 'no' && row.repaired.trim()) repairedStatus = row.repaired.trim();
          }

          // Build updates object - only include fields that have values
          const updates: Record<string, any> = {};
          
          if (row.registrationRenewalDate?.trim()) {
            // Parse date string to Date object for PostgreSQL timestamp column
            const dateStr = row.registrationRenewalDate.trim();
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
              updates.registrationRenewalDate = parsedDate;
            }
          }
          if (keysStatus) {
            updates.keysStatus = keysStatus;
          }
          if (repairedStatus) {
            updates.repairCompleted = repairedStatus;
          }
          if (row.confirmedAddress?.trim()) {
            updates.physicalAddress = row.confirmedAddress.trim();
          }
          if (row.contactNamePhone?.trim()) {
            updates.contactNamePhone = row.contactNamePhone.trim().slice(0, 60);
          }
          if (row.generalComments?.trim()) {
            updates.generalComments = row.generalComments.trim().slice(0, 500);
          }
          if (row.fleetTeamComments?.trim()) {
            updates.johnsComments = row.fleetTeamComments.trim().slice(0, 150); // PostgreSQL column name
          }

          // Skip if no updates to make
          if (Object.keys(updates).length === 0) {
            results.skipped++;
            results.processed++;
            continue;
          }

          // Update local PostgreSQL database
          await fleetScopeStorage.upsertSpareVehicleDetail(normalizedTruckNumber, updates);

          // Collect Snowflake updates for batch processing - sync ALL editable fields
          const hasSnowflakeUpdate = updates.physicalAddress || updates.contactNamePhone || 
            updates.keysStatus || updates.repairCompleted || updates.registrationRenewalDate || 
            updates.generalComments || updates.johnsComments;
          
          if (hasSnowflakeUpdate) {
            snowflakeUpdates.push({
              vehicleNumber: normalizedTruckNumber,
              physicalAddress: updates.physicalAddress,
              contactNamePhone: updates.contactNamePhone,
              keysStatus: updates.keysStatus,
              repairedStatus: updates.repairCompleted,
              registrationRenewalDate: updates.registrationRenewalDate,
              generalComments: updates.generalComments,
              fleetTeamComments: updates.johnsComments // Map PostgreSQL field to Snowflake
            });
          }

          results.updated++;
          results.processed++;
        } catch (rowError: any) {
          results.errors.push(`${row.truckNumber}: ${rowError.message}`);
          results.processed++;
        }
      }

      // Phase 2: Process Snowflake updates in parallel batches (async, don't block response)
      if (snowflakeUpdates.length > 0) {
        // Process in batches of 10 in parallel
        const batchSize = 10;
        const processBatch = async (batch: typeof snowflakeUpdates) => {
          await Promise.allSettled(batch.map(async (update) => {
            try {
              const snowflakeFields: string[] = ["VEHICLE_NUMBER"];
              const snowflakeSourceFields: string[] = ["? AS VEHICLE_NUMBER"];
              const snowflakeValues: any[] = [update.vehicleNumber];
              const updateClauses: string[] = [];
              
              // Confirmed Address -> CONFIRMED_ADDRESS
              if (update.physicalAddress) {
                snowflakeFields.push("CONFIRMED_ADDRESS", "ADDRESS_UPDATED_AT");
                snowflakeSourceFields.push("? AS CONFIRMED_ADDRESS", "CURRENT_TIMESTAMP() AS ADDRESS_UPDATED_AT");
                snowflakeValues.push(update.physicalAddress);
                updateClauses.push("CONFIRMED_ADDRESS = source.CONFIRMED_ADDRESS", "ADDRESS_UPDATED_AT = source.ADDRESS_UPDATED_AT");
              }
              
              // Contact -> CONFIRMED_CONTACT
              if (update.contactNamePhone) {
                snowflakeFields.push("CONFIRMED_CONTACT");
                snowflakeSourceFields.push("? AS CONFIRMED_CONTACT");
                snowflakeValues.push(update.contactNamePhone);
                updateClauses.push("CONFIRMED_CONTACT = source.CONFIRMED_CONTACT");
              }
              
              // Keys -> KEYS_STATUS
              if (update.keysStatus) {
                snowflakeFields.push("KEYS_STATUS");
                snowflakeSourceFields.push("? AS KEYS_STATUS");
                snowflakeValues.push(update.keysStatus);
                updateClauses.push("KEYS_STATUS = source.KEYS_STATUS");
              }
              
              // Repaired -> REPAIRED_STATUS
              if (update.repairedStatus) {
                snowflakeFields.push("REPAIRED_STATUS");
                snowflakeSourceFields.push("? AS REPAIRED_STATUS");
                snowflakeValues.push(update.repairedStatus);
                updateClauses.push("REPAIRED_STATUS = source.REPAIRED_STATUS");
              }
              
              // Registration Renewal Date -> REGISTRATION_RENEWAL_DATE
              if (update.registrationRenewalDate) {
                snowflakeFields.push("REGISTRATION_RENEWAL_DATE");
                snowflakeSourceFields.push("? AS REGISTRATION_RENEWAL_DATE");
                // Format date as YYYY-MM-DD for Snowflake
                snowflakeValues.push(update.registrationRenewalDate.toISOString().split('T')[0]);
                updateClauses.push("REGISTRATION_RENEWAL_DATE = source.REGISTRATION_RENEWAL_DATE");
              }
              
              // General Comments -> ONGOING_COMMENTS
              if (update.generalComments) {
                snowflakeFields.push("ONGOING_COMMENTS");
                snowflakeSourceFields.push("? AS ONGOING_COMMENTS");
                snowflakeValues.push(update.generalComments);
                updateClauses.push("ONGOING_COMMENTS = source.ONGOING_COMMENTS");
              }
              
              // Fleet Team Comments -> FLEET_TEAM_FINAL_COMMENTS
              if (update.fleetTeamComments) {
                snowflakeFields.push("FLEET_TEAM_FINAL_COMMENTS");
                snowflakeSourceFields.push("? AS FLEET_TEAM_FINAL_COMMENTS");
                snowflakeValues.push(update.fleetTeamComments);
                updateClauses.push("FLEET_TEAM_FINAL_COMMENTS = source.FLEET_TEAM_FINAL_COMMENTS");
              }
              
              // Set MANUAL_EDIT_TIMESTAMP when confirmedAddress, generalComments, or fleetTeamComments are updated
              if (update.physicalAddress || update.generalComments || update.fleetTeamComments) {
                snowflakeFields.push("MANUAL_EDIT_TIMESTAMP");
                updateClauses.push("MANUAL_EDIT_TIMESTAMP = CURRENT_TIMESTAMP()");
              }
              
              // Add UPDATED_AT
              snowflakeFields.push("UPDATED_AT");
              updateClauses.push("UPDATED_AT = CURRENT_TIMESTAMP()");
              
              const snowflakeSql = `
                MERGE INTO PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS AS target
                USING (SELECT ${snowflakeSourceFields.join(", ")}) AS source
                ON target.VEHICLE_NUMBER = source.VEHICLE_NUMBER
                WHEN MATCHED THEN
                  UPDATE SET ${updateClauses.join(", ")}
                WHEN NOT MATCHED THEN
                  INSERT (${snowflakeFields.join(", ")})
                  VALUES (${snowflakeFields.map(f => f === 'ADDRESS_UPDATED_AT' || f === 'UPDATED_AT' || f === 'MANUAL_EDIT_TIMESTAMP' ? 'CURRENT_TIMESTAMP()' : `source.${f}`).join(", ")})
              `;
              await executeQuery(snowflakeSql, snowflakeValues);
            } catch (sfError: any) {
              console.log(`[Spares Bulk Import] Snowflake update failed for ${update.vehicleNumber}: ${sfError.message}`);
            }
          }));
        };

        // Process batches sequentially but items within each batch in parallel
        for (let i = 0; i < snowflakeUpdates.length; i += batchSize) {
          const batch = snowflakeUpdates.slice(i, i + batchSize);
          await processBatch(batch);
        }
        console.log(`[Spares Bulk Import] Snowflake sync complete: ${snowflakeUpdates.length} records`);
      }

      console.log(`[Spares Bulk Import] Complete: ${results.updated} updated, ${results.skipped} skipped, ${results.errors.length} errors`);
      if (results.errors.length > 0) {
        console.log(`[Spares Bulk Import] First 5 errors:`, results.errors.slice(0, 5));
      }
      
      res.json({
        success: true,
        results
      });
    } catch (error: any) {
      console.error("[Spares Bulk Import] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Check if a truck is assigned in Snowflake TPMS_EXTRACT
  app.get("/spares/check-assigned/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      // TPMS_EXTRACT stores truck numbers WITHOUT leading zeros (e.g., 21100 not 021100)
      // So we need to strip leading zeros and query with the raw number
      const rawTruckNumber = truckNumber.replace(/^0+/, '') || truckNumber;
      
      console.log(`[Spares] Checking if truck ${rawTruckNumber} (input: ${truckNumber}) is assigned in TPMS_EXTRACT`);
      
      const sql = `
        SELECT TRUCK_LU, FULL_NAME, TECH_NO
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU = ?
        LIMIT 1
      `;
      
      const results = await executeQuery<{ TRUCK_LU: string; FULL_NAME: string; TECH_NO: string }>(sql, [rawTruckNumber]);
      
      if (results.length > 0) {
        const techName = results[0].FULL_NAME || 'Unknown';
        const techNo = results[0].TECH_NO || '';
        console.log(`[Spares] Truck ${rawTruckNumber} is assigned to ${techName} (${techNo})`);
        res.json({ 
          isAssigned: true, 
          techName,
          techNo,
          message: `This truck is already assigned to ${techName}${techNo ? ` (Tech #${techNo})` : ''}`
        });
      } else {
        console.log(`[Spares] Truck ${rawTruckNumber} is not assigned`);
        res.json({ isAssigned: false });
      }
    } catch (error: any) {
      console.error("[Spares] Error checking truck assignment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Add a manual spare vehicle record
  app.post("/spares/add-manual", async (req, res) => {
    try {
      const inputSchema = z.object({
        truckNumber: z.string().min(1, "Truck number is required").max(10),
        vin: z.string().max(20).nullable().optional(),
        confirmedAddress: z.string().max(500).nullable().optional(),
        keysStatus: z.enum(["Present", "Not Present", "Unknown/would not check", "Yes", "No", "Unconfirmed"]).nullable().optional(),
        repairedStatus: z.enum(["Complete", "In Process", "Unknown if needed", "Declined"]).nullable().optional(),
        registrationRenewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        contactNamePhone: z.string().max(60).nullable().optional(),
        generalComments: z.string().max(500).nullable().optional(),
        fleetTeamComments: z.string().max(150).nullable().optional(),
      });
      
      const parseResult = inputSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: parseResult.error.errors[0]?.message || "Invalid input" 
        });
      }
      
      const data = parseResult.data;
      const normalizedTruckNumber = data.truckNumber.padStart(6, '0');
      
      console.log(`[Spares] Adding manual spare vehicle record for truck ${normalizedTruckNumber}`);
      
      // Save to PostgreSQL
      const pgData: Record<string, any> = {
        vehicleNumber: normalizedTruckNumber,
        updatedAt: new Date(),
        isManualEntry: true,
      };
      
      if (data.vin) pgData.vin = data.vin;
      if (data.confirmedAddress) pgData.physicalAddress = data.confirmedAddress;
      if (data.keysStatus !== undefined) pgData.keysStatus = data.keysStatus;
      if (data.repairedStatus !== undefined) pgData.repairCompleted = data.repairedStatus;
      if (data.registrationRenewalDate) pgData.registrationRenewalDate = new Date(data.registrationRenewalDate);
      if (data.contactNamePhone !== undefined) pgData.contactNamePhone = data.contactNamePhone;
      if (data.generalComments !== undefined) pgData.generalComments = data.generalComments;
      if (data.fleetTeamComments !== undefined) pgData.johnsComments = data.fleetTeamComments;
      
      await fleetScopeStorage.upsertSpareVehicleDetail(normalizedTruckNumber, pgData);
      
      // Return success immediately
      res.json({ 
        success: true, 
        message: "Vehicle added successfully",
        vehicleNumber: normalizedTruckNumber
      });
      
      // Sync to Snowflake in background (confirmed address and other fields)
      if (data.confirmedAddress) {
        try {
          const snowflakeSql = `
            MERGE INTO PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS AS target
            USING (SELECT ? AS VEHICLE_NUMBER, ? AS CONFIRMED_ADDRESS, CURRENT_TIMESTAMP() AS ADDRESS_UPDATED_AT, CURRENT_TIMESTAMP() AS UPDATED_AT) AS source
            ON target.VEHICLE_NUMBER = source.VEHICLE_NUMBER
            WHEN MATCHED THEN
              UPDATE SET CONFIRMED_ADDRESS = source.CONFIRMED_ADDRESS, ADDRESS_UPDATED_AT = source.ADDRESS_UPDATED_AT, UPDATED_AT = source.UPDATED_AT
            WHEN NOT MATCHED THEN
              INSERT (VEHICLE_NUMBER, CONFIRMED_ADDRESS, ADDRESS_UPDATED_AT, UPDATED_AT)
              VALUES (source.VEHICLE_NUMBER, source.CONFIRMED_ADDRESS, source.ADDRESS_UPDATED_AT, source.UPDATED_AT)
          `;
          await executeQuery(snowflakeSql, [normalizedTruckNumber, data.confirmedAddress]);
          console.log(`[Spares] Synced confirmed address to Snowflake for truck ${normalizedTruckNumber}`);
        } catch (snowflakeError: any) {
          console.error(`[Spares] Snowflake sync failed for manual entry: ${snowflakeError.message}`);
        }
      }
      
    } catch (error: any) {
      console.error("[Spares] Error adding manual spare vehicle:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // =====================
  // BYOV TECHNICIAN ROUTES
  // =====================

  // Fetch BYOV technicians from external API
  app.get("/byov/technicians", async (req, res) => {
    try {
      const response = await fetch("https://byovdashboard.replit.app/api/external/technicians", {
        headers: { "Accept": "application/json" }
      });
      
      if (!response.ok) {
        throw new Error(`BYOV API returned ${response.status}`);
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching BYOV technicians:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // BYOV enrollment status check (bulk) with 10-minute cache
  let byovEnrollmentCache: { data: Record<string, boolean>; timestamp: number } | null = null;
  const BYOV_ENROLLMENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  app.get("/byov-enrollment-status", async (_req, res) => {
    try {
      if (byovEnrollmentCache && Date.now() - byovEnrollmentCache.timestamp < BYOV_ENROLLMENT_CACHE_TTL) {
        return res.json(byovEnrollmentCache.data);
      }

      if (technicianDataCache.size === 0) {
        await refreshTechnicianCache();
      }

      const entIdToTruckNums = new Map<string, string[]>();
      for (const [truckNum, techData] of technicianDataCache) {
        if (techData.enterpriseId) {
          const upper = techData.enterpriseId.toUpperCase();
          const existing = entIdToTruckNums.get(upper) || [];
          existing.push(truckNum);
          entIdToTruckNums.set(upper, existing);
        }
      }

      const enrollmentMap: Record<string, boolean> = {};
      if (entIdToTruckNums.size === 0) {
        return res.json(enrollmentMap);
      }

      const apiKey = process.env.FS_BYOV_API_KEY;
      if (!apiKey) {
        console.warn("[BYOV Enrollment] BYOV_API_KEY not set");
        return res.json(enrollmentMap);
      }

      const allIds = Array.from(entIdToTruckNums.keys());
      const batchSize = 500;
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batch = allIds.slice(i, i + batchSize);
        try {
          const response = await fetch("https://byovdashboard.replit.app/api/v1/enrollment-check/bulk", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
            },
            body: JSON.stringify({ enterpriseIds: batch }),
          });
          if (response.ok) {
            const data = await response.json();
            for (const result of (data.results || [])) {
              if (result.enrolled && result.enterpriseId) {
                const truckNums = entIdToTruckNums.get(String(result.enterpriseId).toUpperCase()) || [];
                for (const tn of truckNums) {
                  enrollmentMap[tn] = true;
                }
              }
            }
          } else {
            console.error(`[BYOV Enrollment] API returned ${response.status}`);
          }
        } catch (batchErr: any) {
          console.error("[BYOV Enrollment] Batch fetch error:", batchErr.message);
        }
      }

      console.log(`[BYOV Enrollment] Checked ${allIds.length} enterprise IDs, ${Object.keys(enrollmentMap).length} trucks enrolled`);
      byovEnrollmentCache = { data: enrollmentMap, timestamp: Date.now() };
      res.json(enrollmentMap);
    } catch (error: any) {
      console.error("[BYOV Enrollment] Error:", error.message);
      res.status(500).json({ message: "Failed to check BYOV enrollment" });
    }
  });

  // Get BYOV weekly snapshots
  app.get("/byov/weekly-snapshots", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const snapshots = await fleetScopeStorage.getByovWeeklySnapshots(limit);
      res.json({ snapshots });
    } catch (error: any) {
      console.error("Error fetching BYOV weekly snapshots:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Capture BYOV weekly snapshot (fetches current data and saves it)
  app.post("/byov/capture-snapshot", async (req, res) => {
    try {
      const { capturedBy = "System" } = req.body;
      
      // Fetch current BYOV data from external API
      const response = await fetch("https://byovdashboard.replit.app/api/external/technicians", {
        headers: { "Accept": "application/json" }
      });
      
      if (!response.ok) {
        throw new Error(`BYOV API returned ${response.status}`);
      }
      
      const data = await response.json();
      // Filter for only "Enrolled" status technicians (exclude "Enrollment Terminated")
      const enrolledTechs = (data.technicians || []).filter(
        (t: any) => t.enrollmentStatus === "Enrolled"
      );
      const totalEnrolled = enrolledTechs.length;
      
      // Helper function to normalize fleet vehicle numbers
      const normalizeFleetId = (id: string): string => {
        const digits = id.replace(/\D/g, '');
        return digits.replace(/^0+/, '') || '0';
      };
      
      // Query Snowflake for assigned vehicles
      let assignedInFleet = 0;
      let notInFleet = 0;
      const byovTruckIds = enrolledTechs.map((t: any) => t.truckId?.toString().trim() || '').filter(Boolean);
      
      if (byovTruckIds.length > 0) {
        try {
          const quotedIds = byovTruckIds.map((id: string) => `'${id.padStart(6, '0')}'`).join(', ');
          const fleetSql = `
            SELECT VEHICLE_NUMBER, TRUCK_STATUS 
            FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES 
            WHERE VEHICLE_NUMBER IN (${quotedIds})
          `;
          const fleetResults = await executeQuery<{ VEHICLE_NUMBER: string; TRUCK_STATUS: string }>(fleetSql);
          const assignedSet = new Set(
            fleetResults
              .filter(r => r.TRUCK_STATUS?.trim().toLowerCase() === 'assigned')
              .map(r => normalizeFleetId(r.VEHICLE_NUMBER))
          );
          
          for (const truckId of byovTruckIds) {
            const normalizedId = normalizeFleetId(truckId);
            if (assignedSet.has(normalizedId)) {
              assignedInFleet++;
            } else {
              notInFleet++;
            }
          }
        } catch (err) {
          console.error("Error querying fleet for BYOV snapshot:", err);
          notInFleet = totalEnrolled;
        }
      }
      
      const snapshot = await fleetScopeStorage.createByovWeeklySnapshot({
        totalEnrolled,
        assignedInFleet,
        notInFleet,
        capturedBy,
        technicianIds: byovTruckIds,
      });
      
      res.json({ success: true, snapshot });
    } catch (error: any) {
      console.error("Error capturing BYOV snapshot:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get Fleet weekly snapshots
  app.get("/fleet/weekly-snapshots", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const snapshots = await fleetScopeStorage.getFleetWeeklySnapshots(limit);
      res.json({ snapshots });
    } catch (error: any) {
      console.error("Error fetching Fleet weekly snapshots:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get PMF Status weekly snapshots
  app.get("/pmf-status/weekly-snapshots", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const snapshots = await fleetScopeStorage.getPmfStatusWeeklySnapshots(limit);
      res.json({ snapshots });
    } catch (error: any) {
      console.error("Error fetching PMF Status weekly snapshots:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get Repair weekly snapshots
  app.get("/repair/weekly-snapshots", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const snapshots = await fleetScopeStorage.getRepairWeeklySnapshots(limit);
      res.json({ snapshots });
    } catch (error: any) {
      console.error("Error fetching Repair weekly snapshots:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================
  // ALL VEHICLES ROUTES
  // =====================

  // Get all vehicles from REPLIT_ALL_VEHICLES with assigned/unassigned counts
  let allVehiclesCache: { data: any; timestamp: number } | null = null;
  const ALL_VEHICLES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  app.get("/all-vehicles", async (req, res) => {
    try {
      if (allVehiclesCache && (Date.now() - allVehiclesCache.timestamp) < ALL_VEHICLES_CACHE_TTL) {
        console.log(`[AllVehicles] Returning cached response (age: ${Math.round((Date.now() - allVehiclesCache.timestamp) / 1000)}s)`);
        return res.json(allVehiclesCache.data);
      }
      // Include columns for vehicle details plus location data (GPS, AMS, TPMS)
      const sql = `
        SELECT 
          VEHICLE_NUMBER,
          VIN,
          MAKE_NAME,
          MODEL_NAME,
          TRUCK_STATUS,
          TRUCK_DISTRICT,
          TPMS_ASSIGNED,
          INTERIOR,
          INVENTORY_PRODUCT_CATEGORY,
          -- GPS location data
          GPS_LATITUDE,
          GPS_LONGITUDE,
          GPS_LAST_UPDATE,
          -- AMS location data
          AMS_ZIP_LAT,
          AMS_ZIP_LON,
          AMS_CUR_ADDRESS,
          AMS_CUR_CITY,
          AMS_CUR_STATE,
          AMS_LAST_UPDATE,
          -- TPMS location data
          LAST_TPMS_ZIP_LAT,
          LAST_TPMS_ZIP_LON,
          LAST_TPMS_ADDRESS,
          LAST_TPMS_CITY,
          LAST_TPMS_STATE,
          LAST_TPMS_LAST_UPDATE
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
        ORDER BY VEHICLE_NUMBER
      `;
      const data = await executeQuery(sql);
      
      // Helper function to normalize fleet vehicle numbers - extract digits and remove leading zeros
      const normalizeFleetId = (id: string): string => {
        const digits = id.replace(/\D/g, ''); // Remove all non-digits
        return digits.replace(/^0+/, '') || '0'; // Remove leading zeros
      };
      
      // Helper function to normalize PMF asset IDs - for complex IDs like "46884 / 846", take first 5 digits
      const normalizePmfId = (id: string): string => {
        const digits = id.replace(/\D/g, ''); // Remove all non-digits
        // If there are more than 5 digits (like "46884846" from "46884 / 846"), take first 5
        // Otherwise just remove leading zeros
        if (digits.length > 5) {
          const first5 = digits.slice(0, 5);
          return first5.replace(/^0+/, '') || '0';
        }
        return digits.replace(/^0+/, '') || '0';
      };
      
      // Fetch Samsara GPS location data (with caching) - new primary GPS source
      const samsaraLocationMap = await fetchSamsaraLocations();
      console.log(`[AllVehicles] Samsara data: ${samsaraLocationMap.size} vehicles with GPS location info`);
      
      // Fetch Fleet Finder location data (with caching) - legacy fallback
      const fleetFinderLocationMap = await fetchFleetFinderData();
      console.log(`[AllVehicles] Fleet Finder data: ${fleetFinderLocationMap.size} vehicles with location info`);
      
      const fleetFinderVehicleInfoMap = await fetchFleetFinderVehicleInfo();
      console.log(`[AllVehicles] Fleet Finder vehicle info: ${fleetFinderVehicleInfoMap.size} vehicles with status info`);
      
      // Fetch Holman odometer data - keyed by VIN since CLIENT_VEHICLE_NUMBER is NULL
      interface HolmanOdometerData {
        odometer: number | null;
        odometerDate: string | null;
        licensePlate: string | null;
      }
      const holmanOdometerByVin = new Map<string, HolmanOdometerData>();
      try {
        const holmanSql = `
          SELECT 
            VIN,
            ODOMETER,
            ODOMETER_DATE,
            LICENSE_PLATE
          FROM PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES
          WHERE VIN IS NOT NULL AND ODOMETER IS NOT NULL
        `;
        const holmanData = await executeQuery<{ VIN: string; ODOMETER: number; ODOMETER_DATE: string; LICENSE_PLATE: string | null }>(holmanSql);
        for (const row of holmanData) {
          if (row.VIN) {
            // Use VIN as key (uppercase and trimmed)
            const vin = row.VIN.toString().trim().toUpperCase();
            holmanOdometerByVin.set(vin, {
              odometer: row.ODOMETER || null,
              odometerDate: row.ODOMETER_DATE || null,
              licensePlate: row.LICENSE_PLATE?.toString().trim() || null
            });
          }
        }
        console.log(`[AllVehicles] Holman data: ${holmanOdometerByVin.size} vehicles with odometer info (by VIN)`);
      } catch (holmanError: any) {
        console.error("[AllVehicles] Error fetching Holman odometer data:", holmanError.message);
      }
      
      // Fetch Spare Vehicle Assignment Status data for CONFIRMED_ADDRESS location source
      interface SpareVehicleLocationData {
        confirmedAddress: string | null;
        addressUpdatedAt: string | null;
      }
      const spareVehicleLocationMap = new Map<string, SpareVehicleLocationData>();
      try {
        const spareSql = `
          WITH LatestStatus AS (
            SELECT 
              VEHICLE_NUMBER,
              CONFIRMED_ADDRESS,
              ADDRESS_UPDATED_AT,
              ROW_NUMBER() OVER (PARTITION BY VEHICLE_NUMBER ORDER BY ADDRESS_UPDATED_AT DESC NULLS LAST) as rn
            FROM PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS
            WHERE CONFIRMED_ADDRESS IS NOT NULL
          )
          SELECT VEHICLE_NUMBER, CONFIRMED_ADDRESS, ADDRESS_UPDATED_AT
          FROM LatestStatus
          WHERE rn = 1
        `;
        const spareData = await executeQuery<{ VEHICLE_NUMBER: string; CONFIRMED_ADDRESS: string; ADDRESS_UPDATED_AT: string }>(spareSql);
        for (const row of spareData) {
          if (row.VEHICLE_NUMBER && row.CONFIRMED_ADDRESS) {
            const normalized = normalizeFleetId(row.VEHICLE_NUMBER);
            spareVehicleLocationMap.set(normalized, {
              confirmedAddress: row.CONFIRMED_ADDRESS || null,
              addressUpdatedAt: row.ADDRESS_UPDATED_AT || null
            });
          }
        }
        console.log(`[AllVehicles] Spare Vehicle Assignment data: ${spareVehicleLocationMap.size} vehicles with confirmed addresses`);
      } catch (spareError: any) {
        console.error("[AllVehicles] Error fetching Spare Vehicle Assignment data:", spareError.message);
      }
      
      // Get PMF asset IDs from local database (excluding "Checked Out" vehicles)
      const pmfDataset = await fleetScopeStorage.getPmfDataset();
      const pmfAssetIds = new Set<string>();
      if (pmfDataset.rows) {
        for (const row of pmfDataset.rows) {
          if (row.assetId) {
            // Skip vehicles with "Check Out" or "Checked Out" status
            const status = row.status?.toLowerCase() || '';
            if (status.includes('check out') || status.includes('checked out')) {
              continue;
            }
            // Use PMF normalization (handles "46884 / 846" format)
            const normalized = normalizePmfId(row.assetId);
            pmfAssetIds.add(normalized);
          }
        }
      }
      
      // Build a map of normalized asset ID to PMF status
      const pmfStatusMap = new Map<string, string>();
      if (pmfDataset.rows) {
        for (const row of pmfDataset.rows) {
          if (row.assetId) {
            const status = row.status?.toLowerCase() || '';
            if (status.includes('check out') || status.includes('checked out')) {
              continue;
            }
            const normalized = normalizePmfId(row.assetId);
            pmfStatusMap.set(normalized, row.status || 'Unknown');
          }
        }
      }
      
      // Count assigned vs unassigned based on TPMS_ASSIGNED field
      // Also track PMF vehicle distribution with status breakdowns
      let assignedCount = 0;
      let unassignedCount = 0;
      let pmfAssignedCount = 0;
      let pmfUnassignedCount = 0;
      const pmfAssignedByStatus: Record<string, number> = {};
      const pmfUnassignedByStatus: Record<string, number> = {};
      
      for (const row of data) {
        const tpmsAssigned = (row as Record<string, unknown>).TPMS_ASSIGNED;
        const rawVehicleNumber = (row as Record<string, unknown>).VEHICLE_NUMBER?.toString().trim() || '';
        // Use fleet normalization (just removes leading zeros)
        const vehicleNumber = normalizeFleetId(rawVehicleNumber);
        const isAssigned = tpmsAssigned && tpmsAssigned.toLowerCase() === 'assigned';
        const isPmfVehicle = vehicleNumber && pmfAssetIds.has(vehicleNumber);
        const pmfStatus = pmfStatusMap.get(vehicleNumber);
        
        if (isAssigned) {
          assignedCount++;
          if (isPmfVehicle && pmfStatus) {
            pmfAssignedCount++;
            pmfAssignedByStatus[pmfStatus] = (pmfAssignedByStatus[pmfStatus] || 0) + 1;
          }
        } else {
          unassignedCount++;
          if (isPmfVehicle && pmfStatus) {
            pmfUnassignedCount++;
            pmfUnassignedByStatus[pmfStatus] = (pmfUnassignedByStatus[pmfStatus] || 0) + 1;
          }
        }
      }
      
      // Build a set of normalized fleet vehicle IDs with their assignment status
      const fleetAssignmentMap = new Map<string, boolean>();
      for (const row of data) {
        const rawVehicleNumber = (row as Record<string, unknown>).VEHICLE_NUMBER?.toString().trim() || '';
        const normalized = normalizeFleetId(rawVehicleNumber);
        const tpmsAssigned = (row as Record<string, unknown>).TPMS_ASSIGNED;
        const isAssigned = tpmsAssigned && tpmsAssigned.toLowerCase() === 'assigned';
        fleetAssignmentMap.set(normalized, isAssigned);
      }
      
      // Find PMF vehicles NOT found in fleet data and group by status
      const pmfNotFoundByStatus: Record<string, number> = {};
      for (const [normalizedId, status] of pmfStatusMap.entries()) {
        if (!fleetAssignmentMap.has(normalizedId)) {
          pmfNotFoundByStatus[status] = (pmfNotFoundByStatus[status] || 0) + 1;
        }
      }
      
      // Get repair shop vehicles from dashboard (trucks not "On Road") - fetch first for overlap tracking
      const dashboardTrucks = await fleetScopeStorage.getAllTrucks();
      
      // Build a set of repair shop vehicle numbers for overlap detection
      const repairShopVehicleNumbers = new Set<string>();
      for (const truck of dashboardTrucks) {
        if (truck.mainStatus !== 'On Road') {
          repairShopVehicleNumbers.add(normalizeFleetId(truck.truckNumber));
        }
      }
      
      // Helper function to parse date strings and return timestamp (or 0 if invalid)
      // Defined early so it can be used in multiple places
      const parseTimestampEarly = (dateStr: string | null | undefined): number => {
        if (!dateStr) return 0;
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
      };
      
      // Pre-fetch PO data for "Decline and Submit for Sale" trucks (needed for declined spares count)
      const allPOsForSpares = await fleetScopeStorage.getAllPurchaseOrders();
      const declinedSparesTruckNumbers = new Set<string>();
      for (const po of allPOsForSpares) {
        if (po.finalApproval?.toLowerCase().includes('decline') && 
            po.finalApproval?.toLowerCase().includes('sale')) {
          // Extract truck number from PO rawData using Vehicle_No column (the actual field name in the JSON)
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const truckNum = rawData['Vehicle_No'] || rawData['VEHICLE_NO'] || rawData['Truck #'] || rawData['Truck Number'] || rawData['TRUCK_NUMBER'] || '';
            if (truckNum) {
              declinedSparesTruckNumbers.add(normalizeFleetId(truckNum.toString()));
            }
          } catch {}
        }
      }
      console.log(`[All Vehicles] Found ${declinedSparesTruckNumbers.size} trucks with "Decline and Submit for Sale" in POs`);
      
      // Also add trucks from Rentals Dashboard with "Declined Repair" main status
      const allTrucksForDeclined = await fleetScopeStorage.getAllTrucks();
      let declinedDashboardCount = 0;
      for (const truck of allTrucksForDeclined) {
        if (truck.mainStatus === 'Declined Repair') {
          declinedSparesTruckNumbers.add(normalizeFleetId(truck.truckNumber));
          declinedDashboardCount++;
        }
      }
      console.log(`[All Vehicles] Added ${declinedDashboardCount} trucks with "Declined Repair" status from Dashboard (total declined set: ${declinedSparesTruckNumbers.size})`);
      
      // Fetch unassigned vehicles from Snowflake and count those NOT in PMF
      let otherLocalParkingCount = 0;
      let otherLocalParkingAssigned = 0;
      let otherLocalParkingUnassigned = 0;
      let otherLocalParkingUnassignedFound = 0; // Count of unassigned vehicles with confirmed address or recent Samsara
      let otherLocalParkingFoundConfirmedOnly = 0; // Found via Confirmed Address only
      let otherLocalParkingFoundSamsaraOnly = 0; // Found via recent Samsara only
      let otherLocalParkingFoundBoth = 0; // Found via both sources
      let otherLocalParkingDeclinedRepairs = 0; // Count of unassigned vehicles with "Decline and Submit for Sale" in POs
      let overlapWithRepairShop = 0; // Track vehicles in BOTH other local parking AND repair shop
      const overlapVehicleNumbers: string[] = []; // Store overlapping vehicle numbers
      
      // Calculate "one month ago" for Samsara recency check
      const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      
      try {
        const unassignedSql = `
          SELECT VEHICLE_NUMBER 
          FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
        `;
        const unassignedVehicles = await executeQuery<{ VEHICLE_NUMBER: string }>(unassignedSql);
        
        // Count unassigned vehicles that are NOT in PMF (other local parking locations)
        // Also exclude vehicles that are in the repair shop to avoid double-counting
        for (const vehicle of unassignedVehicles) {
          const vehicleNum = vehicle.VEHICLE_NUMBER?.toString().trim() || '';
          const normalized = normalizeFleetId(vehicleNum);
          
          // Track overlap with repair shop (for informational purposes)
          if (repairShopVehicleNumbers.has(normalized)) {
            overlapWithRepairShop++;
            overlapVehicleNumbers.push(vehicleNum);
            // Skip counting this vehicle in Other Local Parking since it's already in Repair Shop
            continue;
          }
          
          // If vehicle is not in PMF set, it's in "other local parking"
          if (!pmfAssetIds.has(normalized)) {
            otherLocalParkingCount++;
            // Check if this vehicle is assigned or unassigned in fleet data
            const isAssigned = fleetAssignmentMap.get(normalized);
            if (isAssigned === true) {
              otherLocalParkingAssigned++;
            } else {
              otherLocalParkingUnassigned++;
              
              // Check if this unassigned vehicle has a "found" location
              // (confirmed address OR Samsara within last month)
              const hasConfirmedAddress = spareVehicleLocationMap.has(normalized);
              const samsaraInfo = samsaraLocationMap.get(normalized);
              let hasRecentSamsara = false;
              
              if (samsaraInfo?.timestamp) {
                const samsaraTs = parseTimestampEarly(samsaraInfo.timestamp);
                if (samsaraTs > oneMonthAgo) {
                  hasRecentSamsara = true;
                }
              }
              
              if (hasConfirmedAddress || hasRecentSamsara) {
                otherLocalParkingUnassignedFound++;
                
                // Track breakdown by source
                if (hasConfirmedAddress && hasRecentSamsara) {
                  otherLocalParkingFoundBoth++;
                } else if (hasConfirmedAddress) {
                  otherLocalParkingFoundConfirmedOnly++;
                } else {
                  otherLocalParkingFoundSamsaraOnly++;
                }
              }
              
              // Check if this unassigned vehicle is a declined repair (from POs)
              if (declinedSparesTruckNumbers.has(normalized)) {
                otherLocalParkingDeclinedRepairs++;
              }
            }
          }
        }
        
        console.log(`[All Vehicles] Found ${otherLocalParkingDeclinedRepairs} declined repairs out of ${otherLocalParkingUnassigned} unassigned spares`);
        
        if (overlapWithRepairShop > 0) {
          console.log(`[All Vehicles] Found ${overlapWithRepairShop} vehicles in BOTH "Other Local Parking" and "Repair Shop": ${overlapVehicleNumbers.slice(0, 10).join(', ')}${overlapVehicleNumbers.length > 10 ? '...' : ''}`);
        }
      } catch (err: any) {
        console.error("Error fetching unassigned vehicles for other local parking:", err?.message || err);
      }
      let repairShopTotal = 0;
      let repairShopAssigned = 0;
      let repairShopUnassigned = 0;
      let repairShopNotInFleet = 0;
      const repairShopAssignedByStatus: Record<string, number> = {};
      const repairShopUnassignedByStatus: Record<string, number> = {};
      
      // 6 Category counts - each split by assigned/unassigned
      const repairCategories = {
        requiringEstimate: { assigned: 0, unassigned: 0 },
        needEstimateApproval: { assigned: 0, unassigned: 0 },
        awaitingPickup: { assigned: 0, unassigned: 0 },
        undergoingRepairs: { assigned: 0, unassigned: 0 },
        caseByCaseTroubleshooting: { assigned: 0, unassigned: 0 },
        approvedForSale: { assigned: 0, unassigned: 0 }
      };
      
      // Get PO data for "Decline and Submit for Sale" trucks
      const allPOs = await fleetScopeStorage.getAllPurchaseOrders();
      const declineAndSaleTruckNumbers = new Set<string>();
      for (const po of allPOs) {
        if (po.finalApproval?.toLowerCase().includes('decline') && 
            po.finalApproval?.toLowerCase().includes('sale')) {
          // Extract truck number from PO rawData
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const truckNum = rawData['Truck #'] || rawData['Truck Number'] || rawData['TRUCK_NUMBER'] || '';
            if (truckNum) {
              declineAndSaleTruckNumbers.add(normalizeFleetId(truckNum.toString()));
            }
          } catch {}
        }
      }
      
      // Fetch BYOV technicians from external API
      let byovData: {
        totalEnrolled: number;
        assigned: number;
        unassigned: number;
        notInFleet: number;
        tpmsAssigned: number;
        tpmsNotFound: number;
        technicians: Array<{
          name: string;
          truckId: string;
          location: string;
          enrollmentStatus: string;
          assignedInFleet: boolean;
          inTpms: boolean;
        }>;
      } = {
        totalEnrolled: 0,
        assigned: 0,
        unassigned: 0,
        notInFleet: 0,
        tpmsAssigned: 0,
        tpmsNotFound: 0,
        technicians: []
      };
      
      try {
        const byovResponse = await fetch("https://byovdashboard.replit.app/api/external/technicians", {
          headers: { "Accept": "application/json" }
        });
        
        if (byovResponse.ok) {
          const byovJson = await byovResponse.json();
          if (byovJson.success && byovJson.technicians) {
            // Filter only enrolled technicians
            const enrolledTechs = byovJson.technicians.filter(
              (t: any) => t.enrollmentStatus?.toLowerCase() === 'enrolled'
            );
            
            byovData.totalEnrolled = enrolledTechs.length;
            
            // Collect BYOV truck IDs to query TPMS_EXTRACT
            const byovTruckIds = enrolledTechs.map((t: any) => t.truckId?.toString().trim() || '').filter(Boolean);
            
            // Query TPMS_EXTRACT for BYOV truck IDs with timeout
            let tpmsAssignedSet = new Set<string>();
            if (byovTruckIds.length > 0) {
              try {
                // Pad truck IDs to 6 digits for TPMS lookup (they may be stored as 088xxx)
                const paddedIds = byovTruckIds.map((id: string) => id.padStart(6, '0'));
                const quotedIds = paddedIds.map((id: string) => `'${id}'`).join(', ');
                const tpmsQuery = `
                  SELECT DISTINCT TRUCK_LU 
                  FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
                  WHERE TRUCK_LU IN (${quotedIds})
                `;
                // Add 15 second timeout to prevent blocking
                const tpmsPromise = executeQuery<{ TRUCK_LU: string }>(tpmsQuery);
                const timeoutPromise = new Promise<never>((_, reject) => 
                  setTimeout(() => reject(new Error('TPMS query timeout')), 15000)
                );
                const tpmsResults = await Promise.race([tpmsPromise, timeoutPromise]);
                tpmsAssignedSet = new Set(tpmsResults.map(r => normalizeFleetId(r.TRUCK_LU)));
              } catch (tpmsErr: any) {
                console.error("Error querying TPMS_EXTRACT for BYOV trucks:", tpmsErr?.message || tpmsErr);
              }
            }
            
            for (const tech of enrolledTechs) {
              const truckId = tech.truckId?.toString().trim() || '';
              const normalizedTruckId = normalizeFleetId(truckId);
              const inTpms = tpmsAssignedSet.has(normalizedTruckId);
              
              const techRecord = {
                name: tech.name || 'Unknown',
                truckId: truckId,
                location: tech.location || '',
                enrollmentStatus: tech.enrollmentStatus,
                assignedInFleet: false,
                inTpms: inTpms
              };
              
              // Track TPMS assignment counts
              if (inTpms) {
                byovData.tpmsAssigned++;
              } else {
                byovData.tpmsNotFound++;
              }
              
              if (fleetAssignmentMap.has(normalizedTruckId)) {
                const isAssigned = fleetAssignmentMap.get(normalizedTruckId);
                techRecord.assignedInFleet = isAssigned || false;
                
                if (isAssigned) {
                  byovData.assigned++;
                } else {
                  byovData.unassigned++;
                }
              } else {
                byovData.notInFleet++;
              }
              
              byovData.technicians.push(techRecord);
            }
          }
        }
      } catch (byovError) {
        console.error("Error fetching BYOV data for all-vehicles:", byovError);
        // Continue without BYOV data
      }
      
      for (const truck of dashboardTrucks) {
        // Skip "On Road" status vehicles
        if (truck.mainStatus === 'On Road') {
          continue;
        }
        
        repairShopTotal++;
        const normalizedTruckNum = normalizeFleetId(truck.truckNumber);
        const mainStatus = (truck.mainStatus || '').toLowerCase();
        const subStatus = (truck.subStatus || '').toLowerCase();
        const hasPickSlot = truck.pickUpSlotBooked === true;
        // repairCompleted is boolean in schema, but check for string/boolean values
        const isRepairCompleted = truck.repairCompleted === true;
        const isInDeclineAndSale = declineAndSaleTruckNumbers.has(normalizedTruckNum);
        
        // Determine if truck is assigned
        let isAssigned = false;
        let isInFleet = false;
        if (fleetAssignmentMap.has(normalizedTruckNum)) {
          isInFleet = true;
          isAssigned = fleetAssignmentMap.get(normalizedTruckNum) || false;
          const status = truck.mainStatus || 'Unknown';
          
          if (isAssigned) {
            repairShopAssigned++;
            repairShopAssignedByStatus[status] = (repairShopAssignedByStatus[status] || 0) + 1;
          } else {
            repairShopUnassigned++;
            repairShopUnassignedByStatus[status] = (repairShopUnassignedByStatus[status] || 0) + 1;
          }
        } else {
          repairShopNotInFleet++;
        }
        
        // Only categorize trucks that are in the fleet
        if (!isInFleet) continue;
        
        // Categorize into 6 categories (mutually exclusive)
        // Category 1: Vehicle requiring estimate
        // All vehicles with subStatus = "Awaiting estimate from shop"
        if (subStatus.includes('awaiting estimate from shop')) {
          if (isAssigned) repairCategories.requiringEstimate.assigned++;
          else repairCategories.requiringEstimate.unassigned++;
        }
        // Category 2: Vehicles need estimate approval
        // mainStatus = "Decision pending" (excluding those already counted in Category 1)
        else if (mainStatus.includes('decision pending')) {
          if (isAssigned) repairCategories.needEstimateApproval.assigned++;
          else repairCategories.needEstimateApproval.unassigned++;
        }
        // Category 3: Vehicles Awaiting pick up by technician
        // mainStatus = "scheduling" AND pickSlot = "yes"
        else if (mainStatus.includes('scheduling') && hasPickSlot) {
          if (isAssigned) repairCategories.awaitingPickup.assigned++;
          else repairCategories.awaitingPickup.unassigned++;
        }
        // Category 5: Vehicles requiring case by case troubleshooting
        // mainStatus = "scheduling" AND pickSlot != "yes" OR mainStatus IN ("relocate van", "tags", "in transit")
        else if ((mainStatus.includes('scheduling') && !hasPickSlot) ||
                 mainStatus.includes('relocate van') ||
                 mainStatus === 'tags' ||
                 mainStatus.includes('in transit')) {
          if (isAssigned) repairCategories.caseByCaseTroubleshooting.assigned++;
          else repairCategories.caseByCaseTroubleshooting.unassigned++;
        }
        // Category 6: Vehicles approved for sale (requiring decommissioning)
        // mainStatus = "Approved for sale" AND subStatus = "clearing Softeon Inventory" OR in declineAndSale POs
        else if ((mainStatus.includes('approved for sale') && subStatus.includes('clearing softeon inventory')) ||
                 isInDeclineAndSale) {
          if (isAssigned) repairCategories.approvedForSale.assigned++;
          else repairCategories.approvedForSale.unassigned++;
        }
        // Category 4: Vehicles undergoing repairs
        // All remaining trucks that are NOT completed go here as a catch-all
        else if (!isRepairCompleted || mainStatus.includes('repairing') || mainStatus.includes('confirming')) {
          if (isAssigned) repairCategories.undergoingRepairs.assigned++;
          else repairCategories.undergoingRepairs.unassigned++;
        }
        // Fallback: trucks that are completed but didn't match any category (shouldn't happen often)
        // These would be edge cases, but we still count them in undergoingRepairs for visibility
        else {
          if (isAssigned) repairCategories.undergoingRepairs.assigned++;
          else repairCategories.undergoingRepairs.unassigned++;
        }
      }
      
      // Build repair shop truck lookup for status determination
      const repairShopTruckMap = new Map<string, { mainStatus: string; subStatus: string; pickUpSlotBooked: boolean; repairCompleted: boolean }>();
      for (const truck of dashboardTrucks) {
        if (truck.mainStatus !== 'On Road') {
          const normalized = normalizeFleetId(truck.truckNumber);
          repairShopTruckMap.set(normalized, {
            mainStatus: truck.mainStatus || '',
            subStatus: truck.subStatus || '',
            pickUpSlotBooked: truck.pickUpSlotBooked || false,
            repairCompleted: truck.repairCompleted || false
          });
        }
      }
      
      // Build PMF lot address lookup from pmfDataset
      // Note: lot address data is stored in rawRow JSON field
      const pmfLotAddressMap = new Map<string, { address: string; city: string; state: string; zip: string; updatedAt: string | null }>();
      if (pmfDataset.rows) {
        for (const row of pmfDataset.rows) {
          if (row.assetId) {
            const status = row.status?.toLowerCase() || '';
            if (status.includes('check out') || status.includes('checked out')) {
              continue;
            }
            const normalized = normalizePmfId(row.assetId);
            // Parse rawRow to extract lot address info
            let rawData: any = {};
            if (row.rawRow) {
              try {
                rawData = JSON.parse(row.rawRow);
              } catch (e) {
                rawData = {};
              }
            }
            // Raw JSON field names from PMF API: "Location Address", "Modified Date", "Date In"
            pmfLotAddressMap.set(normalized, {
              address: rawData['Location Address'] || rawData.lotAddress || rawData.lotAddressLine1 || '',
              city: '', // Location Address contains full address string
              state: '',
              zip: '',
              updatedAt: rawData['Modified Date'] || rawData['Date In'] || rawData.modifiedDate || rawData.dateIn || (row.updatedAt ? row.updatedAt.toISOString() : null)
            });
          }
        }
      }
      
      // Helper function to parse date strings and return timestamp (or 0 if invalid)
      const parseTimestamp = (dateStr: string | null | undefined): number => {
        if (!dateStr) return 0;
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
      };
      
      // Helper function to format location from components
      const formatLocation = (address: string | null, city: string | null, state: string | null, zip: string | null): string => {
        const parts = [address, city, state, zip].filter(p => p && p.trim());
        return parts.join(', ') || '';
      };
      
      // Helper to determine repair category sub-status
      const getRepairSubStatus = (mainStatus: string, subStatus: string, hasPickSlot: boolean, isInDeclineAndSale: boolean): string => {
        const ms = mainStatus.toLowerCase();
        const ss = subStatus.toLowerCase();
        
        if (ss.includes('awaiting estimate from shop')) return 'Vehicles requiring estimate';
        if (ms.includes('decision pending')) return 'Vehicles need estimate approval';
        if (ms.includes('scheduling') && hasPickSlot) return 'Awaiting pick up by technician';
        if ((ms.includes('scheduling') && !hasPickSlot) || ms.includes('relocate van') || ms === 'tags' || ms.includes('in transit')) return 'Case by case troubleshooting';
        if ((ms.includes('approved for sale') && ss.includes('clearing softeon inventory')) || isInDeclineAndSale) return 'Approved for sale';
        return 'Undergoing repairs';
      };
      
      // Use cached technician data (populated by scheduler on startup)
      // This avoids querying Snowflake on every request
      const technicianMap = getCachedTechnicianData();
      
      // Fetch vehicle maintenance costs from database
      const maintenanceCosts = await getDb().select().from(vehicleMaintenanceCosts);
      const maintenanceCostMap = new Map<string, { formatted: string; numeric: number | null }>();
      for (const cost of maintenanceCosts) {
        // Normalize vehicle number for matching (remove leading zeros)
        const normalized = normalizeFleetId(cost.vehicleNumber);
        maintenanceCostMap.set(normalized, { 
          formatted: cost.lifetimeMaintenance || '',
          numeric: cost.lifetimeMaintenanceNumeric || null
        });
      }
      console.log(`[AllVehicles] Loaded ${maintenanceCostMap.size} maintenance cost records`);
      
      // Process each vehicle to build the vehicles array with full details
      const vehicles: Array<{
        vehicleNumber: string;
        assignmentStatus: string;
        generalStatus: string;
        subStatus: string;
        lastKnownLocation: string;
        locationSource: string;
        locationUpdatedAt: string | null;
        locationState: string;
        samsaraStatus: string;
        lastSamsaraSignal: string | null;
        secondaryLocation: string;
        secondaryLocationSource: string;
        secondaryLocationUpdatedAt: string | null;
        district: string;
        vin: string;
        makeName: string;
        modelName: string;
        interior: string;
        inventoryProductCategory: string;
        technicianName: string;
        technicianNo: string;
        technicianPhone: string;
        odometer: number | null;
        odometerDate: string | null;
        lifetimeMaintenance: string;
        lifetimeMaintenanceNumeric: number | null;
      }> = [];
      
      // Create set of unassigned vehicle numbers (from UNASSIGNED_VEHICLES table - these are in storage)
      const unassignedVehicleSet = new Set<string>();
      try {
        const unassignedSql = `SELECT VEHICLE_NUMBER FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES`;
        const unassignedVehicles = await executeQuery<{ VEHICLE_NUMBER: string }>(unassignedSql);
        for (const v of unassignedVehicles) {
          unassignedVehicleSet.add(normalizeFleetId(v.VEHICLE_NUMBER?.toString() || ''));
        }
      } catch (err) {
        console.error("Error fetching unassigned vehicles for table:", err);
      }
      
      // Pre-collect ALL GPS coordinates for reverse geocoding
      // Caching ensures we don't re-geocode the same coordinates
      const gpsToGeocode: Array<{ lat: number; lon: number; vehicleId: string }> = [];
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const vehicleNumber = normalizeFleetId(r.VEHICLE_NUMBER?.toString().trim() || '');
        const gpsLat = r.GPS_LATITUDE;
        const gpsLon = r.GPS_LONGITUDE;
        const gpsUpdate = r.GPS_LAST_UPDATE;
        
        // Collect all GPS coordinates for geocoding (cache will handle duplicates)
        if (gpsLat && gpsLon && gpsUpdate) {
          gpsToGeocode.push({ lat: gpsLat, lon: gpsLon, vehicleId: vehicleNumber });
        }
      }
      
      // Batch reverse geocode GPS coordinates (with caching)
      let gpsGeocodedMap = new Map<string, { address: string; state: string; zip: string }>();
      if (gpsToGeocode.length > 0) {
        console.log(`[AllVehicles] Reverse geocoding ${gpsToGeocode.length} GPS coordinates...`);
        const geocoded = await batchReverseGeocode(gpsToGeocode);
        for (const [vehicleId, data] of geocoded.entries()) {
          gpsGeocodedMap.set(vehicleId, {
            address: data.address,
            state: data.state,
            zip: data.zip
          });
        }
        console.log(`[AllVehicles] Geocoded ${gpsGeocodedMap.size} GPS locations`);
      }
      
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const rawVehicleNumber = r.VEHICLE_NUMBER?.toString().trim() || '';
        const vehicleNumber = normalizeFleetId(rawVehicleNumber);
        
        // Assignment Status
        const tpmsAssigned = r.TPMS_ASSIGNED;
        const isAssigned = tpmsAssigned && tpmsAssigned.toLowerCase() === 'assigned';
        const assignmentStatus = isAssigned ? 'Assigned' : 'Unassigned';
        
        // Determine General Status and Sub Status
        let generalStatus = 'On Road';
        let subStatus = '';
        
        const isPmfVehicle = pmfAssetIds.has(vehicleNumber);
        const pmfStatus = pmfStatusMap.get(vehicleNumber);
        const isInRepairShop = repairShopTruckMap.has(vehicleNumber);
        const repairTruck = repairShopTruckMap.get(vehicleNumber);
        const isInUnassignedVehicles = unassignedVehicleSet.has(vehicleNumber);
        
        if (isInRepairShop && repairTruck) {
          generalStatus = 'Vehicles in a repair shop';
          const isInDeclineAndSale = declineAndSaleTruckNumbers.has(vehicleNumber);
          subStatus = getRepairSubStatus(repairTruck.mainStatus, repairTruck.subStatus, repairTruck.pickUpSlotBooked, isInDeclineAndSale);
        } else if (isPmfVehicle && pmfStatus) {
          // Transform PMF status to scorecard naming
          const lowerPmfStatus = pmfStatus.toLowerCase().trim();
          if (lowerPmfStatus.includes('unavailable')) {
            if (isAssigned) {
              generalStatus = 'On Road';
              subStatus = '';
            } else {
              generalStatus = 'Vehicles in storage';
              subStatus = 'Unavailable';
            }
          } else if (lowerPmfStatus === 'reserved') {
            generalStatus = 'Vehicles in storage';
            subStatus = 'Reserved';
          } else {
            generalStatus = 'PMF';
            if (lowerPmfStatus.includes('locked down') && lowerPmfStatus.includes('local')) {
              subStatus = 'In process at PMF';
            } else if (lowerPmfStatus === 'available' || (lowerPmfStatus.includes('available') && !lowerPmfStatus.includes('unavailable'))) {
              subStatus = 'Available to redeploy';
            } else if (lowerPmfStatus.includes('pending pickup') || lowerPmfStatus.includes('pending pick')) {
              subStatus = 'Pending pickup';
            } else {
              subStatus = pmfStatus;
            }
          }
        } else if (isInUnassignedVehicles && !isPmfVehicle) {
          generalStatus = 'Vehicles in storage';
          subStatus = 'Other Local Parking';
        }
        
        // Determine Last Known Location by comparing timestamps from all sources
        // Sources: Snowflake (GPS, AMS, TPMS), Samsara GPS, PMF, Fleet Finder (legacy)
        let lastKnownLocation = '';
        let locationSource = '';
        let locationUpdatedAt: string | null = null;
        let locationState = '';
        
        // Collect all available location sources with their timestamps
        interface LocationCandidate {
          address: string;
          state: string;
          source: string;
          timestamp: number; // epoch ms for comparison
          timestampStr: string | null;
        }
        const candidates: LocationCandidate[] = [];
        
        // 1. Snowflake GPS data (from REPLIT_ALL_VEHICLES) - with reverse geocoding
        const gpsLat = r.GPS_LATITUDE;
        const gpsLon = r.GPS_LONGITUDE;
        const gpsUpdate = r.GPS_LAST_UPDATE;
        if (gpsLat && gpsLon && gpsUpdate) {
          const gpsTs = parseTimestamp(gpsUpdate?.toString());
          if (gpsTs > 0) {
            // Check if we have geocoded data for this vehicle
            const geocodedData = gpsGeocodedMap.get(vehicleNumber);
            let gpsAddress = `GPS: ${gpsLat}, ${gpsLon}`;
            let gpsState = '';
            
            if (geocodedData && geocodedData.address) {
              gpsAddress = geocodedData.address;
              gpsState = geocodedData.state || '';
            }
            
            candidates.push({
              address: gpsAddress,
              state: gpsState,
              source: 'GPS',
              timestamp: gpsTs,
              timestampStr: gpsUpdate?.toString() || null
            });
          }
        }
        
        // 2. Snowflake AMS data (with full street address)
        const amsAddress = r.AMS_CUR_ADDRESS;
        const amsCity = r.AMS_CUR_CITY;
        const amsState = r.AMS_CUR_STATE;
        const amsUpdate = r.AMS_LAST_UPDATE;
        if ((amsAddress || amsCity || amsState) && amsUpdate) {
          const amsTs = parseTimestamp(amsUpdate?.toString());
          if (amsTs > 0) {
            // Build full address: street, city, state
            const amsFullAddress = [amsAddress, amsCity, amsState].filter(Boolean).join(', ');
            candidates.push({
              address: amsFullAddress,
              state: amsState?.toString() || '',
              source: 'AMS',
              timestamp: amsTs,
              timestampStr: amsUpdate?.toString() || null
            });
          }
        }
        
        // 3. Snowflake TPMS data (with full street address)
        const tpmsAddress = r.LAST_TPMS_ADDRESS;
        const tpmsCity = r.LAST_TPMS_CITY;
        const tpmsState = r.LAST_TPMS_STATE;
        const tpmsUpdate = r.LAST_TPMS_LAST_UPDATE;
        if ((tpmsAddress || tpmsCity || tpmsState) && tpmsUpdate) {
          const tpmsTs = parseTimestamp(tpmsUpdate?.toString());
          if (tpmsTs > 0) {
            // Build full address: street, city, state
            const tpmsFullAddress = [tpmsAddress, tpmsCity, tpmsState].filter(Boolean).join(', ');
            candidates.push({
              address: tpmsFullAddress,
              state: tpmsState?.toString() || '',
              source: 'TPMS',
              timestamp: tpmsTs,
              timestampStr: tpmsUpdate?.toString() || null
            });
          }
        }
        
        // 4. Samsara GPS data (real-time telematics)
        const samsaraData = samsaraLocationMap.get(vehicleNumber);
        let samsaraStatus = 'Not Installed';
        let lastSamsaraSignal: string | null = null;
        
        if (samsaraData) {
          lastSamsaraSignal = samsaraData.timestamp || null;
          const samsaraTs = parseTimestamp(samsaraData.timestamp);
          
          if (samsaraTs > 0) {
            // Determine Samsara device status based on last signal age
            const now = Date.now();
            const ageHours = (now - samsaraTs) / (1000 * 60 * 60);
            
            if (ageHours <= 24) {
              samsaraStatus = 'Active';
            } else if (ageHours <= 168) { // 7 days
              samsaraStatus = 'Inactive';
            } else {
              samsaraStatus = 'Inactive/Unplugged';
            }
            
            if (samsaraData.address) {
              candidates.push({
                address: samsaraData.address,
                state: samsaraData.state || '',
                source: 'Samsara',
                timestamp: samsaraTs,
                timestampStr: samsaraData.timestamp
              });
            }
          }
        }
        
        // 5. PMF lot address data
        const pmfLotData = pmfLotAddressMap.get(vehicleNumber);
        if (pmfLotData && pmfLotData.address) {
          const pmfTs = parseTimestamp(pmfLotData.updatedAt);
          candidates.push({
            address: formatLocation(pmfLotData.address, pmfLotData.city, pmfLotData.state, pmfLotData.zip),
            state: pmfLotData.state || '',
            source: 'PMF',
            timestamp: pmfTs > 0 ? pmfTs : 0,
            timestampStr: pmfLotData.updatedAt
          });
        }
        
        // 6. Fleet Finder data (legacy fallback)
        const fleetFinderData = fleetFinderLocationMap.get(vehicleNumber);
        if (fleetFinderData && fleetFinderData.address) {
          const ffTs = parseTimestamp(fleetFinderData.updatedAt);
          let ffState = fleetFinderData.state || '';
          // Fix known data quality issue: Hot Springs, AR incorrectly tagged as AK
          if (ffState === 'AK' && fleetFinderData.address.includes('71909')) {
            ffState = 'AR';
          }
          candidates.push({
            address: fleetFinderData.address,
            state: ffState,
            source: fleetFinderData.source || 'FleetFinder',
            timestamp: ffTs > 0 ? ffTs : 0,
            timestampStr: fleetFinderData.updatedAt
          });
        }
        
        // 7. Spare Vehicle Assignment confirmed address (manually verified locations)
        const spareLocationData = spareVehicleLocationMap.get(vehicleNumber);
        if (spareLocationData && spareLocationData.confirmedAddress) {
          const spareTs = parseTimestamp(spareLocationData.addressUpdatedAt);
          // Extract state from address if possible (format: "1490 US-70, Garner, NC 27529")
          let spareState = '';
          const addressParts = spareLocationData.confirmedAddress.split(',');
          if (addressParts.length >= 3) {
            // State is typically in the second-to-last part before zip
            const stateZipPart = addressParts[addressParts.length - 1].trim();
            const stateMatch = stateZipPart.match(/^([A-Z]{2})\s+\d{5}/);
            if (stateMatch) {
              spareState = stateMatch[1];
            }
          }
          candidates.push({
            address: spareLocationData.confirmedAddress,
            state: spareState,
            source: 'Confirmed',
            timestamp: spareTs > 0 ? spareTs : 0,
            timestampStr: spareLocationData.addressUpdatedAt
          });
        }
        
        // Variables for secondary location (2nd most recent)
        let secondaryLocation = '';
        let secondaryLocationSource = '';
        let secondaryLocationUpdatedAt: string | null = null;
        
        // Select the location with the most recent timestamp
        if (candidates.length > 0) {
          // Sort by timestamp descending (most recent first)
          candidates.sort((a, b) => b.timestamp - a.timestamp);
          const winner = candidates[0];
          lastKnownLocation = winner.address;
          locationSource = winner.source;
          locationUpdatedAt = winner.timestampStr;
          
          // Capture 2nd most recent location if available
          if (candidates.length > 1) {
            const runnerUp = candidates[1];
            secondaryLocation = runnerUp.address;
            secondaryLocationSource = runnerUp.source;
            secondaryLocationUpdatedAt = runnerUp.timestampStr;
          }
          
          // Only accept state if it's a valid US state abbreviation
          if (isValidStateAbbreviation(winner.state)) {
            locationState = winner.state.trim().toUpperCase();
          }
          
          // If winning source lacks valid state (e.g., GPS coordinates), fall back to any candidate with valid state
          // This ensures the map visualization always has state data for aggregation
          if (!locationState) {
            // Try to find valid state from other candidates (they're already sorted by recency)
            for (const candidate of candidates) {
              if (isValidStateAbbreviation(candidate.state)) {
                locationState = candidate.state.trim().toUpperCase();
                break;
              }
            }
          }
        }
        
        // Additional fallback: try PMF lot data or Fleet Finder state if still missing
        if (!locationState) {
          if (pmfLotData && isValidStateAbbreviation(pmfLotData.state)) {
            locationState = pmfLotData.state.trim().toUpperCase();
          } else if (fleetFinderData && fleetFinderData.state) {
            let ffState = fleetFinderData.state;
            // Fix known data quality issue: Hot Springs, AR incorrectly tagged as AK
            if (ffState === 'AK' && fleetFinderData.address?.includes('71909')) {
              ffState = 'AR';
            }
            if (isValidStateAbbreviation(ffState)) {
              locationState = ffState.trim().toUpperCase();
            }
          }
        }
        
        // Get technician data for this vehicle
        const techData = technicianMap.get(vehicleNumber);
        
        // Get Holman odometer data for this vehicle (lookup by VIN)
        const vehicleVin = r.VIN?.toString().trim().toUpperCase() || '';
        const holmanData = holmanOdometerByVin.get(vehicleVin);
        
        // Look up lifetime maintenance cost for this vehicle
        const maintenanceData = maintenanceCostMap.get(vehicleNumber);
        const lifetimeMaintenance = maintenanceData?.formatted || '';
        const lifetimeMaintenanceNumeric = maintenanceData?.numeric || null;
        
        vehicles.push({
          vehicleNumber: rawVehicleNumber,
          assignmentStatus,
          generalStatus,
          subStatus,
          lastKnownLocation,
          locationSource,
          locationUpdatedAt,
          locationState,
          samsaraStatus,
          lastSamsaraSignal,
          secondaryLocation,
          secondaryLocationSource,
          secondaryLocationUpdatedAt,
          district: r.TRUCK_DISTRICT || '',
          vin: r.VIN || '',
          makeName: r.MAKE_NAME || '',
          modelName: r.MODEL_NAME || '',
          interior: r.INTERIOR || '',
          inventoryProductCategory: r.INVENTORY_PRODUCT_CATEGORY || '',
          technicianName: techData?.fullName || '',
          technicianNo: techData?.techNo || '',
          technicianPhone: techData?.mobilePhone || '',
          odometer: holmanData?.odometer || null,
          odometerDate: holmanData?.odometerDate || null,
          licensePlate: holmanData?.licensePlate || null,
          lifetimeMaintenance,
          lifetimeMaintenanceNumeric
        });
      }
      
      const responseData = { 
        data, 
        vehicles,
        totalCount: data.length,
        assignedCount,
        unassignedCount,
        pmf: {
          totalInPmf: pmfAssetIds.size,
          assigned: pmfAssignedCount,
          unassigned: pmfUnassignedCount,
          matchedInFleet: pmfAssignedCount + pmfUnassignedCount,
          notFoundInFleet: pmfAssetIds.size - (pmfAssignedCount + pmfUnassignedCount),
          notFoundByStatus: pmfNotFoundByStatus,
          assignedByStatus: pmfAssignedByStatus,
          unassignedByStatus: pmfUnassignedByStatus,
          otherLocalParking: {
            total: otherLocalParkingCount,
            assigned: otherLocalParkingAssigned,
            unassigned: otherLocalParkingUnassigned,
            unassignedFound: otherLocalParkingUnassignedFound,
            foundFromConfirmed: otherLocalParkingFoundConfirmedOnly,
            foundFromSamsara: otherLocalParkingFoundSamsaraOnly,
            foundFromBoth: otherLocalParkingFoundBoth,
            declinedRepairs: otherLocalParkingDeclinedRepairs,
            overlapWithRepairShop: overlapWithRepairShop,
            overlapVehicles: overlapVehicleNumbers.slice(0, 20)
          }
        },
        repairShop: {
          total: repairShopTotal,
          assigned: repairShopAssigned,
          unassigned: repairShopUnassigned,
          notInFleet: repairShopNotInFleet,
          matchedInFleet: repairShopAssigned + repairShopUnassigned,
          assignedByStatus: repairShopAssignedByStatus,
          unassignedByStatus: repairShopUnassignedByStatus,
          categories: repairCategories
        },
        byov: byovData,
        rentalCount: dashboardTrucks.length,
        rentalTruckNumbers: dashboardTrucks.map(t => t.truckNumber)
      };

      allVehiclesCache = { data: responseData, timestamp: Date.now() };
      res.json(responseData);
    } catch (error: any) {
      console.error("Error fetching all vehicles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================
  // SAMSARA API ROUTES
  // =====================

  // Test Samsara API connection
  app.get("/samsara/test", async (req, res) => {
    try {
      const result = await testSamsaraConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing Samsara connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get Samsara vehicle locations
  app.get("/samsara/locations", async (req, res) => {
    try {
      const locations = await fetchSamsaraLocations();
      const locationArray = Array.from(locations.entries()).map(([vehicleNumber, data]) => ({
        vehicleNumber,
        ...data
      }));
      res.json({ 
        success: true, 
        count: locations.size,
        locations: locationArray 
      });
    } catch (error: any) {
      console.error("Error fetching Samsara locations:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // =====================
  // UPS TRACKING ROUTES
  // =====================

  // Test UPS API connection
  app.get("/ups/test", async (req, res) => {
    try {
      const result = await testUPSConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing UPS connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all tracking records (optionally filtered by truck)
  app.get("/tracking", async (req, res) => {
    try {
      const truckId = req.query.truckId as string | undefined;
      const records = await fleetScopeStorage.getTrackingRecords(truckId);
      res.json(records);
    } catch (error: any) {
      console.error("Error fetching tracking records:", error);
      res.status(500).json({ message: "Failed to fetch tracking records" });
    }
  });

  // Get tracking records for a specific truck
  app.get("/trucks/:id/tracking", async (req, res) => {
    try {
      const records = await fleetScopeStorage.getTrackingRecords(req.params.id);
      res.json(records);
    } catch (error: any) {
      console.error("Error fetching truck tracking records:", error);
      res.status(500).json({ message: "Failed to fetch tracking records" });
    }
  });

  // Add a new tracking record
  app.post("/tracking", async (req, res) => {
    try {
      const validatedData = insertTrackingRecordSchema.parse(req.body);
      
      // Check if tracking number already exists
      const existing = await fleetScopeStorage.getTrackingRecordByNumber(validatedData.trackingNumber);
      if (existing) {
        return res.status(400).json({ message: "Tracking number already exists" });
      }
      
      const record = await fleetScopeStorage.createTrackingRecord(validatedData);
      res.status(201).json(record);
    } catch (error: any) {
      console.error("Error creating tracking record:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to create tracking record" });
    }
  });

  // Track a package (lookup from UPS and update record)
  app.post("/tracking/:id/refresh", async (req, res) => {
    try {
      const record = await fleetScopeStorage.getTrackingRecord(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Tracking record not found" });
      }
      
      // Check rate limit for this tracking number
      const rateLimitCheck = checkRateLimit(record.trackingNumber);
      if (!rateLimitCheck.allowed) {
        const retryAfterSeconds = Math.ceil((rateLimitCheck.retryAfterMs || 60000) / 1000);
        return res.status(429).json({ 
          message: `Rate limited. Please wait ${retryAfterSeconds} seconds before refreshing this tracking number again.`,
          retryAfterMs: rateLimitCheck.retryAfterMs 
        });
      }
      
      try {
        const trackingResult = await trackPackage(record.trackingNumber);
        
        // Update the record with tracking info
        const updatedRecord = await fleetScopeStorage.updateTrackingRecord(record.id, {
          lastStatus: trackingResult.status,
          lastStatusDescription: trackingResult.statusDescription,
          lastLocation: trackingResult.location,
          estimatedDelivery: trackingResult.estimatedDelivery,
          deliveredAt: trackingResult.deliveredAt,
          lastCheckedAt: new Date(),
          lastError: trackingResult.error || null,
          errorAt: trackingResult.error ? new Date() : null,
        });
        
        res.json({
          record: updatedRecord,
          activities: trackingResult.activities,
        });
      } catch (trackError: any) {
        // Update record with error info
        await fleetScopeStorage.updateTrackingRecord(record.id, {
          lastError: trackError.message,
          errorAt: new Date(),
          lastCheckedAt: new Date(),
        });
        
        res.status(500).json({ message: trackError.message });
      }
    } catch (error: any) {
      console.error("Error refreshing tracking:", error);
      res.status(500).json({ message: "Failed to refresh tracking" });
    }
  });

  // Direct track lookup (without saving to database)
  app.get("/ups/track/:trackingNumber", async (req, res) => {
    try {
      const result = await trackPackage(req.params.trackingNumber);
      res.json(result);
    } catch (error: any) {
      console.error("Error tracking package:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a tracking record
  app.delete("/tracking/:id", async (req, res) => {
    try {
      await fleetScopeStorage.deleteTrackingRecord(req.params.id);
      res.json({ message: "Tracking record deleted" });
    } catch (error: any) {
      console.error("Error deleting tracking record:", error);
      res.status(500).json({ message: "Failed to delete tracking record" });
    }
  });

  // Bulk refresh all active UPS tracking records
  app.post("/tracking/refresh-all", async (req, res) => {
    try {
      const allRecords = await fleetScopeStorage.getTrackingRecords();
      
      // Filter to only non-delivered records
      const activeRecords = allRecords.filter(r => r.lastStatus !== "D");
      
      if (activeRecords.length === 0) {
        return res.json({ 
          message: "No active tracking records to refresh",
          updated: 0,
          failed: 0,
          total: 0
        });
      }
      
      console.log(`[UPS Bulk Refresh] Starting refresh for ${activeRecords.length} active tracking records...`);
      
      let updated = 0;
      let failed = 0;
      const errors: string[] = [];
      
      // Process with delay between calls to avoid rate limiting
      for (const record of activeRecords) {
        try {
          const trackingResult = await trackPackage(record.trackingNumber);
          
          await fleetScopeStorage.updateTrackingRecord(record.id, {
            lastStatus: trackingResult.status,
            lastStatusDescription: trackingResult.statusDescription,
            lastLocation: trackingResult.location,
            estimatedDelivery: trackingResult.estimatedDelivery,
            deliveredAt: trackingResult.deliveredAt,
            lastCheckedAt: new Date(),
            lastError: trackingResult.error || null,
            errorAt: trackingResult.error ? new Date() : null,
          });
          
          updated++;
          console.log(`[UPS Bulk Refresh] Updated ${record.trackingNumber}: ${trackingResult.statusDescription}`);
          
          // Small delay between API calls to avoid rate limiting (500ms)
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          failed++;
          errors.push(`${record.trackingNumber}: ${error.message}`);
          console.error(`[UPS Bulk Refresh] Failed ${record.trackingNumber}:`, error.message);
          
          // Update record with error
          await fleetScopeStorage.updateTrackingRecord(record.id, {
            lastError: error.message,
            errorAt: new Date(),
            lastCheckedAt: new Date(),
          });
        }
      }
      
      console.log(`[UPS Bulk Refresh] Complete: ${updated} updated, ${failed} failed`);
      
      res.json({
        message: `Refreshed ${updated} tracking records`,
        updated,
        failed,
        total: activeRecords.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error: any) {
      console.error("Error in bulk tracking refresh:", error);
      res.status(500).json({ message: "Failed to refresh tracking records" });
    }
  });

  // PMF (Park My Fleet) endpoints
  
  // GET PMF dataset - returns the latest import with rows and unique statuses
  app.get("/pmf/summary", async (req, res) => {
    try {
      const dataset = await fleetScopeStorage.getPmfDataset();
      if (!dataset.import || !dataset.rows) {
        return res.json({ totalVehicles: 0, byStatus: {}, pipelineFlow: [] });
      }
      
      const byStatus: Record<string, number> = {};
      for (const row of dataset.rows) {
        const status = row.status || 'Unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      }
      
      const inProcessCount = (byStatus["Locked Down Local"] || 0) + (byStatus["Locked down local"] || 0) + (byStatus["Locked down off lot"] || 0);
      const approvedPickupCount = (byStatus["Approved to Pick Up"] || 0) + (byStatus["Pending Pickup"] || 0);
      
      const pipelineFlow = [
        { status: "Pending Arrival", count: byStatus["Pending Arrival"] || 0 },
        { status: "In Process", count: inProcessCount, filterStatuses: ["Locked Down Local", "Locked down local", "Locked down off lot"] },
        { status: "Available", count: byStatus["Available"] || 0 },
        { status: "Approved for Pick Up", count: approvedPickupCount, filterStatuses: ["Approved to Pick Up", "Pending Pickup"] },
        { status: "Deployed", count: byStatus["Unavailable"] || 0, filterStatuses: ["Unavailable"] },
        { status: "Reserved", count: byStatus["Reserved"] || 0 },
      ];
      
      res.json({
        totalVehicles: dataset.rows.length,
        byStatus,
        pipelineFlow,
      });
    } catch (error: any) {
      console.error("Error fetching PMF summary:", error);
      res.status(500).json({ message: "Failed to fetch PMF summary" });
    }
  });

  app.get("/pmf", async (req, res) => {
    try {
      const dataset = await fleetScopeStorage.getPmfDataset();
      
      if (!dataset.import) {
        return res.status(204).send(); // No content - no import exists yet
      }
      
      // Parse JSON strings back to objects for the response
      const response = {
        import: {
          ...dataset.import,
          headers: dataset.import.headers ? JSON.parse(dataset.import.headers) : [],
          activityHeaders: dataset.import.activityHeaders ? JSON.parse(dataset.import.activityHeaders) : null,
        },
        rows: dataset.rows.map(row => ({
          ...row,
          rawRow: row.rawRow ? JSON.parse(row.rawRow) : {},
        })),
        uniqueStatuses: dataset.uniqueStatuses,
      };
      
      res.json(response);
    } catch (error: any) {
      console.error("Error fetching PMF dataset:", error);
      res.status(500).json({ message: "Failed to fetch PMF data" });
    }
  });
  
  // GET PMF status events - for status flow tracking
  app.get("/pmf/status-events", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let start: Date | undefined;
      let end: Date | undefined;
      
      if (startDate && typeof startDate === 'string') {
        start = new Date(startDate);
      }
      if (endDate && typeof endDate === 'string') {
        end = new Date(endDate);
      }
      
      const events = await fleetScopeStorage.getPmfStatusEvents(start, end);
      res.json(events);
    } catch (error: any) {
      console.error("Error fetching PMF status events:", error);
      res.status(500).json({ message: "Failed to fetch PMF status events" });
    }
  });
  
  // POST PMF status events backfill - seed status events from existing PMF data using dateIn timestamps
  app.post("/pmf/status-events/backfill", async (req, res) => {
    try {
      const result = await fleetScopeStorage.backfillPmfStatusEvents();
      res.json({
        success: true,
        message: `Backfilled ${result.eventsCreated} status events from existing PMF data`,
        ...result,
      });
    } catch (error: any) {
      console.error("Error backfilling PMF status events:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // GET days in "Locked Down Local" status for each vehicle (stops counting when status changes)
  app.get("/pmf/days-in-status", async (req, res) => {
    try {
      // Calculate days spent in "Locked Down Local" status
      // Count freezes when vehicle exits to a different status
      // Value remains fixed after exit (does not reset on re-entry)
      const result = await getDb().execute(sql`
        WITH latest_locked_down AS (
          -- Find the most recent "Locked Down Local" entry for each vehicle
          SELECT 
            asset_id,
            effective_at as locked_down_since,
            ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY effective_at DESC) as rn
          FROM pmf_status_events
          WHERE LOWER(REPLACE(status, '-', '')) LIKE '%locked%down%local%'
        ),
        exit_events AS (
          -- For each vehicle's latest locked down entry, find the earliest subsequent exit
          SELECT 
            l.asset_id,
            l.locked_down_since,
            MIN(e.effective_at) as exit_date
          FROM latest_locked_down l
          LEFT JOIN pmf_status_events e ON e.asset_id = l.asset_id 
            AND e.effective_at > l.locked_down_since
            AND NOT (LOWER(REPLACE(e.status, '-', '')) LIKE '%locked%down%local%')
          WHERE l.rn = 1
          GROUP BY l.asset_id, l.locked_down_since
        )
        SELECT 
          asset_id as "assetId",
          locked_down_since as "lockedDownSince",
          GREATEST(0, EXTRACT(DAYS FROM COALESCE(exit_date, NOW()) - locked_down_since))::integer as "daysInStatus"
        FROM exit_events
        ORDER BY locked_down_since ASC
      `);
      
      const daysMap: Record<string, { lockedDownSince: string; daysInStatus: number }> = {};
      for (const row of result.rows as Record<string, unknown>[]) {
        daysMap[row.assetId] = {
          lockedDownSince: row.lockedDownSince,
          daysInStatus: row.daysInStatus || 0,
        };
      }
      
      res.json({ success: true, data: daysMap });
    } catch (error: any) {
      console.error("Error fetching days in status:", error);
      res.status(500).json({ success: false, message: "Failed to fetch days in status" });
    }
  });
  
  app.get("/pmf/registration-stickers-needed", async (req, res) => {
    try {
      const result = await getDb().execute(sql`
        SELECT DISTINCT r.asset_id AS "assetId"
        FROM pmf_rows r
        JOIN pmf_activity_logs a ON a.asset_id = r.asset_id
        WHERE LOWER(r.status) = 'locked down local'
          AND (LOWER(a.action) LIKE '%registration stickers needed%'
               OR LOWER(a.type_description) LIKE '%registration stickers needed%')
      `);
      const assetIds = (result.rows as Record<string, unknown>[]).map(row => row.assetId);
      res.json({ success: true, assetIds });
    } catch (error: any) {
      console.error("Error fetching PMF registration stickers needed:", error);
      res.status(500).json({ success: false, message: "Failed to fetch data" });
    }
  });

  // POST PMF import - replaces all existing data with new import
  app.post("/pmf/import", async (req, res) => {
    try {
      const importSchema = z.object({
        filename: z.string().min(1, "Filename is required"),
        headers: z.array(z.string()),
        activityHeaders: z.object({
          action: z.string(),
          activity: z.string(),
          activityDate: z.string(),
        }),
        rows: z.array(z.object({
          assetId: z.string(),
          status: z.string(),
          rawRow: z.record(z.string()),
        })),
        importedBy: z.string().optional(),
      });
      
      const validatedData = importSchema.parse(req.body);
      
      const newImport = await fleetScopeStorage.replacePmfData({
        filename: validatedData.filename,
        headers: validatedData.headers,
        activityHeaders: validatedData.activityHeaders,
        rows: validatedData.rows,
        importedBy: validatedData.importedBy,
      });
      
      // Extract unique statuses from the imported rows
      const statusSet = new Set<string>();
      validatedData.rows.forEach(row => {
        if (row.status && row.status.trim()) {
          statusSet.add(row.status.trim());
        }
      });
      
      res.status(201).json({
        import: {
          ...newImport,
          headers: validatedData.headers,
          activityHeaders: validatedData.activityHeaders,
        },
        rowCount: validatedData.rows.length,
        uniqueStatuses: Array.from(statusSet).sort(),
      });
    } catch (error: any) {
      console.error("Error importing PMF data:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Failed to import PMF data" });
    }
  });

  // =====================
  // PMF PARQ API ROUTES
  // =====================

  // Test PARQ API connection
  app.get("/pmf/parq/test", async (req, res) => {
    try {
      const result = await parqApi.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing PARQ connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all vehicles from PARQ API
  app.get("/pmf/parq/vehicles", async (req, res) => {
    try {
      const vehicles = await parqApi.getVehicles();
      res.json({ success: true, data: vehicles, count: vehicles.length });
    } catch (error: any) {
      console.error("Error fetching PARQ vehicles:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all vehicle statuses from PARQ API
  app.get("/pmf/parq/statuses", async (req, res) => {
    try {
      const statuses = await parqApi.getVehicleStatuses();
      res.json({ success: true, data: statuses });
    } catch (error: any) {
      console.error("Error fetching PARQ statuses:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all lots (locations) from PARQ API
  app.get("/pmf/parq/lots", async (req, res) => {
    try {
      const lots = await parqApi.getLots();
      res.json({ success: true, data: lots, count: lots.length });
    } catch (error: any) {
      console.error("Error fetching PARQ lots:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Fetch complete PMF data (vehicles with statuses and locations resolved)
  app.get("/pmf/parq/sync", async (req, res) => {
    try {
      const data = await parqApi.fetchAllPmfData();
      res.json({ success: true, ...data });
    } catch (error: any) {
      console.error("Error syncing PARQ data:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Sync PARQ data into local PMF database (replaces CSV import)
  app.post("/pmf/parq/sync", async (req, res) => {
    try {
      const importedBy = req.body.importedBy || "PARQ API";
      
      // Fetch all data from PARQ API
      const data = await parqApi.fetchAllPmfData();
      
      // Transform vehicles into PMF row format
      // Include internal PARQ ID for activity log fetching
      const rows = data.vehicles.map(v => ({
        assetId: v.assetId,
        status: v.status,
        dateIn: v.dateIn, // Pass dateIn for status event timestamp
        rawRow: {
          "id": v.id, // Internal PARQ vehicle ID for activity log API
          "Asset ID": v.assetId,
          "Status": v.status,
          "Status ID": String(v.statusId),
          "VIN/Descriptor": v.descriptor,
          "Year": v.year,
          "Make": v.make,
          "Model": v.model,
          "Location": v.location || "",
          "Location Address": v.locationDetails 
            ? `${v.locationDetails.addressLine1}, ${v.locationDetails.city}, ${v.locationDetails.state} ${v.locationDetails.zipCode}`
            : "",
          "Date In": v.dateIn || "",
          "Date Out": v.dateOut || "",
          "Mileage": v.mileage ? String(v.mileage) : "",
          "Created Date": v.createdDate,
          "Modified Date": v.modifiedDate || "",
        },
      }));
      
      // Define headers for the PMF table display
      const headers = [
        "Asset ID",
        "Status", 
        "VIN/Descriptor",
        "Year",
        "Make",
        "Model",
        "Location",
        "Location Address",
        "Date In",
        "Date Out",
        "Mileage",
      ];
      
      // Replace PMF data in database
      const newImport = await fleetScopeStorage.replacePmfData({
        filename: `PARQ API Sync - ${new Date().toISOString()}`,
        headers,
        activityHeaders: { action: "", activity: "", activityDate: "" },
        rows,
        importedBy,
      });
      
      // Extract unique statuses
      const uniqueStatuses = Array.from(new Set(rows.map(r => r.status))).filter(Boolean).sort();
      
      res.status(201).json({
        success: true,
        import: {
          ...newImport,
          headers,
        },
        vehicleCount: data.vehicles.length,
        uniqueStatuses,
        summary: data.summary,
      });
    } catch (error: any) {
      console.error("Error syncing PARQ data to database:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =====================
  // PMF ACTIVITY LOG ROUTES
  // =====================

  // Get activity logs for a specific vehicle by asset ID
  app.get("/pmf/activity-logs/:assetId", async (req, res) => {
    try {
      const { assetId } = req.params;
      const logs = await fleetScopeStorage.getPmfActivityLogs(assetId);
      res.json({ success: true, logs, count: logs.length });
    } catch (error: any) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get checkin/tool inspection data for a specific vehicle by asset ID or PARQ ID
  app.get("/pmf/checkin/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      console.log(`[PMF Checkin] Fetching checkin data for vehicle: ${vehicleId}`);
      const checkinData = await parqApi.getVehicleCheckin(vehicleId);
      res.json({ success: true, checkin: checkinData });
    } catch (error: any) {
      console.error("Error fetching checkin data:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get condition report for a specific vehicle by asset ID or PARQ ID
  app.get("/pmf/conditionreport/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      console.log(`[PMF ConditionReport] Fetching condition report for vehicle: ${vehicleId}`);
      
      // Check if this is an asset ID (like "036400") and look up the PARQ internal ID
      let parqId = vehicleId;
      
      // Normalize asset ID by stripping leading zeros for matching
      const normalizedVehicleId = vehicleId.replace(/^0+/, '') || vehicleId;
      
      // Try to find the PARQ internal ID from PMF data if this looks like an asset ID
      const pmfData = await fleetScopeStorage.getPmfDataset();
      const matchingRow = pmfData.rows.find(row => {
        const normalizedAssetId = row.assetId?.replace(/^0+/, '') || row.assetId;
        return normalizedAssetId === normalizedVehicleId || row.assetId === vehicleId;
      });
      
      if (matchingRow && matchingRow.rawRow) {
        try {
          // rawRow is stored as JSON string in database, need to parse it
          const rawRow = typeof matchingRow.rawRow === 'string' 
            ? JSON.parse(matchingRow.rawRow) 
            : matchingRow.rawRow;
          if (rawRow.id && typeof rawRow.id === 'number') {
            parqId = String(rawRow.id);
            console.log(`[PMF ConditionReport] Resolved asset ${vehicleId} to PARQ ID ${parqId}`);
          }
        } catch (e) {
          console.warn(`[PMF ConditionReport] Failed to parse rawRow for asset ${vehicleId}, using original ID`);
        }
      }
      
      const reportData = await parqApi.getVehicleConditionReport(parqId);
      res.json({ success: true, conditionreport: reportData });
    } catch (error: any) {
      console.error("Error fetching condition report:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bulk export tool audit data for all PMF vehicles
  app.get("/pmf/tool-audit/bulk-export", async (req, res) => {
    try {
      console.log("[PMF Tool Audit] Starting bulk export for all vehicles...");
      
      // Get all PMF vehicles from storage
      const pmfData = await fleetScopeStorage.getPmfDataset();
      const vehicles = pmfData.rows || [];
      
      console.log(`[PMF Tool Audit] Found ${vehicles.length} PMF vehicles`);
      
      // Tool audit sections (from ToolAudit.tsx)
      const toolAuditSections = new Set([
        'All Industries', 'Cooking', 'HVAC', 'Laundry', 'Lawn & Garden',
        'Microwave', 'Refrigeration', 'Refrigeration /HVAC', 'Refrigeration/HVAC',
        'Water Heater', 'Hand Tools', 'Refrigerant Tank'
      ]);
      const vehicleConditionSections = new Set([
        'Admin', 'Driver Front Outside', 'Driver Front Inside', 'Front',
        'Underside', 'Passenger Front Outside', 'Passenger Rear Outside',
        'Back', 'Cargo', 'Drivers Rear Outside', 'Other'
      ]);
      
      const isToolSection = (section: string): boolean => {
        if (toolAuditSections.has(section)) return true;
        if (section.startsWith('Hand Tools')) return true;
        if (section.startsWith('All Industries')) return true;
        return !vehicleConditionSections.has(section);
      };
      
      // Function to determine if tool is present
      const isToolPresent = (tool: any): boolean | null => {
        if (tool.isFailure === true) return false;
        if (tool.isFailure === false) return true;
        if (tool.isFailure === null && tool.hasPhoto) return true;
        return null;
      };
      
      interface ToolAuditRow {
        assetId: string;
        vin: string;
        section: string;
        toolName: string;
        systemNumber: string;
        count: string;
        hasPhoto: string;
        photoUrl: string;
        status: string;
        toolPresent: string;
        notes: string;
      }
      
      const allTools: ToolAuditRow[] = [];
      let processedCount = 0;
      let errorCount = 0;
      
      // Process vehicles in batches to avoid overwhelming the API
      const batchSize = 10;
      for (let i = 0; i < vehicles.length; i += batchSize) {
        const batch = vehicles.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (vehicle) => {
          const assetId = vehicle.assetId;
          if (!assetId) return;
          
          try {
            // Get PARQ internal ID and VIN from rawRow
            let parqId = assetId;
            let vin = '';
            if (vehicle.rawRow) {
              try {
                const rawRow = typeof vehicle.rawRow === 'string' 
                  ? JSON.parse(vehicle.rawRow) 
                  : vehicle.rawRow;
                if (rawRow.id && typeof rawRow.id === 'number') {
                  parqId = String(rawRow.id);
                }
                // VIN is stored in descriptor field
                if (rawRow.descriptor) {
                  vin = rawRow.descriptor;
                }
              } catch (e) {}
            }
            
            // Fetch condition report
            const reports = await parqApi.getVehicleConditionReport(parqId);
            const reportsArr = Array.isArray(reports) ? reports : [reports];
            
            // Combine all answers
            const allAnswers: any[] = [];
            reportsArr.forEach((report: any) => {
              if (report && Array.isArray(report.answers)) {
                allAnswers.push(...report.answers);
              }
            });
            
            // Parse tools from answers
            for (const answer of allAnswers) {
              const section = answer.sectionTitle || 'Other';
              if (answer.questionTitle && isToolSection(section)) {
                const quotedNameMatch = answer.questionTitle.match(/'([^']+)'/);
                if (quotedNameMatch || 
                    answer.questionTitle.includes('Weigh the Refrigerant') ||
                    answer.questionTitle.includes('tools that exist')) {
                  
                  const skuMatch = answer.questionTitle.match(/\.?\s*([A-Z]{2}-\d{3})\s*$/);
                  const tool = {
                    toolName: quotedNameMatch ? quotedNameMatch[1] : answer.questionTitle,
                    systemNumber: skuMatch ? skuMatch[1] : null,
                    section: section,
                    count: answer.freetextValue ? parseInt(answer.freetextValue, 10) || null : null,
                    hasPhoto: !!answer.pictureUrl,
                    isFailure: answer.dropdownValue?.isFailure ?? null,
                    pictureUrl: answer.pictureUrl,
                    note: answer.note,
                  };
                  
                  const present = isToolPresent(tool);
                  
                  allTools.push({
                    assetId: assetId,
                    vin: vin,
                    section: tool.section,
                    toolName: tool.toolName,
                    systemNumber: tool.systemNumber || '',
                    count: tool.count !== null ? String(tool.count) : '',
                    hasPhoto: tool.hasPhoto ? 'Yes' : 'No',
                    photoUrl: tool.pictureUrl || '',
                    status: tool.isFailure === true ? 'Failure' : tool.isFailure === false ? 'Pass' : 'Not Checked',
                    toolPresent: present === true ? 'Yes' : present === false ? 'No' : 'Unknown',
                    notes: tool.note || '',
                  });
                }
              }
            }
            
            processedCount++;
          } catch (error: any) {
            console.warn(`[PMF Tool Audit] Failed to fetch report for ${assetId}: ${error.message}`);
            errorCount++;
          }
        }));
        
        // Log progress
        if ((i + batchSize) % 50 === 0 || i + batchSize >= vehicles.length) {
          console.log(`[PMF Tool Audit] Processed ${Math.min(i + batchSize, vehicles.length)}/${vehicles.length} vehicles`);
        }
      }
      
      console.log(`[PMF Tool Audit] Bulk export complete: ${allTools.length} tools from ${processedCount} vehicles (${errorCount} errors)`);
      
      // Calculate summary stats
      const presentCount = allTools.filter(t => t.toolPresent === 'Yes').length;
      const notPresentCount = allTools.filter(t => t.toolPresent === 'No').length;
      const unknownCount = allTools.filter(t => t.toolPresent === 'Unknown').length;
      
      res.json({
        success: true,
        data: allTools,
        summary: {
          totalTools: allTools.length,
          vehiclesProcessed: processedCount,
          vehiclesWithErrors: errorCount,
          toolsPresent: presentCount,
          toolsNotPresent: notPresentCount,
          toolsUnknown: unknownCount,
        }
      });
    } catch (error: any) {
      console.error("Error in bulk tool audit export:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get activity sync metadata (last sync info)
  app.get("/pmf/activity-sync-meta", async (req, res) => {
    try {
      const meta = await fleetScopeStorage.getPmfActivitySyncMeta();
      res.json({ success: true, meta });
    } catch (error: any) {
      console.error("Error fetching activity sync meta:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Sync activity logs from PARQ API for all PMF vehicles
  app.post("/pmf/sync-activity-logs", async (req, res) => {
    try {
      console.log('[Activity Sync] Starting activity log sync from PARQ API...');
      
      // Get all PMF vehicles with their internal PARQ IDs
      const pmfData = await fleetScopeStorage.getPmfDataset();
      const vehicleMap: Array<{ parqId: number; assetId: string }> = [];
      
      for (const row of pmfData.rows) {
        if (row.assetId && row.rawRow) {
          try {
            const rawData = JSON.parse(row.rawRow);
            // Use internal PARQ ID if available (from PARQ API sync)
            if (rawData.id && typeof rawData.id === 'number') {
              vehicleMap.push({ parqId: rawData.id, assetId: row.assetId });
            }
          } catch (e) {
            // Skip rows with invalid JSON
          }
        }
      }
      
      console.log(`[Activity Sync] Found ${vehicleMap.length} vehicles with PARQ IDs to sync...`);
      
      if (vehicleMap.length === 0) {
        return res.status(200).json({
          success: true,
          vehiclesSynced: 0,
          logsFetched: 0,
          message: 'No PMF vehicles with PARQ IDs found. Please sync from PARQ API first.',
        });
      }
      
      // Clear existing activity logs before syncing fresh data
      await fleetScopeStorage.clearPmfActivityLogs();
      
      // Fetch activity logs from PARQ API using internal PARQ IDs
      const activityLogMap = await parqApi.fetchActivityLogsForVehicles(
        vehicleMap.map(v => v.parqId)
      );
      
      // Convert to storage format and insert
      let totalLogsFetched = 0;
      const allLogs: Array<{
        vehicleId: number;
        assetId: string;
        activityDate: Date;
        action: string;
        activityType: number;
        typeDescription: string;
        workOrderId: number | null;
      }> = [];
      
      for (const { parqId, assetId } of vehicleMap) {
        const logs = activityLogMap.get(parqId) || [];
        for (const log of logs) {
          allLogs.push({
            vehicleId: parqId,
            assetId,
            activityDate: new Date(log.date),
            action: log.action,
            activityType: log.type,
            typeDescription: log.typeDescription,
            workOrderId: log.workOrderId,
          });
        }
        totalLogsFetched += logs.length;
      }
      
      // Insert all logs
      const result = await fleetScopeStorage.upsertPmfActivityLogs(allLogs);
      
      // Update sync metadata
      const syncMeta = await fleetScopeStorage.updatePmfActivitySyncMeta(
        vehicleMap.length,
        totalLogsFetched,
        'success'
      );
      
      console.log(`[Activity Sync] Synced ${totalLogsFetched} activity logs for ${vehicleMap.length} vehicles`);
      
      res.status(200).json({
        success: true,
        vehiclesSynced: vehicleMap.length,
        logsFetched: totalLogsFetched,
        syncMeta,
      });
    } catch (error: any) {
      console.error("[Activity Sync] Error syncing activity logs:", error);
      
      // Record failed sync
      await fleetScopeStorage.updatePmfActivitySyncMeta(0, 0, 'failed', error.message);
      
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // =====================
  // METRICS ROUTES
  // =====================

  // Capture today's metrics snapshot
  app.post("/metrics/capture", async (req, res) => {
    try {
      const capturedBy = req.body.capturedBy || "System";
      const snapshot = await fleetScopeStorage.captureMetricsSnapshot(capturedBy);
      res.status(201).json(snapshot);
    } catch (error: any) {
      console.error("Error capturing metrics snapshot:", error);
      res.status(500).json({ message: "Failed to capture metrics snapshot" });
    }
  });

  // Get all metrics snapshots (optionally with date range)
  app.get("/metrics", async (req, res) => {
    try {
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const snapshots = await fleetScopeStorage.getMetricsSnapshots(startDate, endDate);
      res.json(snapshots);
    } catch (error: any) {
      console.error("Error fetching metrics snapshots:", error);
      res.status(500).json({ message: "Failed to fetch metrics snapshots" });
    }
  });

  // Get weekly aggregated metrics
  app.get("/metrics/weekly", async (req, res) => {
    try {
      const weeksParam = req.query.weeks as string | undefined;
      const weeks = parseInt(weeksParam || "4", 10);
      
      // Get snapshots for the last N weeks
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (weeks * 7));
      
      const snapshots = await fleetScopeStorage.getMetricsSnapshots(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );
      
      // Group by ISO week
      const weeklyData: Record<string, {
        week: string;
        startDate: string;
        endDate: string;
        avgTrucksOnRoad: number;
        avgTrucksScheduled: number;
        avgRegContactedTech: number;
        avgRegMailedTag: number;
        avgRegOrderedDuplicates: number;
        snapshotCount: number;
      }> = {};
      
      snapshots.forEach(snapshot => {
        const date = new Date(snapshot.metricDate);
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Get Sunday
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weeklyData[weekKey]) {
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          
          weeklyData[weekKey] = {
            week: weekKey,
            startDate: weekKey,
            endDate: weekEnd.toISOString().split('T')[0],
            avgTrucksOnRoad: 0,
            avgTrucksScheduled: 0,
            avgRegContactedTech: 0,
            avgRegMailedTag: 0,
            avgRegOrderedDuplicates: 0,
            snapshotCount: 0,
          };
        }
        
        weeklyData[weekKey].avgTrucksOnRoad += snapshot.trucksOnRoad;
        weeklyData[weekKey].avgTrucksScheduled += snapshot.trucksScheduled;
        weeklyData[weekKey].avgRegContactedTech += snapshot.regContactedTech;
        weeklyData[weekKey].avgRegMailedTag += snapshot.regMailedTag;
        weeklyData[weekKey].avgRegOrderedDuplicates += snapshot.regOrderedDuplicates;
        weeklyData[weekKey].snapshotCount += 1;
      });
      
      // Calculate averages
      const weeklyResults = Object.values(weeklyData)
        .map(week => ({
          ...week,
          avgTrucksOnRoad: Math.round(week.avgTrucksOnRoad / week.snapshotCount),
          avgTrucksScheduled: Math.round(week.avgTrucksScheduled / week.snapshotCount),
          avgRegContactedTech: Math.round(week.avgRegContactedTech / week.snapshotCount),
          avgRegMailedTag: Math.round(week.avgRegMailedTag / week.snapshotCount),
          avgRegOrderedDuplicates: Math.round(week.avgRegOrderedDuplicates / week.snapshotCount),
        }))
        .sort((a, b) => b.week.localeCompare(a.week));
      
      res.json(weeklyResults);
    } catch (error: any) {
      console.error("Error fetching weekly metrics:", error);
      res.status(500).json({ message: "Failed to fetch weekly metrics" });
    }
  });

  // Get current live metrics (computed from current truck data)
  app.get("/metrics/current", async (req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      const metrics = {
        metricDate: new Date().toISOString().split('T')[0],
        trucksOnRoad: allTrucks.filter(t => t.mainStatus === "On Road").length,
        trucksScheduled: allTrucks.filter(t => t.mainStatus === "Scheduling").length,
        regContactedTech: allTrucks.filter(t => t.registrationStickerValid === "Contacted tech").length,
        regMailedTag: allTrucks.filter(t => t.registrationStickerValid === "Mailed Tag").length,
        regOrderedDuplicates: allTrucks.filter(t => t.registrationStickerValid === "Ordered duplicates").length,
        totalTrucks: allTrucks.length,
        trucksRepairing: allTrucks.filter(t => t.mainStatus === "Repairing").length,
        trucksConfirmingStatus: allTrucks.filter(t => t.mainStatus === "Confirming Status").length,
      };
      
      res.json(metrics);
    } catch (error: any) {
      console.error("Error fetching current metrics:", error);
      res.status(500).json({ message: "Failed to fetch current metrics" });
    }
  });

  // ===== PO Priority (Holman ETL PO Details from Snowflake) =====
  
  let poPriorityCache: { data: any; timestamp: number } | null = null;
  const PO_PRIORITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  app.get("/po-priority", async (req, res) => {
    try {
      const now = Date.now();
      if (poPriorityCache && (now - poPriorityCache.timestamp) < PO_PRIORITY_CACHE_TTL) {
        return res.json(poPriorityCache.data);
      }

      console.log("[PO Priority] Fetching from Snowflake HOLMAN_ETL_PO_DETAILS...");
      
      const sql = `
        SELECT *
        FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
        WHERE PO_DATE >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
          AND UPPER(REPAIR_TYPE_DESCRIPTION) NOT IN ('RENTALS', 'RENTAL')
        ORDER BY PO_DATE DESC
      `;
      const rawRows = await executeQuery<Record<string, any>>(sql);
      console.log(`[PO Priority] Fetched ${rawRows.length} rows from Snowflake`);

      const rows = rawRows.map(row => {
        const normalized: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          normalized[key.toUpperCase()] = value;
        }
        return normalized;
      });

      const allPOs = await fleetScopeStorage.getAllPurchaseOrders();
      const declinedVehicles = new Set<string>();
      for (const po of allPOs) {
        if (po.finalApproval === "Decline and Submit for Sale") {
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const vehicleNo = rawData["Vehicle_No"] || rawData["Vehicle No"] || rawData["VEHICLE_NO"] || rawData["vehicle_no"] || "";
            if (vehicleNo) {
              const norm = vehicleNo.toString().replace(/\D/g, '').replace(/^0+/, '');
              if (norm) declinedVehicles.add(norm);
            }
          } catch (e) { }
        }
      }
      console.log(`[PO Priority] Found ${declinedVehicles.size} declined vehicles from local POs`);

      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const rentalTruckMap = new Map<string, string>();
      for (const truck of allTrucks) {
        if (truck.truckNumber) {
          const norm = truck.truckNumber.toString().replace(/\D/g, '').replace(/^0+/, '');
          if (norm) rentalTruckMap.set(norm, truck.datePutInRepair || '');
        }
      }
      console.log(`[PO Priority] Found ${rentalTruckMap.size} trucks in rentals dashboard`);

      for (const row of rows) {
        const holmanNum = (row.HOLMAN_VEHICLE_NUMBER || '').toString().replace(/\D/g, '').replace(/^0+/, '');
        const clientNum = (row.CLIENT_VEHICLE_NUMBER || '').toString().replace(/\D/g, '').replace(/^0+/, '');
        row.DECLINED_REPAIR = (holmanNum && declinedVehicles.has(holmanNum)) || (clientNum && declinedVehicles.has(clientNum)) ? 'Declined' : '';
        const matchedNum = (holmanNum && rentalTruckMap.has(holmanNum)) ? holmanNum : (clientNum && rentalTruckMap.has(clientNum)) ? clientNum : '';
        row.HAS_RENTAL = matchedNum ? 'Yes' : '';
        row.DATE_IN_REPAIR = matchedNum ? (rentalTruckMap.get(matchedNum) || '') : '';
        const hasRental = row.HAS_RENTAL === 'Yes';
        const hasDeclined = row.DECLINED_REPAIR === 'Declined';
        row.PRIORITY = hasRental && hasDeclined ? 'P1' : hasRental ? 'P2' : 'P3';
      }

      const filteredRows = rows.filter(row => {
        const status = (row.PO_STATUS || '').toString().toUpperCase();
        if (status === 'PAID') return row.HAS_RENTAL === 'Yes';
        return true;
      });
      console.log(`[PO Priority] After filtering paid without rental: ${filteredRows.length} rows (removed ${rows.length - filteredRows.length})`);

      const columns = filteredRows.length > 0 ? Object.keys(filteredRows[0]) : [];

      const grouped: Record<string, { poNumber: string; rows: Record<string, any>[] }> = {};
      for (const row of filteredRows) {
        const poNum = row.PO_NUMBER?.toString() || 'UNKNOWN';
        if (!grouped[poNum]) {
          grouped[poNum] = { poNumber: poNum, rows: [] };
        }
        grouped[poNum].rows.push(row);
      }

      const priorityOrder: Record<string, number> = { P1: 1, P2: 2, P3: 3 };
      const groups = Object.values(grouped).sort((a, b) => {
        const pa = priorityOrder[a.rows[0]?.PRIORITY] || 3;
        const pb = priorityOrder[b.rows[0]?.PRIORITY] || 3;
        return pa - pb;
      });

      const responseData = {
        groups,
        totalRows: filteredRows.length,
        totalGroups: groups.length,
        columns,
      };

      poPriorityCache = { data: responseData, timestamp: now };
      res.json(responseData);
    } catch (error: any) {
      console.error("[PO Priority] Error:", error.message);
      res.status(500).json({ message: "Failed to fetch PO Priority data", error: error.message });
    }
  });

  // ===== Purchase Orders (PO) Routes =====
  
  // Get all purchase orders
  app.get("/pos", async (req, res) => {
    try {
      const orders = await fleetScopeStorage.getAllPurchaseOrders();
      const meta = await fleetScopeStorage.getPoImportMeta();
      
      // Parse rawData for each order
      const parsedOrders = orders.map(order => ({
        ...order,
        rawData: order.rawData ? JSON.parse(order.rawData) : {},
      }));
      
      res.json({
        orders: parsedOrders,
        meta: meta ? {
          ...meta,
          headers: meta.headers ? JSON.parse(meta.headers) : [],
        } : null,
      });
    } catch (error: any) {
      console.error("Error fetching purchase orders:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });
  
  // Import purchase orders from CSV/XLSX
  // Replaces all data with new file, but preserves Final Approval values by matching on PO Number
  app.post("/pos/import", async (req, res) => {
    try {
      const { rows, headers, poNumberColumn, importedBy } = req.body;
      
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      
      const totalRowsInFile = rows.length;
      
      // Step 1: Get existing data mapped by PO number (preserve Final Approval, Submitted in Holman, and importedAt)
      const existingOrders = await fleetScopeStorage.getAllPurchaseOrders();
      const finalApprovalMap = new Map<string, string>();
      const submittedInHolmanMap = new Map<string, string>();
      const importedAtMap = new Map<string, Date>();
      
      for (const order of existingOrders) {
        if (order.poNumber) {
          // Store all existing PO numbers with their values (including empty/blank) to preserve them
          finalApprovalMap.set(order.poNumber, order.finalApproval || "");
          submittedInHolmanMap.set(order.poNumber, order.submittedInHolman || "");
          if (order.importedAt) {
            importedAtMap.set(order.poNumber, new Date(order.importedAt));
          }
        }
      }
      
      // Step 2: Clear all existing records
      await fleetScopeStorage.clearAllPurchaseOrders();
      
      // Step 3: Insert all new rows, preserving Final Approval, Submitted in Holman, and importedAt for matching PO numbers
      const ordersToInsert = rows.map((row: Record<string, any>) => {
        // Try to find the PO number from the row
        const poNum = poNumberColumn ? String(row[poNumberColumn] || "").trim() : "";
        
        // Check if this row has a Final Approval column in the imported data
        const importedFinalApproval = row["Final Approval"] || row["Final Appr"] || row["FinalApproval"] || "";
        
        // Preserve existing Final Approval if we have one for this PO, otherwise use imported value
        let finalApproval = "";
        if (poNum && finalApprovalMap.has(poNum)) {
          finalApproval = finalApprovalMap.get(poNum) || "";
        } else if (importedFinalApproval) {
          finalApproval = String(importedFinalApproval);
        }
        
        // Check if this row has a Submitted in Holman column in the imported data
        // Also check __EMPTY columns as Excel sometimes exports unnamed columns this way
        const importedSubmittedInHolman = row["Submitted in Holman"] || row["Submitted In Holman"] || row["SubmittedInHolman"] || row["Submitted_in_Holman"] || row["__EMPTY"] || "";
        
        // Preserve existing Submitted in Holman if we have one for this PO AND it's non-empty
        // Otherwise use imported value (allows new imports to populate previously blank values)
        let submittedInHolman = "";
        const existingSubmitted = poNum && submittedInHolmanMap.has(poNum) ? submittedInHolmanMap.get(poNum) : "";
        if (existingSubmitted && existingSubmitted.trim() !== "") {
          submittedInHolman = existingSubmitted;
        } else if (importedSubmittedInHolman) {
          submittedInHolman = String(importedSubmittedInHolman);
        }
        
        // Preserve original importedAt timestamp for existing POs, new ones get current time
        const importedAt = poNum && importedAtMap.has(poNum) 
          ? importedAtMap.get(poNum) 
          : new Date();
        
        return {
          poNumber: poNum,
          rawData: row,
          finalApproval,
          submittedInHolman,
          importedBy,
          importedAt,
        };
      });
      
      const created = await fleetScopeStorage.insertPurchaseOrdersWithApproval(ordersToInsert);
      
      // Update import metadata
      await fleetScopeStorage.updatePoImportMeta(headers || [], created, importedBy);
      
      const preservedCount = ordersToInsert.filter(o => o.poNumber && finalApprovalMap.has(o.poNumber)).length;
      
      // Count pending approvals (blank Final Approval) and send email notification
      const pendingCount = ordersToInsert.filter(o => !o.finalApproval || o.finalApproval.trim() === "").length;
      
      // Send email notification asynchronously (don't wait for it)
      sendPendingApprovalsEmail(pendingCount).catch(err => {
        console.error("Email notification error:", err);
      });
      
      res.json({
        success: true,
        created,
        totalRowsInFile,
        preservedApprovals: preservedCount,
        pendingApprovals: pendingCount,
      });
    } catch (error: any) {
      console.error("Error importing purchase orders:", error);
      res.status(500).json({ message: "Failed to import purchase orders: " + error.message });
    }
  });
  
  // Update Final Approval for a purchase order
  app.patch("/pos/:id/final-approval", async (req, res) => {
    try {
      const { id } = req.params;
      const { finalApproval } = req.body;
      
      if (typeof finalApproval !== "string") {
        return res.status(400).json({ message: "finalApproval must be a string" });
      }
      
      await fleetScopeStorage.updatePurchaseOrderFinalApproval(id, finalApproval);
      
      // Auto-sync: If changed to "Decline and Submit for Sale", update corresponding truck in Dashboard
      // and add to Decommissioning table
      let autoSynced = false;
      let syncedTruckNumber = "";
      let addedToDecommissioning = false;
      if (finalApproval.toLowerCase().includes('decline') && finalApproval.toLowerCase().includes('sale')) {
        try {
          // Get the PO to find the Vehicle_No
          const allPOs = await fleetScopeStorage.getAllPurchaseOrders();
          const po = allPOs.find(p => p.id.toString() === id);
          
          if (po && po.rawData) {
            const rawData = JSON.parse(po.rawData);
            const vehicleNo = rawData['Vehicle_No'] || rawData['Vehicle No'] || rawData['VEHICLE_NO'] || 
                             rawData['Truck #'] || rawData['Truck Number'] || rawData['TRUCK_NUMBER'] || '';
            
            if (vehicleNo) {
              // Find matching truck in Dashboard
              const allTrucks = await fleetScopeStorage.getAllTrucks();
              const normalizedVehicleNo = vehicleNo.toString().trim().toUpperCase().replace(/^0+/, '');
              
              const matchingTruck = allTrucks.find(t => 
                t.truckNumber.trim().toUpperCase().replace(/^0+/, '') === normalizedVehicleNo
              );
              
              if (matchingTruck && matchingTruck.mainStatus !== 'Declined Repair' && matchingTruck.mainStatus !== 'Approved for sale' && matchingTruck.mainStatus !== 'Truck Swap') {
                await fleetScopeStorage.updateTruck(matchingTruck.id, { 
                  mainStatus: 'Declined Repair',
                  subStatus: 'no sub-status'
                });
                autoSynced = true;
                syncedTruckNumber = vehicleNo.toString();
                console.log(`[Auto-Sync] Updated truck ${vehicleNo} to "Declined Repair" status`);
              }
              
              // Also add to Decommissioning table (if not already there)
              const paddedTruckNumber = vehicleNo.toString().padStart(6, '0');
              const existingDecom = await fleetScopeStorage.getDecommissioningVehicle(paddedTruckNumber);
              if (!existingDecom) {
                await fleetScopeStorage.upsertDecommissioningVehicle({
                  truckNumber: paddedTruckNumber,
                  address: null,
                  zipCode: null,
                  phone: null,
                  comments: null,
                  stillNotSold: true,
                });
                addedToDecommissioning = true;
                console.log(`[Auto-Sync] Added truck ${paddedTruckNumber} to Decommissioning table`);
              }
            }
          }
        } catch (syncError) {
          console.error("[Auto-Sync] Error during auto-sync:", syncError);
          // Don't fail the main request if auto-sync fails
        }
      }
      
      res.json({ success: true, id, finalApproval, autoSynced, syncedTruckNumber, addedToDecommissioning });
    } catch (error: any) {
      console.error("Error updating final approval:", error);
      res.status(500).json({ message: "Failed to update final approval: " + error.message });
    }
  });
  
  // Update Submitted in Holman for a purchase order
  app.patch("/pos/:id/submitted-in-holman", async (req, res) => {
    try {
      const { id } = req.params;
      const { submittedInHolman } = req.body;
      
      if (typeof submittedInHolman !== "string") {
        return res.status(400).json({ message: "submittedInHolman must be a string" });
      }
      
      await fleetScopeStorage.updatePurchaseOrderSubmittedInHolman(id, submittedInHolman);
      
      res.json({ success: true, id, submittedInHolman });
    } catch (error: any) {
      console.error("Error updating submitted in holman:", error);
      res.status(500).json({ message: "Failed to update submitted in holman: " + error.message });
    }
  });
  
  // Get unique Final Approval values
  app.get("/pos/final-approval-options", async (req, res) => {
    try {
      const options = await fleetScopeStorage.getUniqueFinalApprovalValues();
      res.json(options);
    } catch (error: any) {
      console.error("Error fetching final approval options:", error);
      res.status(500).json({ message: "Failed to fetch options" });
    }
  });

  // Sync POs with "Decline and Submit for Sale" to Dashboard trucks with "Declined Repair" status
  app.post("/pos/sync-declined-repairs", async (req, res) => {
    try {
      const allPOs = await fleetScopeStorage.getAllPurchaseOrders();
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      // Create a map of truck numbers to trucks for fast lookup
      const truckMap = new Map<string, typeof allTrucks[0]>();
      for (const truck of allTrucks) {
        const normalizedNum = truck.truckNumber.trim().toUpperCase().replace(/^0+/, '');
        truckMap.set(normalizedNum, truck);
      }
      
      // Find POs with "Decline and Submit for Sale" final approval
      const declinedPOs: Array<{ vehicleNo: string; poNumber: string }> = [];
      for (const po of allPOs) {
        if (po.finalApproval?.toLowerCase().includes('decline') && 
            po.finalApproval?.toLowerCase().includes('sale')) {
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const vehicleNo = rawData['Vehicle_No'] || rawData['Vehicle No'] || rawData['VEHICLE_NO'] || 
                             rawData['Truck #'] || rawData['Truck Number'] || rawData['TRUCK_NUMBER'] || '';
            if (vehicleNo) {
              declinedPOs.push({ 
                vehicleNo: vehicleNo.toString().trim(), 
                poNumber: po.poNumber 
              });
            }
          } catch {}
        }
      }
      
      // Update matching trucks to "Declined Repair" main status
      let updated = 0;
      const updatedTrucks: string[] = [];
      const notFound: string[] = [];
      const alreadyDeclined: string[] = [];
      const skippedApprovedForSale: string[] = [];
      const skippedTruckSwap: string[] = [];
      
      for (const { vehicleNo, poNumber } of declinedPOs) {
        const normalizedVehicleNo = vehicleNo.toUpperCase().replace(/^0+/, '');
        const truck = truckMap.get(normalizedVehicleNo);
        
        if (truck) {
          if (truck.mainStatus === 'Declined Repair') {
            alreadyDeclined.push(vehicleNo);
          } else if (truck.mainStatus === 'Approved for sale') {
            skippedApprovedForSale.push(vehicleNo);
          } else if (truck.mainStatus === 'Truck Swap') {
            skippedTruckSwap.push(vehicleNo);
          } else {
            await fleetScopeStorage.updateTruck(truck.id, { 
              mainStatus: 'Declined Repair',
              subStatus: 'no sub-status'
            });
            updated++;
            updatedTrucks.push(vehicleNo);
          }
        } else {
          notFound.push(vehicleNo);
        }
      }
      
      console.log(`[Sync Declined] Found ${declinedPOs.length} POs with "Decline and Submit for Sale", updated ${updated} trucks, ${alreadyDeclined.length} already declined, ${skippedApprovedForSale.length} skipped (Approved for sale), ${skippedTruckSwap.length} skipped (Truck Swap), ${notFound.length} not found in Dashboard`);
      
      res.json({ 
        success: true, 
        totalDeclinedPOs: declinedPOs.length,
        updated,
        updatedTrucks,
        alreadyDeclined: alreadyDeclined.length,
        skippedApprovedForSale: skippedApprovedForSale.length,
        skippedTruckSwap: skippedTruckSwap.length,
        notFoundInDashboard: notFound
      });
    } catch (error: any) {
      console.error("Error syncing declined repairs:", error);
      res.status(500).json({ message: "Failed to sync declined repairs: " + error.message });
    }
  });

  // ===== Holman Scraper Integration =====
  const SCRAPER_BASE_URL = "https://web-scraper-tool-seanchen37.replit.app";
  let scraperCache: { data: Record<string, any>; timestamp: number } | null = null;
  const SCRAPER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async function fetchAllScraperData(): Promise<Record<string, any>> {
    try {
      const now = Date.now();
      if (scraperCache && (now - scraperCache.timestamp) < SCRAPER_CACHE_TTL) {
        return scraperCache.data;
      }

      console.log("[Scraper] Fetching all vehicle data...");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const response = await fetch(`${SCRAPER_BASE_URL}/api/public/vehicles`, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        console.error(`[Scraper] Fetch failed: ${response.status} ${response.statusText}`);
        return scraperCache?.data || {};
      }

      const result = await response.json();
      const vehicles = result.vehicles || [];
      
      const vehicleMap: Record<string, any> = {};
      for (const v of vehicles) {
        const num = (v.vehicle_number || '').toString().padStart(6, '0');
        vehicleMap[num] = v;
      }

      console.log(`[Scraper] Cached data for ${Object.keys(vehicleMap).length} vehicles`);
      scraperCache = { data: vehicleMap, timestamp: Date.now() };
      return vehicleMap;
    } catch (error: any) {
      console.error("[Scraper] Error fetching data:", error.message);
      return scraperCache?.data || {};
    }
  }

  async function autoPopulateFromScraper() {
    try {
      console.log("[Scraper AutoPopulate] Starting auto-populate of blank repairAddress/repairPhone...");
      const scraperData = await fetchAllScraperData();
      if (!scraperData || Object.keys(scraperData).length === 0) {
        console.log("[Scraper AutoPopulate] No scraper data available, skipping.");
        return;
      }

      const allTrucks = await fleetScopeStorage.getAllTrucks();
      let addressCount = 0;
      let phoneCount = 0;
      const updatedAddressTrucks: string[] = [];
      const updatedPhoneTrucks: string[] = [];

      for (const truck of allTrucks) {
        const truckNum = (truck.truckNumber || '').toString().padStart(6, '0');
        const scraperVehicle = scraperData[truckNum];
        if (!scraperVehicle) continue;

        const updates: Record<string, string> = {};

        if ((!truck.repairAddress || truck.repairAddress.trim() === '') && scraperVehicle.location) {
          const location = scraperVehicle.location.trim();
          if (location.length > 0 && location.length <= 500) {
            updates.repairAddress = location;
            addressCount++;
            updatedAddressTrucks.push(truckNum);

            const vendorPhone = (scraperVehicle.repair_vendor?.phone || '').trim();
            if ((!truck.repairPhone || truck.repairPhone.trim() === '') && vendorPhone && vendorPhone !== '(555) 555-5555' && vendorPhone.length <= 30) {
              updates.repairPhone = vendorPhone;
              phoneCount++;
              updatedPhoneTrucks.push(truckNum);
            }
          }
        }

        if (Object.keys(updates).length > 0) {
          await fleetScopeStorage.updateTruck(truck.id, updates);
        }
      }

      console.log(`[Scraper AutoPopulate] Done. Populated ${addressCount} repairAddress, ${phoneCount} repairPhone fields.`);
      if (updatedAddressTrucks.length > 0) {
        console.log(`[Scraper AutoPopulate] Address updated for: ${updatedAddressTrucks.slice(0, 20).join(', ')}${updatedAddressTrucks.length > 20 ? ` ... and ${updatedAddressTrucks.length - 20} more` : ''}`);
      }
      if (updatedPhoneTrucks.length > 0) {
        console.log(`[Scraper AutoPopulate] Phone updated for: ${updatedPhoneTrucks.slice(0, 20).join(', ')}${updatedPhoneTrucks.length > 20 ? ` ... and ${updatedPhoneTrucks.length - 20} more` : ''}`);
      }
    } catch (error: any) {
      console.error("[Scraper AutoPopulate] Error:", error.message);
    }
  }

  setTimeout(() => {
    autoPopulateFromScraper();
  }, 45 * 1000);

  setInterval(() => {
    autoPopulateFromScraper();
  }, 30 * 60 * 1000);

  // Background scheduler: Refresh all UPS tracking records every 30 minutes
  const UPS_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  
  async function scheduledUpsRefresh() {
    console.log(`[UPS Scheduler] Starting scheduled UPS tracking refresh at ${new Date().toISOString()}`);
    
    try {
      const allRecords = await fleetScopeStorage.getTrackingRecords();
      const activeRecords = allRecords.filter(r => r.lastStatus !== "D");
      
      if (activeRecords.length === 0) {
        console.log("[UPS Scheduler] No active tracking records to refresh");
        return;
      }
      
      console.log(`[UPS Scheduler] Refreshing ${activeRecords.length} active tracking records...`);
      
      let updated = 0;
      let failed = 0;
      
      for (const record of activeRecords) {
        try {
          const trackingResult = await trackPackage(record.trackingNumber);
          
          await fleetScopeStorage.updateTrackingRecord(record.id, {
            lastStatus: trackingResult.status,
            lastStatusDescription: trackingResult.statusDescription,
            lastLocation: trackingResult.location,
            estimatedDelivery: trackingResult.estimatedDelivery,
            deliveredAt: trackingResult.deliveredAt,
            lastCheckedAt: new Date(),
            lastError: trackingResult.error || null,
            errorAt: trackingResult.error ? new Date() : null,
          });
          
          updated++;
          
          // Small delay between API calls (500ms)
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          failed++;
          console.error(`[UPS Scheduler] Failed to refresh ${record.trackingNumber}:`, error.message);
          
          await fleetScopeStorage.updateTrackingRecord(record.id, {
            lastError: error.message,
            errorAt: new Date(),
            lastCheckedAt: new Date(),
          });
        }
      }
      
      console.log(`[UPS Scheduler] Refresh complete: ${updated} updated, ${failed} failed`);
    } catch (error) {
      console.error("[UPS Scheduler] Error in scheduled refresh:", error);
    }
  }
  
  // Start the scheduler after a short delay to let the server initialize
  setTimeout(() => {
    console.log(`[UPS Scheduler] Starting UPS tracking scheduler (every 30 minutes)`);
    setInterval(scheduledUpsRefresh, UPS_REFRESH_INTERVAL_MS);
    // Run immediately on startup as well
    scheduledUpsRefresh();
  }, 5000);
  
  // Background scheduler: Refresh Tech Data from Snowflake TPMS_EXTRACT daily at 7:30 AM ET
  
  async function scheduledTechDataRefresh() {
    console.log(`[Tech Data Scheduler] Starting Snowflake tech data refresh at ${new Date().toISOString()}`);
    
    try {
      // Get all trucks from our database
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      if (allTrucks.length === 0) {
        console.log("[Tech Data Scheduler] No trucks to update");
        return;
      }
      
      // Get all truck numbers
      const truckNumbers = allTrucks.map(t => t.truckNumber);
      const snowflakeTruckNumbers = truckNumbers.map(num => `'${num}'`);
      
      // Query Snowflake for tech names and phone numbers
      const snowflakeQuery = `
        SELECT TRUCK_LU, FULL_NAME, MOBILEPHONENUMBER 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const snowflakeData = await executeQuery<{
        TRUCK_LU: string;
        FULL_NAME: string;
        MOBILEPHONENUMBER: number | null;
      }>(snowflakeQuery);
      
      // Create lookup map from Snowflake data
      const snowflakeLookup = new Map<string, { fullName: string; phone: string | null }>();
      for (const row of snowflakeData) {
        snowflakeLookup.set(row.TRUCK_LU, {
          fullName: row.FULL_NAME,
          phone: row.MOBILEPHONENUMBER ? String(row.MOBILEPHONENUMBER) : null
        });
      }
      
      // Update trucks with Snowflake data (tech info + assignment status)
      let updatedCount = 0;
      let assignmentUpdated = 0;
      
      for (const truck of allTrucks) {
        const snowflakeRecord = snowflakeLookup.get(truck.truckNumber);
        const isAssigned = !!snowflakeRecord;
        
        const updates: Partial<{ techName: string; techPhone: string; snowflakeAssigned: boolean }> = {};
        
        if (truck.snowflakeAssigned !== isAssigned) {
          updates.snowflakeAssigned = isAssigned;
          assignmentUpdated++;
        }
        
        if (!snowflakeRecord) {
          if (Object.keys(updates).length > 0) {
            await fleetScopeStorage.updateTruck(truck.id, updates);
          }
          continue;
        }
        
        // Update tech_name if different from Snowflake
        if (snowflakeRecord.fullName && truck.techName !== snowflakeRecord.fullName) {
          updates.techName = snowflakeRecord.fullName;
        }
        
        // Update tech_phone if different from Snowflake
        if (snowflakeRecord.phone && truck.techPhone !== snowflakeRecord.phone) {
          updates.techPhone = snowflakeRecord.phone;
        }
        
        if (Object.keys(updates).length > 0) {
          await fleetScopeStorage.updateTruck(truck.id, updates);
          updatedCount++;
        }
      }
      
      console.log(`[Tech Data Scheduler] Refresh complete: checked ${allTrucks.length} trucks, found ${snowflakeData.length} in Snowflake, updated ${updatedCount}, assignment status changes: ${assignmentUpdated}`);
      
      // Now sync tech STATE from TPMS_EXTRACT PRIMARY_STATE with AMS fallback
      console.log(`[Tech State Scheduler] Starting tech state sync with AMS fallback...`);
      
      // Query Snowflake for PRIMARYSTATE from TPMS_EXTRACT
      const tpmsStateQuery = `
        SELECT TRUCK_LU, PRIMARYSTATE 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const tpmsStateData = await executeQuery<{
        TRUCK_LU: string;
        PRIMARYSTATE: string | null;
      }>(tpmsStateQuery);
      
      // Create lookup map from TPMS data
      const tpmsStateLookup = new Map<string, string | null>();
      for (const row of tpmsStateData) {
        tpmsStateLookup.set(row.TRUCK_LU, row.PRIMARYSTATE);
      }
      
      // Query REPLIT_ALL_VEHICLES for AMS_CUR_STATE as fallback
      // Note: VEHICLE_NUMBER may have leading zeros (6-digit format like '006401')
      // We need to query all vehicles and match by normalized number
      const amsStateQuery = `
        SELECT VEHICLE_NUMBER, AMS_CUR_STATE 
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES 
        WHERE AMS_CUR_STATE IS NOT NULL
          AND AMS_CUR_STATE != ''
      `;
      
      const amsStateData = await executeQuery<{
        VEHICLE_NUMBER: string;
        AMS_CUR_STATE: string | null;
      }>(amsStateQuery);
      
      // Create lookup map from AMS data, normalizing vehicle numbers
      // Normalize by extracting digits and removing leading zeros
      const amsStateLookup = new Map<string, string | null>();
      for (const row of amsStateData) {
        if (row.VEHICLE_NUMBER) {
          // Remove non-digits and leading zeros to match our truck number format
          const digits = row.VEHICLE_NUMBER.replace(/\D/g, '');
          const normalizedNum = digits.replace(/^0+/, '') || '0';
          amsStateLookup.set(normalizedNum, row.AMS_CUR_STATE);
        }
      }
      console.log(`[Tech State Scheduler] AMS raw data: ${amsStateData.length}, normalized lookup size: ${amsStateLookup.size}`);
      
      // Query AMS_XLS_EXPORTS for STATE parsed from CURRENT_ADDRESS as third-tier fallback
      // Get latest record per VEHICLE using FILE_DATE, parse state from 3rd comma-separated value
      const xlsStateQuery = `
        WITH latest_records AS (
          SELECT 
            VEHICLE,
            CURRENT_ADDRESS,
            TRIM(SPLIT_PART(CURRENT_ADDRESS, ',', 3)) AS PARSED_STATE,
            ROW_NUMBER() OVER (PARTITION BY VEHICLE ORDER BY FILE_DATE DESC) as rn
          FROM PARTS_SUPPLYCHAIN.FLEET.AMS_XLS_EXPORTS 
          WHERE CURRENT_ADDRESS IS NOT NULL
            AND CURRENT_ADDRESS != ''
            AND CURRENT_ADDRESS NOT LIKE ', , ,%'
        )
        SELECT VEHICLE, CURRENT_ADDRESS, PARSED_STATE
        FROM latest_records
        WHERE rn = 1
          AND PARSED_STATE IS NOT NULL
          AND LENGTH(TRIM(PARSED_STATE)) = 2
      `;
      
      const xlsStateData = await executeQuery<{
        VEHICLE: string;
        CURRENT_ADDRESS: string;
        PARSED_STATE: string | null;
      }>(xlsStateQuery);
      
      // Valid US state abbreviations
      const validStates = new Set([
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
        'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
        'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
        'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
      ]);
      
      // Create lookup map from AMS_XLS_EXPORTS data, normalizing vehicle numbers
      const xlsStateLookup = new Map<string, string | null>();
      for (const row of xlsStateData) {
        if (row.VEHICLE && row.PARSED_STATE) {
          const state = row.PARSED_STATE.toUpperCase().trim();
          // Only use valid US state abbreviations
          if (validStates.has(state)) {
            const digits = row.VEHICLE.replace(/\D/g, '');
            const normalizedNum = digits.replace(/^0+/, '') || '0';
            xlsStateLookup.set(normalizedNum, state);
          }
        }
      }
      console.log(`[Tech State Scheduler] XLS raw data: ${xlsStateData.length}, normalized lookup size: ${xlsStateLookup.size}`);
      
      // Update each truck's state with TPMS first, then AMS, then XLS fallback
      let stateUpdatedCount = 0;
      let tpmsCount = 0;
      let amsCount = 0;
      let xlsCount = 0;
      
      for (const truck of allTrucks) {
        let state: string | null = null;
        let source: string | null = null;
        
        // Normalize truck number (remove non-digits and leading zeros) for AMS lookup
        const truckDigits = truck.truckNumber.replace(/\D/g, '');
        const normalizedTruckNum = truckDigits.replace(/^0+/, '') || '0';
        
        // First try TPMS_EXTRACT - only use if state is non-empty
        const tpmsState = tpmsStateLookup.get(truck.truckNumber);
        if (tpmsState && tpmsState.trim() !== '') {
          state = tpmsState;
          source = "TPMS";
        }
        // Fallback to AMS if no TPMS state or TPMS state is empty
        else if (amsStateLookup.has(normalizedTruckNum)) {
          const amsState = amsStateLookup.get(normalizedTruckNum);
          if (amsState && amsState.trim() !== '') {
            state = amsState;
            source = "AMS";
          }
        }
        // Third fallback to AMS_XLS_EXPORTS
        if (!state && xlsStateLookup.has(normalizedTruckNum)) {
          const xlsState = xlsStateLookup.get(normalizedTruckNum);
          if (xlsState && xlsState.trim() !== '') {
            state = xlsState;
            source = "XLS";
          }
        }
        
        // Only update if we found a state and it's different
        if (state && source) {
          const stateChanged = truck.techState !== state;
          const sourceChanged = truck.techStateSource !== source;
          
          if (stateChanged || sourceChanged) {
            await fleetScopeStorage.updateTruck(truck.id, { 
              techState: state,
              techStateSource: source 
            });
            stateUpdatedCount++;
            if (source === "TPMS") tpmsCount++;
            if (source === "AMS") amsCount++;
            if (source === "XLS") xlsCount++;
          }
        }
      }
      
      console.log(`[Tech State Scheduler] State sync complete: ${stateUpdatedCount} updated (${tpmsCount} TPMS, ${amsCount} AMS, ${xlsCount} XLS), TPMS: ${tpmsStateData.length}, AMS: ${amsStateData.length}, XLS: ${xlsStateData.length}`);
    } catch (error: any) {
      console.error("[Tech Data Scheduler] Error refreshing tech data:", error.message);
    }
  }
  
  // Background scheduler: Refresh Snowflake Assigned status daily at 7:30 AM ET
  
  async function scheduledAssignedRefresh() {
    console.log(`[Assigned Scheduler] Starting Snowflake assigned status refresh at ${new Date().toISOString()}`);
    
    try {
      // Get all trucks from our database
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      if (allTrucks.length === 0) {
        console.log("[Assigned Scheduler] No trucks to check");
        return;
      }
      
      // Get all truck numbers
      const truckNumbers = allTrucks.map(t => t.truckNumber);
      const snowflakeTruckNumbers = truckNumbers.map(num => `'${num}'`);
      
      // Query Snowflake for all TRUCK_LU values
      const snowflakeQuery = `
        SELECT DISTINCT TRUCK_LU 
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT 
        WHERE TRUCK_LU IN (${snowflakeTruckNumbers.join(', ')})
      `;
      
      const snowflakeData = await executeQuery<{
        TRUCK_LU: string;
      }>(snowflakeQuery);
      
      // Create set of truck numbers found in Snowflake
      const snowflakeTruckSet = new Set(snowflakeData.map(row => row.TRUCK_LU));
      
      // Update each truck's assigned status
      let updatedCount = 0;
      
      for (const truck of allTrucks) {
        const isAssigned = snowflakeTruckSet.has(truck.truckNumber);
        
        // Only update if the value is different
        if (truck.snowflakeAssigned !== isAssigned) {
          await fleetScopeStorage.updateTruck(truck.id, { snowflakeAssigned: isAssigned });
          updatedCount++;
        }
      }
      
      console.log(`[Assigned Scheduler] Refresh complete: checked ${allTrucks.length} trucks, found ${snowflakeData.length} in Snowflake, updated ${updatedCount}`);
    } catch (error) {
      console.error("[Assigned Scheduler] Error in scheduled refresh:", error);
    }
  }
  
  // Calculate milliseconds until next 7:30 AM ET
  function getMillisecondsUntil730AMET(): number {
    const now = new Date();
    const targetHour = 7;
    const targetMinute = 30;
    
    // Get current time components in ET timezone
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const etParts = etFormatter.formatToParts(now);
    const currentETHour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0');
    const currentETMinute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0');
    
    // Calculate time until target in ET
    // If past 7:30 AM ET today, schedule for tomorrow
    let hoursUntil = targetHour - currentETHour;
    let minutesUntil = targetMinute - currentETMinute;
    
    if (minutesUntil < 0) {
      minutesUntil += 60;
      hoursUntil -= 1;
    }
    
    if (hoursUntil < 0 || (hoursUntil === 0 && minutesUntil <= 0)) {
      // Already past 7:30 AM ET today, schedule for tomorrow
      hoursUntil += 24;
    }
    
    const msUntil = (hoursUntil * 60 + minutesUntil) * 60 * 1000;
    
    // Sanity check - should be between 0 and 24 hours
    if (msUntil <= 0 || msUntil > 24 * 60 * 60 * 1000 || !Number.isFinite(msUntil)) {
      // Fallback: schedule for 24 hours from now
      console.warn('[Assigned Scheduler] Invalid time calculation, defaulting to 24 hours');
      return 24 * 60 * 60 * 1000;
    }
    
    return msUntil;
  }
  
  function scheduleNextAssignedRefresh() {
    const msUntilNext = getMillisecondsUntil730AMET();
    const nextRunDate = new Date(Date.now() + msUntilNext);
    
    console.log(`[Assigned Scheduler] Next Snowflake sync scheduled for 7:30 AM ET (${nextRunDate.toISOString()})`);
    
    setTimeout(async () => {
      await scheduledAssignedRefresh();
      scheduleNextAssignedRefresh(); // Schedule the next day's run
    }, msUntilNext);
  }
  
  // ============================================================
  // EXTERNAL API ENDPOINTS (v1)
  // Open access endpoints for integration with other applications
  // ============================================================
  
  // GET /api/v1/external/vehicles - Returns vehicle data for external apps
  app.get("/v1/external/vehicles", async (req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      
      // Map to external-friendly format
      const vehicles = allTrucks.map(truck => ({
        truckNumber: truck.truckNumber,
        mainStatus: truck.mainStatus,
        subStatus: truck.subStatus,
        combinedStatus: truck.status, // The combined display status
        datePutInRepair: truck.datePutInRepair,
        lastUpdatedAt: truck.lastUpdatedAt,
        repairCompleted: truck.repairCompleted,
        vanPickedUp: truck.vanPickedUp,
      }));
      
      res.json({
        success: true,
        data: vehicles,
        meta: {
          totalCount: vehicles.length,
          generatedAt: new Date().toISOString(),
        }
      });
    } catch (error: any) {
      console.error("External vehicles API error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // GET /api/v1/external/repairs - Returns repair/PO data with Vehicle_No and Final Approval
  app.get("/v1/external/repairs", async (req, res) => {
    try {
      const purchaseOrders = await fleetScopeStorage.getAllPurchaseOrders();
      
      // Parse rawData to extract Vehicle_No and other fields
      const repairs = purchaseOrders.map(po => {
        let rawData: Record<string, any> = {};
        try {
          rawData = po.rawData ? JSON.parse(po.rawData) : {};
        } catch (e) {
          rawData = {};
        }
        
        return {
          poNumber: po.poNumber,
          vehicleNo: rawData["Vehicle_No"] || rawData["Vehicle No"] || rawData["VEHICLE_NO"] || null,
          finalApproval: po.finalApproval,
          submittedInHolman: po.submittedInHolman,
          importedAt: po.importedAt,
        };
      });
      
      // Helper to get ISO week number
      const getWeekNumber = (date: Date): { week: number; year: number } => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return { week: weekNo, year: d.getUTCFullYear() };
      };
      
      // Count by Final Approval status - totals
      const statusTotals: Record<string, number> = {};
      
      // Count by month: "MM-YYYY" -> { status: count }
      const byMonth: Record<string, Record<string, number>> = {};
      
      // Count by week: "Week WW-YYYY" -> { status: count }
      const byWeek: Record<string, Record<string, number>> = {};
      
      // Count by date: "MM-DD-YYYY" -> { status: count }
      const byDate: Record<string, Record<string, number>> = {};
      
      purchaseOrders.forEach(po => {
        const status = po.finalApproval || "Pending";
        const importDate = po.importedAt ? new Date(po.importedAt) : null;
        
        // Total counts
        statusTotals[status] = (statusTotals[status] || 0) + 1;
        
        if (importDate) {
          // Format date key: MM-DD-YYYY
          const month = String(importDate.getMonth() + 1).padStart(2, '0');
          const day = String(importDate.getDate()).padStart(2, '0');
          const year = importDate.getFullYear();
          const dateKey = `${month}-${day}-${year}`;
          
          // Format month key: MM-YYYY
          const monthKey = `${month}-${year}`;
          
          // Format week key: Week WW-YYYY
          const { week, year: weekYear } = getWeekNumber(importDate);
          const weekKey = `Week ${String(week).padStart(2, '0')}-${weekYear}`;
          
          // Add to byDate
          if (!byDate[dateKey]) byDate[dateKey] = {};
          byDate[dateKey][status] = (byDate[dateKey][status] || 0) + 1;
          
          // Add to byMonth
          if (!byMonth[monthKey]) byMonth[monthKey] = {};
          byMonth[monthKey][status] = (byMonth[monthKey][status] || 0) + 1;
          
          // Add to byWeek
          if (!byWeek[weekKey]) byWeek[weekKey] = {};
          byWeek[weekKey][status] = (byWeek[weekKey][status] || 0) + 1;
        }
      });
      
      res.json({
        success: true,
        data: repairs,
        analytics: {
          totals: statusTotals,
          byMonth,  // e.g., "12-2024": { "Pending": 5, "Proceed with repair": 10 }
          byWeek,   // e.g., "Week 50-2024": { "Pending": 2, "Proceed with repair": 8 }
          byDate,   // e.g., "12-18-2024": { "Pending": 1, "Proceed with repair": 3 }
          summary: {
            totalRecords: repairs.length,
            uniqueVehicles: new Set(repairs.map(r => r.vehicleNo).filter(Boolean)).size,
          }
        },
        meta: {
          generatedAt: new Date().toISOString(),
        }
      });
    } catch (error: any) {
      console.error("External repairs API error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ========== RENTAL RECONCILIATION ENDPOINTS ==========

  // Reconcile rental truck list - compares against dashboard, archives removed trucks, adds new ones
  app.post("/rentals/reconcile", async (req, res) => {
    try {
      const { truckNumbers, importedBy = "System" } = req.body;
      
      if (!truckNumbers || !Array.isArray(truckNumbers)) {
        return res.status(400).json({ message: "truckNumbers must be an array of truck numbers" });
      }
      
      // Filter empty strings and normalize
      const cleanedNumbers = truckNumbers
        .map((n: any) => String(n || "").trim())
        .filter((n: string) => n.length > 0);
      
      if (cleanedNumbers.length === 0) {
        return res.status(400).json({ message: "No valid truck numbers provided" });
      }
      
      const result = await fleetScopeStorage.reconcileRentalList(cleanedNumbers, importedBy);
      
      res.json({
        success: true,
        message: `Reconciliation complete: ${result.newRentals} new rentals added, ${result.rentalsReturned} returned, ${result.matched} matched`,
        ...result,
      });
    } catch (error: any) {
      console.error("Rental reconciliation error:", error);
      res.status(500).json({ message: error.message || "Failed to reconcile rental list" });
    }
  });

  // Get rental import history
  app.get("/rentals/imports", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const imports = await fleetScopeStorage.getRentalImports(limit);
      res.json(imports);
    } catch (error: any) {
      console.error("Error fetching rental imports:", error);
      res.status(500).json({ message: "Failed to fetch rental imports" });
    }
  });

  // Get archived trucks
  app.get("/rentals/archived", async (req, res) => {
    try {
      const archivedTrucks = await fleetScopeStorage.getArchivedTrucks();
      res.json(archivedTrucks);
    } catch (error: any) {
      console.error("Error fetching archived trucks:", error);
      res.status(500).json({ message: "Failed to fetch archived trucks" });
    }
  });

  // Get rental stats by week - uses manual entries
  app.get("/rentals/weekly-stats", async (req, res) => {
    try {
      const manualEntries = await getDb().select().from(rentalWeeklyManual).orderBy(sql`week_year DESC, week_number DESC`).limit(12);
      
      const sortedStats = manualEntries.map(entry => ({
        weekYear: entry.weekYear,
        weekNumber: entry.weekNumber,
        newRentals: entry.newRentals,
        rentalsReturned: entry.rentalsReturned,
        totalImports: 0,
      }));
      
      res.json(sortedStats);
    } catch (error: any) {
      console.error("Error fetching weekly rental stats:", error);
      res.status(500).json({ message: "Failed to fetch weekly rental stats" });
    }
  });

  // Save manual weekly rental data (upsert by week)
  app.post("/rentals/weekly-manual", async (req, res) => {
    try {
      const schema = z.object({
        weekYear: z.number().int().min(2024).max(2030),
        weekNumber: z.number().int().min(1).max(53),
        newRentals: z.number().int().min(0).default(0),
        rentalsReturned: z.number().int().min(0).default(0),
      });
      
      const parsed = schema.parse(req.body);
      
      await getDb()
        .insert(rentalWeeklyManual)
        .values({
          weekYear: parsed.weekYear,
          weekNumber: parsed.weekNumber,
          newRentals: parsed.newRentals,
          rentalsReturned: parsed.rentalsReturned,
        })
        .onConflictDoUpdate({
          target: [rentalWeeklyManual.weekYear, rentalWeeklyManual.weekNumber],
          set: {
            newRentals: parsed.newRentals,
            rentalsReturned: parsed.rentalsReturned,
            updatedAt: sql`now()`,
          },
        });
      
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map(e => e.message).join(", ") });
      }
      console.error("Error saving manual rental data:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/rentals/summary", async (req, res) => {
    try {
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const rentalTrucks = allTrucks.filter(t => t.mainStatus === "NLWC - Return Rental");
      
      const now = new Date();
      let totalDurationDays = 0;
      let durationsCount = 0;
      let overdueCount = 0;
      let returnedThisWeek = 0;
      const byRegion: Record<string, number> = {};
      
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      for (const t of allTrucks) {
        if (t.datePutInRepair) {
          const start = new Date(t.datePutInRepair);
          if (!isNaN(start.getTime())) {
            const days = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            totalDurationDays += days;
            durationsCount++;
          }
        }
        
        const region = t.techState || 'Unknown';
        byRegion[region] = (byRegion[region] || 0) + 1;
      }
      
      for (const t of rentalTrucks) {
        
        if (t.expectedReturnDate) {
          const expected = new Date(t.expectedReturnDate);
          if (!isNaN(expected.getTime()) && expected < now && t.rentalStatus !== 'Returned') {
            overdueCount++;
          }
        }
        
        if (t.rentalStatus === 'Returned' && t.lastUpdatedAt) {
          const updatedAt = new Date(t.lastUpdatedAt);
          if (updatedAt >= oneWeekAgo) {
            returnedThisWeek++;
          }
        }
      }
      
      res.json({
        totalActive: rentalTrucks.filter(t => t.rentalStatus !== 'Returned').length,
        totalRentals: allTrucks.length,
        averageDurationDays: durationsCount > 0 ? Math.round(totalDurationDays / durationsCount) : 0,
        overdueCount,
        returnedThisWeek,
        byRegion,
      });
    } catch (error: any) {
      console.error("Error fetching rental summary:", error);
      res.status(500).json({ message: "Failed to fetch rental summary" });
    }
  });

  // Start the Assigned scheduler
  setTimeout(() => {
    console.log(`[Assigned Scheduler] Initializing daily Snowflake assigned status scheduler (7:30 AM ET)`);
    // Run once on startup
    scheduledAssignedRefresh();
    // Then schedule for 7:30 AM ET daily
    scheduleNextAssignedRefresh();
  }, 8000);
  
  // Start the Tech Data scheduler (runs 30 seconds after Assigned to avoid simultaneous Snowflake queries)
  function scheduleNextTechDataRefresh() {
    const msUntilNext = getMillisecondsUntil730AMET() + 30000; // 30 seconds after 7:30 AM
    const nextRunDate = new Date(Date.now() + msUntilNext);
    
    console.log(`[Tech Data Scheduler] Next Snowflake tech data sync scheduled for 7:30:30 AM ET (${nextRunDate.toISOString()})`);
    
    setTimeout(async () => {
      await scheduledTechDataRefresh();
      scheduleNextTechDataRefresh(); // Schedule the next day's run
    }, msUntilNext);
  }
  
  setTimeout(() => {
    console.log(`[Tech Data Scheduler] Initializing daily Snowflake tech data scheduler (7:30 AM ET)`);
    // Run once on startup
    scheduledTechDataRefresh();
    // Then schedule for 7:30 AM ET daily (30 sec after assigned sync)
    scheduleNextTechDataRefresh();
  }, 10000); // Start 2 seconds after Assigned scheduler
  
  // Populate technician cache on startup (for All Vehicles table)
  setTimeout(async () => {
    console.log(`[TechCache] Initializing technician data cache...`);
    await refreshTechnicianCache();
  }, 12000); // Start after other schedulers

  // =====================
  // FLEET COST ROUTES
  // =====================

  // Get all fleet cost records
  app.get("/fleet-cost/records", async (req, res) => {
    try {
      const records = await fleetScopeStorage.getAllFleetCostRecords();
      const meta = await fleetScopeStorage.getFleetCostImportMeta();
      res.json({ 
        records, 
        meta,
        totalRecords: records.length 
      });
    } catch (error: any) {
      console.error("Error fetching fleet cost records:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get fleet cost import metadata
  app.get("/fleet-cost/meta", async (req, res) => {
    try {
      const meta = await fleetScopeStorage.getFleetCostImportMeta();
      res.json({ meta });
    } catch (error: any) {
      console.error("Error fetching fleet cost meta:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Server-side file upload for fleet cost data (handles large files with background processing)
  app.post("/fleet-cost/upload-file", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const importedBy = req.body.importedBy || "Unknown";
      const { generateJobId, createJob, saveUploadedFile, processJobInBackground } = await import('./fleet-scope-fleet-cost-jobs');
      
      const jobId = generateJobId();
      console.log(`[Fleet Cost] Created job ${jobId} for file: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

      saveUploadedFile(jobId, req.file.buffer);
      createJob(jobId, req.file.originalname, importedBy);
      
      processJobInBackground(jobId);

      res.json({
        success: true,
        jobId,
        message: "Upload started. Processing in background.",
      });
    } catch (error: any) {
      console.error("[Fleet Cost] Error starting upload job:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/fleet-cost/job/:jobId", async (req, res) => {
    try {
      const { getJob } = await import('./fleet-scope-fleet-cost-jobs');
      const job = getJob(req.params.jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Upload fleet cost data in chunks (upsert logic - never deletes existing records)
  app.post("/fleet-cost/upload-chunk", async (req, res) => {
    try {
      const { rows, headers, importedBy, chunkIndex, totalChunks, keyColumn: providedKeyColumn } = req.body;
      
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      
      if (!headers || !Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ message: "No headers provided" });
      }

      // Use provided key column or auto-detect on first chunk
      let keyColumn = providedKeyColumn;
      
      if (!keyColumn) {
        // Auto-detect key column from common identifier patterns
        const keyColumnPatterns = [
          'vehicle number', 'vehiclenumber', 'vehicle_number', 'vehicle #', 'vehicle#',
          'asset id', 'assetid', 'asset_id',
          'vin',
          'truck number', 'trucknumber', 'truck_number', 'truck #', 'truck#',
          'unit number', 'unitnumber', 'unit_number', 'unit #', 'unit#',
          'fleet number', 'fleetnumber', 'fleet_number', 'fleet #', 'fleet#',
          'id', 'identifier'
        ];

        const lowerHeaders = headers.map((h: string) => h.toLowerCase().trim());
        
        for (const pattern of keyColumnPatterns) {
          const index = lowerHeaders.findIndex((h: string) => h === pattern || h.includes(pattern));
          if (index !== -1) {
            keyColumn = headers[index];
            break;
          }
        }

        if (!keyColumn) {
          keyColumn = headers[0];
        }
      }

      console.log(`[Fleet Cost] Processing chunk ${chunkIndex + 1}/${totalChunks} with ${rows.length} rows, key column: ${keyColumn}`);

      // Transform rows for upsert - use content-based composite key to prevent duplicates
      const recordsToUpsert = rows.map((row: Record<string, unknown>) => {
        // Create composite key from data content to prevent duplicates on re-import
        const vehicleNo = String(row['VEHICLE_NO'] || row['Vehicle Number'] || row['VehicleNumber'] || '').trim();
        const billDate = String(row['BILL_PAID_DATE'] || row['Bill Paid Date'] || '').trim();
        const lineType = String(row['LINE_TYPE'] || row['Line Type'] || '').trim();
        const division = String(row['DIVISION'] || row['Division'] || '').trim();
        const extended = String(row['EXTENDED'] || row['Extended'] || '').trim();
        const poNumber = String(row['PO_NUMBER'] || row['PO Number'] || row['PONumber'] || '').trim();
        
        // Content-based key: prevents duplicate imports (6 fields including PO_NUMBER)
        const compositeKey = `${vehicleNo}|${billDate}|${lineType}|${division}|${extended}|${poNumber}`;
        
        return {
          recordKey: compositeKey,
          keyColumn: 'COMPOSITE',
          rawData: row,
          importedBy,
        };
      }).filter((r: { recordKey: string }) => r.recordKey.replace(/\|/g, '') !== '');

      const result = await fleetScopeStorage.upsertFleetCostRecords(recordsToUpsert);

      // Update meta only on last chunk
      if (chunkIndex === totalChunks - 1) {
        const allRecords = await fleetScopeStorage.getAllFleetCostRecords();
        await fleetScopeStorage.updateFleetCostImportMeta(headers, keyColumn!, allRecords.length, importedBy);
        console.log(`[Fleet Cost] All chunks complete: total records in database: ${allRecords.length}`);
      }
      
      res.json({ 
        success: true,
        inserted: result.inserted,
        updated: result.updated,
        processedInChunk: recordsToUpsert.length,
        keyColumn,
        chunkIndex,
        totalChunks,
      });
    } catch (error: any) {
      console.error("Error uploading fleet cost chunk:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Upload fleet cost data (upsert logic - never deletes existing records)
  app.post("/fleet-cost/upload", async (req, res) => {
    try {
      const { rows, headers, importedBy } = req.body;
      
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      
      if (!headers || !Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ message: "No headers provided" });
      }

      console.log(`[Fleet Cost] Processing ${rows.length} rows with content-based composite key`);

      // Transform rows for upsert - use content-based composite key to prevent duplicates
      const recordsToUpsert = rows.map((row: Record<string, unknown>) => {
        // Create composite key from data content to prevent duplicates on re-import
        const vehicleNo = String(row['VEHICLE_NO'] || row['Vehicle Number'] || row['VehicleNumber'] || '').trim();
        const billDate = String(row['BILL_PAID_DATE'] || row['Bill Paid Date'] || '').trim();
        const lineType = String(row['LINE_TYPE'] || row['Line Type'] || '').trim();
        const division = String(row['DIVISION'] || row['Division'] || '').trim();
        const extended = String(row['EXTENDED'] || row['Extended'] || '').trim();
        const poNumber = String(row['PO_NUMBER'] || row['PO Number'] || row['PONumber'] || '').trim();
        
        // Content-based key: prevents duplicate imports (6 fields including PO_NUMBER)
        const compositeKey = `${vehicleNo}|${billDate}|${lineType}|${division}|${extended}|${poNumber}`;
        
        return {
          recordKey: compositeKey,
          keyColumn: 'COMPOSITE',
          rawData: row,
          importedBy,
        };
      }).filter((r: { recordKey: string }) => r.recordKey.replace(/\|/g, '') !== '');

      if (recordsToUpsert.length === 0) {
        return res.status(400).json({ message: "No valid records found. Make sure your data has VEHICLE_NO, BILL_PAID_DATE, LINE_TYPE, DIVISION, and EXTENDED columns." });
      }

      const result = await fleetScopeStorage.upsertFleetCostRecords(recordsToUpsert);
      await fleetScopeStorage.updateFleetCostImportMeta(headers, 'COMPOSITE', recordsToUpsert.length, importedBy);

      console.log(`[Fleet Cost] Import complete: ${result.inserted} inserted, ${result.updated} updated`);
      
      res.json({ 
        success: true,
        inserted: result.inserted,
        updated: result.updated,
        totalProcessed: recordsToUpsert.length,
        keyColumn: 'COMPOSITE',
      });
    } catch (error: any) {
      console.error("Error uploading fleet cost data:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =====================
  // VEHICLE MAINTENANCE COSTS ROUTES
  // =====================
  
  // Import vehicle maintenance costs from pasted data
  app.post("/maintenance-costs/import", async (req, res) => {
    try {
      const { data } = req.body;
      
      if (!data || typeof data !== 'string') {
        return res.status(400).json({ message: "No data provided. Please paste the maintenance cost data." });
      }
      
      // Parse tab-separated values
      const lines = data.trim().split('\n');
      if (lines.length < 2) {
        return res.status(400).json({ message: "No data rows found. Expected header row plus data rows." });
      }
      
      // Skip header row
      const records: Array<{ vehicleNumber: string; lifetimeMaintenance: string; lifetimeMaintenanceNumeric: number }> = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Split by tab or multiple spaces
        const parts = line.split(/\t+|\s{2,}/);
        if (parts.length < 2) continue;
        
        const vehicleNumber = parts[0].trim();
        const maintenanceValue = parts[1].trim();
        
        // Parse dollar value to numeric (in cents for precision)
        // Format: $36,871.91 -> 3687191
        let numericValue = 0;
        const cleanedValue = maintenanceValue.replace(/[$,]/g, '');
        const parsed = parseFloat(cleanedValue);
        if (!isNaN(parsed)) {
          numericValue = Math.round(parsed * 100);
        }
        
        if (vehicleNumber) {
          records.push({
            vehicleNumber,
            lifetimeMaintenance: maintenanceValue,
            lifetimeMaintenanceNumeric: numericValue
          });
        }
      }
      
      if (records.length === 0) {
        return res.status(400).json({ message: "No valid records found in the pasted data." });
      }
      
      // Batch upsert to database
      let inserted = 0;
      let updated = 0;
      
      for (const record of records) {
        await getDb().insert(vehicleMaintenanceCosts)
          .values({
            vehicleNumber: record.vehicleNumber,
            lifetimeMaintenance: record.lifetimeMaintenance,
            lifetimeMaintenanceNumeric: record.lifetimeMaintenanceNumeric
          })
          .onConflictDoUpdate({
            target: vehicleMaintenanceCosts.vehicleNumber,
            set: {
              lifetimeMaintenance: record.lifetimeMaintenance,
              lifetimeMaintenanceNumeric: record.lifetimeMaintenanceNumeric,
              updatedAt: sql`now()`
            }
          });
        inserted++;
      }
      
      console.log(`[Maintenance Costs] Imported ${inserted} records`);
      
      res.json({
        success: true,
        message: `Successfully imported ${inserted} maintenance cost records`,
        count: inserted
      });
    } catch (error: any) {
      console.error("Error importing maintenance costs:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get all maintenance costs
  app.get("/maintenance-costs", async (req, res) => {
    try {
      const costs = await getDb().select().from(vehicleMaintenanceCosts);
      res.json({ 
        success: true, 
        count: costs.length, 
        data: costs 
      });
    } catch (error: any) {
      console.error("Error fetching maintenance costs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Fleet Cost Analytics - weekly/monthly/annual breakdown by Line_Type using SQL aggregation
  app.get("/fleet-cost/analytics", async (req, res) => {
    try {
      // Use SQL aggregation for performance - counts ALL records (no deduplication)
      // Database already prevents duplicates via ON CONFLICT DO NOTHING during import
      const analyticsQuery = sql`
        WITH base_records AS (
          SELECT
            raw_data::json->>'LINE_TYPE' as line_type,
            raw_data::json->>'DIVISION' as division,
            raw_data::json->>'VEHICLE_NO' as vehicle_no,
            CAST(raw_data::json->>'EXTENDED' AS DECIMAL) as extended_amount,
            DATE '1899-12-30' + FLOOR(CAST(raw_data::json->>'BILL_PAID_DATE' AS DECIMAL))::int as bill_date
          FROM fleet_cost_records
          WHERE raw_data::json->>'BILL_PAID_DATE' IS NOT NULL
            AND raw_data::json->>'EXTENDED' IS NOT NULL
            AND (raw_data::json->>'DIVISION' = '01' OR raw_data::json->>'DIVISION' = 'RF')
        ),
        filtered_data AS (
          SELECT 
            line_type,
            vehicle_no,
            extended_amount,
            bill_date,
            EXTRACT(YEAR FROM bill_date) as year,
            EXTRACT(MONTH FROM bill_date) as month,
            EXTRACT(WEEK FROM bill_date + INTERVAL '1 day')::int as week
          FROM base_records
          WHERE bill_date >= '2024-01-01'
        )
        SELECT 
          line_type,
          year::int,
          month::int,
          week::int,
          SUM(extended_amount) as total_amount,
          COUNT(*) as record_count,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY line_type, year, month, week
        ORDER BY year DESC, month DESC, week DESC, line_type
      `;
      
      // Get unique vehicles per week (across all line types except RENTAL)
      // Group by year and week only - NOT month, since weeks can span months
      const uniqueVehiclesWeeklyQuery = sql`
        WITH base_records AS (
          SELECT
            raw_data::json->>'VEHICLE_NO' as vehicle_no,
            raw_data::json->>'LINE_TYPE' as line_type,
            DATE '1899-12-30' + FLOOR(CAST(raw_data::json->>'BILL_PAID_DATE' AS DECIMAL))::int as bill_date
          FROM fleet_cost_records
          WHERE raw_data::json->>'BILL_PAID_DATE' IS NOT NULL
            AND raw_data::json->>'EXTENDED' IS NOT NULL
            AND (raw_data::json->>'DIVISION' = '01' OR raw_data::json->>'DIVISION' = 'RF')
        ),
        filtered_data AS (
          SELECT 
            vehicle_no,
            bill_date,
            EXTRACT(YEAR FROM bill_date) as year,
            EXTRACT(WEEK FROM bill_date + INTERVAL '1 day')::int as week
          FROM base_records
          WHERE bill_date >= '2024-01-01'
            AND UPPER(COALESCE(line_type, '')) != 'RENTAL'
        )
        SELECT 
          year::int,
          week::int,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY year, week
        ORDER BY year DESC, week DESC
      `;
      
      // Get unique vehicles per month (excluding RENTAL line types)
      const uniqueVehiclesMonthlyQuery = sql`
        WITH base_records AS (
          SELECT
            raw_data::json->>'VEHICLE_NO' as vehicle_no,
            raw_data::json->>'LINE_TYPE' as line_type,
            DATE '1899-12-30' + FLOOR(CAST(raw_data::json->>'BILL_PAID_DATE' AS DECIMAL))::int as bill_date
          FROM fleet_cost_records
          WHERE raw_data::json->>'BILL_PAID_DATE' IS NOT NULL
            AND raw_data::json->>'EXTENDED' IS NOT NULL
            AND (raw_data::json->>'DIVISION' = '01' OR raw_data::json->>'DIVISION' = 'RF')
        ),
        filtered_data AS (
          SELECT 
            vehicle_no,
            bill_date,
            EXTRACT(YEAR FROM bill_date) as year,
            EXTRACT(MONTH FROM bill_date) as month
          FROM base_records
          WHERE bill_date >= '2024-01-01'
            AND UPPER(COALESCE(line_type, '')) != 'RENTAL'
        )
        SELECT 
          year::int,
          month::int,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY year, month
        ORDER BY year DESC, month DESC
      `;
      
      const [results, weeklyVehiclesResults, monthlyVehiclesResults] = await Promise.all([
        getDb().execute(analyticsQuery),
        getDb().execute(uniqueVehiclesWeeklyQuery),
        getDb().execute(uniqueVehiclesMonthlyQuery)
      ]);
      
      // Build unique vehicle count structures
      const weeklyVehicleCounts: Record<string, number> = {};
      const monthlyVehicleCounts: Record<string, number> = {};
      const annualVehicleCounts: Record<string, number> = {};
      
      // Process weekly vehicle counts
      for (const row of weeklyVehiclesResults.rows as Record<string, unknown>[]) {
        const year = Number(row.year);
        const week = Number(row.week);
        const uniqueVehicles = Number(row.unique_vehicles) || 0;
        
        const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
        weeklyVehicleCounts[weekKey] = uniqueVehicles;
      }
      
      // Process monthly vehicle counts (true distinct counts per month)
      for (const row of monthlyVehiclesResults.rows as Record<string, unknown>[]) {
        const year = Number(row.year);
        const month = Number(row.month);
        const uniqueVehicles = Number(row.unique_vehicles) || 0;
        
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        monthlyVehicleCounts[monthKey] = uniqueVehicles;
        
        // Accumulate for annual counts
        const yearKey = String(year);
        annualVehicleCounts[yearKey] = (annualVehicleCounts[yearKey] || 0) + uniqueVehicles;
      }
      
      // Build analytics structures from SQL results
      const weekly: Record<string, Record<string, number>> = {};
      const weeklyDates: Record<string, { start: string; end: string }> = {};
      const monthly: Record<string, Record<string, number>> = {};
      const annual: Record<string, Record<string, number>> = {};
      const lineTypesSet = new Set<string>();
      let processedCount = 0;
      
      // Helper to get week start (Sunday) and end (Saturday) dates
      const getWeekDates = (year: number, weekNum: number): { start: string; end: string } => {
        // Find first Sunday on or before Jan 1
        const firstSunday = new Date(Date.UTC(year, 0, 1));
        firstSunday.setUTCDate(firstSunday.getUTCDate() - firstSunday.getUTCDay());
        // Calculate target week's Sunday
        const start = new Date(firstSunday);
        start.setUTCDate(start.getUTCDate() + (weekNum - 1) * 7);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        const fmt = (d: Date) => `${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCDate().toString().padStart(2, '0')}`;
        return { start: fmt(start), end: fmt(end) };
      };
      
      for (const row of results.rows as Record<string, unknown>[]) {
        const lineType = row.line_type || 'Unknown';
        const year = Number(row.year);
        const month = Number(row.month);
        const week = Number(row.week);
        const amount = Number(row.total_amount) || 0;
        const count = Number(row.record_count) || 0;
        
        lineTypesSet.add(lineType);
        processedCount += count;
        
        // Weekly
        const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
        if (!weekly[weekKey]) {
          weekly[weekKey] = {};
          weeklyDates[weekKey] = getWeekDates(year, week);
        }
        weekly[weekKey][lineType] = (weekly[weekKey][lineType] || 0) + amount;
        
        // Monthly
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        if (!monthly[monthKey]) monthly[monthKey] = {};
        monthly[monthKey][lineType] = (monthly[monthKey][lineType] || 0) + amount;
        
        // Annual
        const yearKey = String(year);
        if (!annual[yearKey]) annual[yearKey] = {};
        annual[yearKey][lineType] = (annual[yearKey][lineType] || 0) + amount;
      }
      
      // Calculate grand totals for logging
      const annualTotal = Object.values(annual).reduce((sum, lineData) => 
        sum + Object.values(lineData).reduce((s, v) => s + v, 0), 0);
      
      console.log(`[Fleet Cost Analytics] SQL aggregation complete: ${processedCount} records`);
      console.log(`[Fleet Cost Analytics] Grand total: $${annualTotal.toLocaleString()}`);
      
      // Calculate 4-week rolling average forecast for next week
      const lineTypes = Array.from(lineTypesSet).sort();
      const sortedWeeks = Object.keys(weekly).sort().reverse(); // Most recent first
      const last4Weeks = sortedWeeks.slice(0, 4);
      
      // Calculate forecast for each line type using TRUE 4-week rolling average
      // Missing weeks are treated as zero (important for accurate averaging)
      const forecast: Record<string, number> = {};
      const forecastDetails: Record<string, { weeks: string[]; values: number[]; average: number }> = {};
      
      for (const lineType of lineTypes) {
        const values: number[] = [];
        const weeks: string[] = [];
        // Always use exactly 4 weeks, treating missing data as 0
        for (const weekKey of last4Weeks) {
          const amount = weekly[weekKey]?.[lineType] || 0;
          values.push(amount);
          weeks.push(weekKey);
        }
        // Always divide by 4 (or number of weeks available if less than 4)
        const divisor = Math.max(last4Weeks.length, 1);
        const sum = values.reduce((a, b) => a + b, 0);
        const average = sum / divisor;
        forecast[lineType] = Math.round(average * 100) / 100;
        forecastDetails[lineType] = { weeks, values, average };
      }
      
      // Calculate total forecast
      const forecastTotal = Object.values(forecast).reduce((a, b) => a + b, 0);
      
      // Determine next week key
      let nextWeekKey = '';
      let nextWeekDates = { start: '', end: '' };
      if (sortedWeeks.length > 0) {
        const lastWeek = sortedWeeks[0];
        const [yearStr, weekStr] = lastWeek.split('-W');
        const year = parseInt(yearStr);
        const week = parseInt(weekStr);
        // Calculate next week
        if (week >= 52) {
          nextWeekKey = `${year + 1}-W01`;
          nextWeekDates = getWeekDates(year + 1, 1);
        } else {
          nextWeekKey = `${year}-W${(week + 1).toString().padStart(2, '0')}`;
          nextWeekDates = getWeekDates(year, week + 1);
        }
      }
      
      console.log(`[Fleet Cost Analytics] Forecast for ${nextWeekKey}: $${forecastTotal.toLocaleString()} (4-week avg)`);
      
      res.json({
        weekly,
        weeklyDates,
        weeklyVehicleCounts,
        monthly,
        monthlyVehicleCounts,
        annual,
        annualVehicleCounts,
        lineTypes,
        processedCount,
        skippedCount: 0,
        forecast: {
          nextWeek: nextWeekKey,
          nextWeekDates,
          byLineType: forecast,
          total: forecastTotal,
          basedOnWeeks: last4Weeks,
          details: forecastDetails,
        },
      });
    } catch (error: any) {
      console.error("Error generating fleet cost analytics:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =================== APPROVED COST ENDPOINTS (Pending Billing) ===================
  
  // Get approved cost record count
  app.get("/approved-cost/count", async (req, res) => {
    try {
      const count = await fleetScopeStorage.getApprovedCostRecordCount();
      res.json({ count });
    } catch (error: any) {
      console.error("Error getting approved cost count:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get approved cost import metadata
  app.get("/approved-cost/meta", async (req, res) => {
    try {
      const meta = await fleetScopeStorage.getApprovedCostImportMeta();
      res.json(meta || null);
    } catch (error: any) {
      console.error("Error getting approved cost meta:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Upload approved cost data (uses PO DATE and AMOUNT columns)
  app.post("/approved-cost/upload", async (req, res) => {
    try {
      const { rows, headers, importedBy } = req.body;
      
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      
      if (!headers || !Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ message: "No headers provided" });
      }

      console.log(`[Approved Cost] Processing ${rows.length} rows - clearing old data first`);

      // Clear all existing approved cost records before importing new data
      await getDb().delete(approvedCostRecords);
      console.log(`[Approved Cost] Cleared existing records`);

      // Transform rows for insert - use content-based composite key
      // Approved POs use PO DATE and AMOUNT columns (not BILL_PAID_DATE and EXTENDED)
      // Include row index to prevent deduplication of rows with same key fields
      const recordsToUpsert = rows.map((row: Record<string, unknown>, rowIndex: number) => {
        // Look for common column name variations for approved POs
        // Handle multiple case variations
        const vehicleNo = String(row['VEHICLE_NO'] || row['Vehicle_No'] || row['Vehicle Number'] || row['VehicleNumber'] || row['VEHICLE'] || row['Vehicle'] || row['vehicle'] || '').trim();
        const poDate = String(row['PO DATE'] || row['PO Date'] || row['Po Date'] || row['PO_DATE'] || row['PoDate'] || row['PODATE'] || row['po date'] || '').trim();
        const division = String(row['DIVISION'] || row['Division'] || row['division'] || '').trim();
        const amount = String(row['AMOUNT'] || row['Amount'] || row['amount'] || row['PO AMOUNT'] || row['PO_AMOUNT'] || '').trim();
        const poNumber = String(row['PO NUMBER'] || row['PO_NUMBER'] || row['PO Number'] || row['PONumber'] || row['PO #'] || row['Po #'] || row['po number'] || row['Repair'] || row['repair'] || '').trim();
        const vendor = String(row['VENDOR'] || row['Vendor'] || row['vendor'] || '').trim().substring(0, 50);
        
        // Content-based key for approved POs - include vendor snippet and row index to prevent false deduplication
        const compositeKey = `${vehicleNo}|${poDate}|${division}|${amount}|${poNumber}|${vendor}|${rowIndex}`;
        
        return {
          recordKey: compositeKey,
          keyColumn: 'COMPOSITE',
          rawData: row,
          importedBy,
        };
      }).filter((r: { recordKey: string }) => r.recordKey.replace(/\|/g, '').replace(/\d+$/, '') !== '');

      if (recordsToUpsert.length === 0) {
        return res.status(400).json({ message: "No valid records found. Make sure your data has VEHICLE_NO, PO DATE, DIVISION, and AMOUNT columns." });
      }

      const result = await fleetScopeStorage.upsertApprovedCostRecords(recordsToUpsert);
      await fleetScopeStorage.updateApprovedCostImportMeta(headers, 'COMPOSITE', recordsToUpsert.length, importedBy);

      console.log(`[Approved Cost] Import complete: ${result.inserted} inserted, ${result.updated} updated`);
      
      res.json({ 
        success: true,
        inserted: result.inserted,
        updated: result.updated,
        totalProcessed: recordsToUpsert.length,
        keyColumn: 'COMPOSITE',
      });
    } catch (error: any) {
      console.error("Error uploading approved cost data:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Approved Cost Analytics - weekly/monthly/annual breakdown (NO LINE_TYPE - only total AMOUNT)
  // Uses PO DATE (Excel serial date) and AMOUNT columns
  // Sunday-Saturday week grouping with single-month assignment based on week end date
  app.get("/approved-cost/analytics", async (req, res) => {
    try {
      // SQL aggregation for approved POs - uses PO DATE and AMOUNT
      // Handle multiple column name variations (uppercase/titlecase)
      // Split costs: "Rental" (Vendor contains Enterprise, Hertz, Avis, Rent-A-Car case-INSENSITIVE) vs "All other Fleet costs"
      const analyticsQuery = sql`
        WITH base_records AS (
          SELECT
            COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') as division,
            COALESCE(raw_data::json->>'VEHICLE_NO', raw_data::json->>'Vehicle_No', raw_data::json->>'Vehicle', raw_data::json->>'vehicle') as vehicle_no,
            COALESCE(raw_data::json->>'VENDOR', raw_data::json->>'Vendor', raw_data::json->>'vendor') as vendor,
            CAST(NULLIF(COALESCE(raw_data::json->>'AMOUNT', raw_data::json->>'Amount', raw_data::json->>'amount'), '') AS DECIMAL) as amount,
            DATE '1899-12-30' + FLOOR(CAST(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date') AS DECIMAL))::int as po_date
          FROM approved_cost_records
          WHERE NULLIF(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date'), '') IS NOT NULL
            AND NULLIF(COALESCE(raw_data::json->>'AMOUNT', raw_data::json->>'Amount', raw_data::json->>'amount'), '') IS NOT NULL
            AND (COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = '01' 
                 OR COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = 'RF')
        ),
        filtered_data AS (
          SELECT 
            vehicle_no,
            amount,
            po_date,
            EXTRACT(ISOYEAR FROM po_date + INTERVAL '1 day') as year,
            EXTRACT(MONTH FROM po_date) as month,
            EXTRACT(WEEK FROM po_date + INTERVAL '1 day')::int as week,
            CASE 
              WHEN vendor ILIKE '%Enterprise%' 
                OR vendor ILIKE '%Hertz%' 
                OR vendor ILIKE 'Avis%'
                OR vendor ILIKE '% Avis %'
                OR vendor ILIKE '%Rent-A-Car%'
                OR vendor ILIKE '%Rent A Car%'
              THEN 'rental'
              ELSE 'other'
            END as cost_type
          FROM base_records
          WHERE po_date >= '2024-01-01'
        )
        SELECT 
          year::int,
          month::int,
          week::int,
          cost_type,
          SUM(amount) as total_amount,
          COUNT(*) as record_count,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY year, month, week, cost_type
        ORDER BY year DESC, month DESC, week DESC, cost_type
      `;
      
      // Get unique vehicles per week (excluding rental vendors - same logic as Paid POs excludes RENTAL line type)
      const uniqueVehiclesWeeklyQuery = sql`
        WITH base_records AS (
          SELECT
            COALESCE(raw_data::json->>'VEHICLE_NO', raw_data::json->>'Vehicle_No', raw_data::json->>'Vehicle', raw_data::json->>'vehicle') as vehicle_no,
            COALESCE(raw_data::json->>'VENDOR', raw_data::json->>'Vendor', raw_data::json->>'vendor') as vendor,
            DATE '1899-12-30' + FLOOR(CAST(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date') AS DECIMAL))::int as po_date
          FROM approved_cost_records
          WHERE NULLIF(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date'), '') IS NOT NULL
            AND NULLIF(COALESCE(raw_data::json->>'AMOUNT', raw_data::json->>'Amount', raw_data::json->>'amount'), '') IS NOT NULL
            AND (COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = '01' 
                 OR COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = 'RF')
        ),
        filtered_data AS (
          SELECT 
            vehicle_no,
            po_date,
            EXTRACT(ISOYEAR FROM po_date + INTERVAL '1 day') as year,
            EXTRACT(WEEK FROM po_date + INTERVAL '1 day')::int as week
          FROM base_records
          WHERE po_date >= '2024-01-01'
            AND NOT (vendor ILIKE '%Enterprise%' 
                OR vendor ILIKE '%Hertz%' 
                OR vendor ILIKE 'Avis%'
                OR vendor ILIKE '% Avis %'
                OR vendor ILIKE '%Rent-A-Car%'
                OR vendor ILIKE '%Rent A Car%')
        )
        SELECT 
          year::int,
          week::int,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY year, week
        ORDER BY year DESC, week DESC
      `;
      
      // Get unique vehicles per month (excluding rental vendors)
      const uniqueVehiclesMonthlyQuery = sql`
        WITH base_records AS (
          SELECT
            COALESCE(raw_data::json->>'VEHICLE_NO', raw_data::json->>'Vehicle_No', raw_data::json->>'Vehicle', raw_data::json->>'vehicle') as vehicle_no,
            COALESCE(raw_data::json->>'VENDOR', raw_data::json->>'Vendor', raw_data::json->>'vendor') as vendor,
            DATE '1899-12-30' + FLOOR(CAST(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date') AS DECIMAL))::int as po_date
          FROM approved_cost_records
          WHERE NULLIF(COALESCE(raw_data::json->>'PO DATE', raw_data::json->>'PO Date', raw_data::json->>'Po Date', raw_data::json->>'po date'), '') IS NOT NULL
            AND NULLIF(COALESCE(raw_data::json->>'AMOUNT', raw_data::json->>'Amount', raw_data::json->>'amount'), '') IS NOT NULL
            AND (COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = '01' 
                 OR COALESCE(raw_data::json->>'DIVISION', raw_data::json->>'Division', raw_data::json->>'division') = 'RF')
        ),
        filtered_data AS (
          SELECT 
            vehicle_no,
            po_date,
            EXTRACT(YEAR FROM po_date) as year,
            EXTRACT(MONTH FROM po_date) as month
          FROM base_records
          WHERE po_date >= '2024-01-01'
            AND NOT (vendor ILIKE '%Enterprise%' 
                OR vendor ILIKE '%Hertz%' 
                OR vendor ILIKE 'Avis%'
                OR vendor ILIKE '% Avis %'
                OR vendor ILIKE '%Rent-A-Car%'
                OR vendor ILIKE '%Rent A Car%')
        )
        SELECT 
          year::int,
          month::int,
          COUNT(DISTINCT vehicle_no) as unique_vehicles
        FROM filtered_data
        GROUP BY year, month
        ORDER BY year DESC, month DESC
      `;
      
      const [results, weeklyVehiclesResults, monthlyVehiclesResults] = await Promise.all([
        getDb().execute(analyticsQuery),
        getDb().execute(uniqueVehiclesWeeklyQuery),
        getDb().execute(uniqueVehiclesMonthlyQuery)
      ]);
      
      // Build unique vehicle count structures
      const weeklyVehicleCounts: Record<string, number> = {};
      const monthlyVehicleCounts: Record<string, number> = {};
      const annualVehicleCounts: Record<string, number> = {};
      
      // Process weekly vehicle counts
      for (const row of weeklyVehiclesResults.rows as Record<string, unknown>[]) {
        const year = Number(row.year);
        const week = Number(row.week);
        const uniqueVehicles = Number(row.unique_vehicles) || 0;
        
        const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
        weeklyVehicleCounts[weekKey] = uniqueVehicles;
      }
      
      // Process monthly vehicle counts
      for (const row of monthlyVehiclesResults.rows as Record<string, unknown>[]) {
        const year = Number(row.year);
        const month = Number(row.month);
        const uniqueVehicles = Number(row.unique_vehicles) || 0;
        
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        monthlyVehicleCounts[monthKey] = uniqueVehicles;
        
        const yearKey = String(year);
        annualVehicleCounts[yearKey] = (annualVehicleCounts[yearKey] || 0) + uniqueVehicles;
      }
      
      // Build analytics structures - split by Rental vs All other Fleet costs
      const weekly: Record<string, { rental: number; other: number; total: number }> = {};
      const weeklyDates: Record<string, { start: string; end: string }> = {};
      const monthly: Record<string, { rental: number; other: number; total: number }> = {};
      const annual: Record<string, { rental: number; other: number; total: number }> = {};
      let processedCount = 0;
      
      // Helper to get week start (Sunday) and end (Saturday) dates
      const getWeekDates = (year: number, weekNum: number): { start: string; end: string } => {
        const firstSunday = new Date(Date.UTC(year, 0, 1));
        firstSunday.setUTCDate(firstSunday.getUTCDate() - firstSunday.getUTCDay());
        const start = new Date(firstSunday);
        start.setUTCDate(start.getUTCDate() + (weekNum - 1) * 7);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        const fmt = (d: Date) => `${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCDate().toString().padStart(2, '0')}`;
        return { start: fmt(start), end: fmt(end) };
      };
      
      for (const row of results.rows as Record<string, unknown>[]) {
        const year = Number(row.year);
        const month = Number(row.month);
        const week = Number(row.week);
        const costType = row.cost_type as 'rental' | 'other';
        const amount = Number(row.total_amount) || 0;
        const count = Number(row.record_count) || 0;
        
        processedCount += count;
        
        // Weekly
        const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
        if (!weekly[weekKey]) {
          weekly[weekKey] = { rental: 0, other: 0, total: 0 };
          weeklyDates[weekKey] = getWeekDates(year, week);
        }
        weekly[weekKey][costType] += amount;
        weekly[weekKey].total += amount;
        
        // Monthly
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        if (!monthly[monthKey]) monthly[monthKey] = { rental: 0, other: 0, total: 0 };
        monthly[monthKey][costType] += amount;
        monthly[monthKey].total += amount;
        
        // Annual
        const yearKey = String(year);
        if (!annual[yearKey]) annual[yearKey] = { rental: 0, other: 0, total: 0 };
        annual[yearKey][costType] += amount;
        annual[yearKey].total += amount;
      }
      
      // Calculate grand totals for logging
      const annualTotal = Object.values(annual).reduce((sum, data) => sum + data.total, 0);
      
      console.log(`[Approved Cost Analytics] SQL aggregation complete: ${processedCount} records`);
      console.log(`[Approved Cost Analytics] Grand total: $${annualTotal.toLocaleString()}`);
      
      // Calculate 4-week rolling average forecast
      const sortedWeeks = Object.keys(weekly).sort().reverse();
      const last4Weeks = sortedWeeks.slice(0, 4);
      
      const values: number[] = [];
      for (const weekKey of last4Weeks) {
        values.push(weekly[weekKey]?.total || 0);
      }
      const divisor = Math.max(last4Weeks.length, 1);
      const forecastTotal = Math.round((values.reduce((a, b) => a + b, 0) / divisor) * 100) / 100;
      
      // Determine next week key
      let nextWeekKey = '';
      let nextWeekDates = { start: '', end: '' };
      if (sortedWeeks.length > 0) {
        const lastWeek = sortedWeeks[0];
        const [yearStr, weekStr] = lastWeek.split('-W');
        const year = parseInt(yearStr);
        const week = parseInt(weekStr);
        if (week >= 52) {
          nextWeekKey = `${year + 1}-W01`;
          nextWeekDates = getWeekDates(year + 1, 1);
        } else {
          nextWeekKey = `${year}-W${(week + 1).toString().padStart(2, '0')}`;
          nextWeekDates = getWeekDates(year, week + 1);
        }
      }
      
      console.log(`[Approved Cost Analytics] Forecast for ${nextWeekKey}: $${forecastTotal.toLocaleString()} (4-week avg)`);
      
      res.json({
        weekly,
        weeklyDates,
        weeklyVehicleCounts,
        monthly,
        monthlyVehicleCounts,
        annual,
        annualVehicleCounts,
        processedCount,
        forecast: {
          nextWeek: nextWeekKey,
          nextWeekDates,
          total: forecastTotal,
          basedOnWeeks: last4Weeks,
        },
      });
    } catch (error: any) {
      console.error("Error generating approved cost analytics:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Registration tab - get all unique trucks with assignment status and tech details
  app.get("/registration", async (req, res) => {
    try {
      console.log("[Registration] Fetching all trucks with tech details from TPMS_EXTRACT...");
      
      // Query TPMS_EXTRACT for all tech assignments with address info and manager info
      const tpmsQuery = `
        SELECT 
          TRUCK_LU,
          FULL_NAME,
          MOBILEPHONENUMBER,
          PRIMARYADDR1,
          PRIMARYADDR2,
          PRIMARYCITY,
          PRIMARYSTATE,
          PRIMARYZIP,
          MANAGER_NAME,
          MANAGER_ENT_ID,
          ENTERPRISE_ID,
          DISTRICT
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      `;
      
      const tpmsData = await executeQuery<{
        TRUCK_LU: string;
        FULL_NAME: string | null;
        MOBILEPHONENUMBER: string | null;
        PRIMARYADDR1: string | null;
        PRIMARYADDR2: string | null;
        PRIMARYCITY: string | null;
        PRIMARYSTATE: string | null;
        PRIMARYZIP: string | null;
        MANAGER_NAME: string | null;
        MANAGER_ENT_ID: string | null;
        ENTERPRISE_ID: string | null;
        DISTRICT: string | null;
      }>(tpmsQuery);
      
      // Build lookup map for ENTERPRISE_ID -> MOBILEPHONENUMBER (for manager phone lookup)
      const enterpriseIdToPhone = new Map<string, string>();
      for (const row of tpmsData) {
        const entId = row.ENTERPRISE_ID?.toString().trim();
        const phone = row.MOBILEPHONENUMBER?.toString().trim();
        if (entId && phone) {
          enterpriseIdToPhone.set(entId, phone);
        }
      }
      
      // Build lookup map from TPMS data (assigned trucks)
      const tpmsLookup = new Map<string, {
        techName: string;
        techPhone: string;
        fullAddress: string;
        state: string;
        techLeadName: string;
        techLeadPhone: string;
        district: string;
        ldap: string;
      }>();
      
      for (const row of tpmsData) {
        const truckNum = row.TRUCK_LU?.toString().padStart(6, '0') || '';
        if (!truckNum) continue;
        
        // Build full address from components
        const addressParts = [
          row.PRIMARYADDR1?.trim(),
          row.PRIMARYADDR2?.trim(),
          row.PRIMARYCITY?.trim(),
          row.PRIMARYSTATE?.trim(),
          row.PRIMARYZIP?.trim()
        ].filter(Boolean);
        
        const fullAddress = addressParts.join(', ');
        
        // Manager phone lookup: use MANAGER_ENT_ID to find phone number from enterpriseIdToPhone map
        const managerEntId = row.MANAGER_ENT_ID?.toString().trim();
        const managerPhone = managerEntId ? (enterpriseIdToPhone.get(managerEntId) || '') : '';
        
        // Remove leading zeros from district
        const district = row.DISTRICT?.toString().trim().replace(/^0+/, '') || '';
        
        tpmsLookup.set(truckNum, {
          techName: row.FULL_NAME?.toString().trim() || '',
          techPhone: row.MOBILEPHONENUMBER?.toString().trim() || '',
          fullAddress,
          state: row.PRIMARYSTATE?.toString().trim() || '',
          techLeadName: row.MANAGER_NAME?.toString().trim() || '',
          techLeadPhone: managerPhone,
          district,
          ldap: row.ENTERPRISE_ID?.toString().trim() || ''
        });
      }
      
      console.log(`[Registration] Found ${tpmsLookup.size} assigned trucks in TPMS_EXTRACT`);
      
      // Query Holman for TAG_STATE_PROVINCE
      const holmanTagStateQuery = `
        SELECT HOLMAN_VEHICLE_NUMBER, TAG_STATE_PROVINCE
        FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_VEHICLES
        WHERE HOLMAN_VEHICLE_NUMBER IS NOT NULL
      `;
      
      const holmanTagStateData = await executeQuery<{
        HOLMAN_VEHICLE_NUMBER: string;
        TAG_STATE_PROVINCE: string | null;
      }>(holmanTagStateQuery);
      
      // Build lookup map for tag state (normalize truck numbers for matching)
      // Use the same normalization as registration truckNumber: padStart(6, '0')
      const tagStateLookup = new Map<string, string>();
      for (const row of holmanTagStateData) {
        // Normalize: remove non-digits, then padStart to 6 for consistent matching
        const rawNum = row.HOLMAN_VEHICLE_NUMBER?.toString().replace(/\D/g, '') || '';
        if (!rawNum) continue;
        const truckNum = rawNum.padStart(6, '0');
        if (row.TAG_STATE_PROVINCE) {
          tagStateLookup.set(truckNum, row.TAG_STATE_PROVINCE.toString().trim());
        }
      }
      
      console.log(`[Registration] Found ${tagStateLookup.size} trucks with tag state in Holman`);
      
      // Get all unique truck numbers from multiple sources
      const allTruckNumbers = new Set<string>();
      
      // 1. From All Vehicles (REPLIT_ALL_VEHICLES)
      const allVehiclesQuery = `
        SELECT DISTINCT VEHICLE_NUMBER 
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
        WHERE VEHICLE_NUMBER IS NOT NULL
      `;
      const allVehiclesData = await executeQuery<{ VEHICLE_NUMBER: string }>(allVehiclesQuery);
      for (const row of allVehiclesData) {
        const num = row.VEHICLE_NUMBER?.toString().padStart(6, '0');
        if (num) allTruckNumbers.add(num);
      }
      
      // 2. From Spares (spare_vehicle_details table) - query directly with registration date
      const sparesQueryResult = await getDb().select({ 
        vehicleNumber: spareVehicleDetails.vehicleNumber,
        registrationRenewalDate: spareVehicleDetails.registrationRenewalDate
      }).from(spareVehicleDetails);
      
      // Build lookup for spare registration dates
      const spareRegDateLookup = new Map<string, Date | null>();
      for (const spare of sparesQueryResult) {
        const num = spare.vehicleNumber?.toString().padStart(6, '0');
        if (num) {
          allTruckNumbers.add(num);
          spareRegDateLookup.set(num, spare.registrationRenewalDate);
        }
      }
      
      // 3. From local trucks table (also has holmanRegExpiry and repairAddress)
      const localTrucks = await fleetScopeStorage.getAllTrucks();
      const trucksRegDateLookup = new Map<string, string | null>();
      const trucksInRepairShop = new Set<string>();
      for (const truck of localTrucks) {
        const num = truck.truckNumber?.toString().padStart(6, '0');
        if (num) {
          allTruckNumbers.add(num);
          trucksRegDateLookup.set(num, truck.holmanRegExpiry || null);
          // Check if truck has a repair address (indicating it's in a repair shop)
          if (truck.repairAddress && truck.repairAddress.trim()) {
            trucksInRepairShop.add(num);
          }
        }
      }
      
      // 4. Add any trucks from TPMS that might not be in other sources
      for (const truckNum of tpmsLookup.keys()) {
        allTruckNumbers.add(truckNum);
      }
      
      console.log(`[Registration] Total unique trucks: ${allTruckNumbers.size}`);
      
      // Fetch registration tracking data
      const trackingData = await getDb().select().from(registrationTracking);
      const trackingLookup = new Map(trackingData.map(t => [t.truckNumber, t]));
      
      // Build registration data with reg expiry date
      const registrationData = [];
      for (const truckNumber of allTruckNumbers) {
        const tpmsInfo = tpmsLookup.get(truckNumber);
        const isAssigned = !!tpmsInfo;
        const tracking = trackingLookup.get(truckNumber);
        
        // Get registration expiry date from multiple sources (prioritize spare_vehicle_details, then trucks table)
        let regExpDate: string | null = null;
        
        // First check spare_vehicle_details
        const spareRegDate = spareRegDateLookup.get(truckNumber);
        if (spareRegDate) {
          regExpDate = spareRegDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        }
        
        // If not found, check trucks table (holmanRegExpiry)
        if (!regExpDate) {
          const trucksRegDate = trucksRegDateLookup.get(truckNumber);
          if (trucksRegDate) {
            regExpDate = trucksRegDate;
          }
        }
        
        registrationData.push({
          truckNumber,
          tagState: tagStateLookup.get(truckNumber) || '',
          district: tpmsInfo?.district || '',
          assignmentStatus: isAssigned ? 'Assigned' : 'Unassigned',
          regExpDate: regExpDate || '',
          state: tpmsInfo?.state || '',
          ldap: tpmsInfo?.ldap || '',
          techName: tpmsInfo?.techName || '',
          techPhone: tpmsInfo?.techPhone || '',
          techAddress: tpmsInfo?.fullAddress || '',
          initialTextSent: tracking?.initialTextSent || false,
          timeSlotConfirmed: tracking?.timeSlotConfirmed || false,
          timeSlotValue: tracking?.timeSlotValue || '',
          submittedToHolman: tracking?.submittedToHolman || false,
          submittedToHolmanAt: tracking?.submittedToHolmanAt || null,
          alreadySent: tracking?.alreadySent || false,
          comments: tracking?.comments || '',
          techLeadName: tpmsInfo?.techLeadName || '',
          techLeadPhone: tpmsInfo?.techLeadPhone || '',
          inRepairShop: trucksInRepairShop.has(truckNumber)
        });
      }
      
      // Sort by truck number
      registrationData.sort((a, b) => a.truckNumber.localeCompare(b.truckNumber));
      
      // Get declined trucks from purchase orders (repairs tab - trucks with finalApproval = "Decline and Submit for Sale")
      const allPurchaseOrders = await fleetScopeStorage.getAllPurchaseOrders();
      const declinedFromRepairs: string[] = [];
      for (const po of allPurchaseOrders) {
        if (po.finalApproval === "Decline and Submit for Sale") {
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const vehicleNo = rawData["Vehicle_No"] || rawData["Vehicle No"] || rawData["VEHICLE_NO"] || rawData["vehicle_no"] || "";
            if (vehicleNo) {
              const normalized = vehicleNo.toString().padStart(6, '0');
              if (normalized !== '000000') {
                declinedFromRepairs.push(normalized);
              }
            }
          } catch (e) {
            // Skip entries with invalid JSON
            console.warn(`[Registration] Could not parse rawData for PO ${po.poNumber}`);
          }
        }
      }
      
      res.json({
        trucks: registrationData,
        declinedTrucks: declinedFromRepairs,
        summary: {
          total: registrationData.length,
          assigned: registrationData.filter(t => t.assignmentStatus === 'Assigned').length,
          unassigned: registrationData.filter(t => t.assignmentStatus === 'Unassigned').length
        }
      });
      
    } catch (error: any) {
      console.error("[Registration] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update registration tracking fields
  app.patch("/registration/tracking/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const { initialTextSent, timeSlotConfirmed, timeSlotValue, submittedToHolman, alreadySent, comments } = req.body;
      
      console.log(`[Registration Tracking] Updating ${truckNumber}:`, { initialTextSent, timeSlotConfirmed, timeSlotValue, submittedToHolman, alreadySent, comments });
      
      // Get existing record
      const existing = await getDb().select().from(registrationTracking).where(eq(registrationTracking.truckNumber, truckNumber)).limit(1);
      const existingRecord = existing[0];
      
      // Only use provided values; fall back to existing record values (not false)
      const resolvedInitialTextSent = initialTextSent !== undefined ? !!initialTextSent : (existingRecord?.initialTextSent ?? false);
      const resolvedTimeSlotConfirmed = timeSlotConfirmed !== undefined ? !!timeSlotConfirmed : (existingRecord?.timeSlotConfirmed ?? false);
      const resolvedTimeSlotValue = timeSlotValue !== undefined ? (timeSlotValue || null) : (existingRecord?.timeSlotValue || null);
      const resolvedSubmittedToHolman = submittedToHolman !== undefined ? !!submittedToHolman : (existingRecord?.submittedToHolman ?? false);
      const resolvedAlreadySent = alreadySent !== undefined ? !!alreadySent : (existingRecord?.alreadySent ?? false);
      const resolvedComments = comments !== undefined ? comments : (existingRecord?.comments || null);
      
      const wasSubmitted = existingRecord?.submittedToHolman ?? false;
      
      // Set timestamp only when checkbox is newly checked
      const submittedToHolmanAt = (!wasSubmitted && resolvedSubmittedToHolman) ? new Date() : (existingRecord?.submittedToHolmanAt || null);
      
      // Upsert the tracking record
      await getDb()
        .insert(registrationTracking)
        .values({
          truckNumber,
          initialTextSent: resolvedInitialTextSent,
          timeSlotConfirmed: resolvedTimeSlotConfirmed,
          timeSlotValue: resolvedTimeSlotValue,
          submittedToHolman: resolvedSubmittedToHolman,
          submittedToHolmanAt: resolvedSubmittedToHolman ? (submittedToHolmanAt || new Date()) : null,
          alreadySent: resolvedAlreadySent,
          comments: resolvedComments,
        })
        .onConflictDoUpdate({
          target: registrationTracking.truckNumber,
          set: {
            initialTextSent: resolvedInitialTextSent,
            timeSlotConfirmed: resolvedTimeSlotConfirmed,
            timeSlotValue: resolvedTimeSlotValue,
            submittedToHolman: resolvedSubmittedToHolman,
            submittedToHolmanAt: resolvedSubmittedToHolman ? (submittedToHolmanAt || sql`now()`) : null,
            alreadySent: resolvedAlreadySent,
            comments: resolvedComments,
            updatedAt: sql`now()`,
          },
        });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Registration Tracking] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Import registration dates from pasted data
  app.post("/registration/import", async (req, res) => {
    try {
      const { data } = req.body;
      
      if (!data || typeof data !== 'string') {
        return res.status(400).json({ message: "No data provided" });
      }
      
      console.log("[Registration Import] Processing pasted data...");
      
      // Parse tab-separated data
      const lines = data.trim().split('\n');
      const results = { updated: 0, skipped: 0, created: 0, errors: [] as string[] };
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip header row
        if (line.toLowerCase().includes('vehicle number') || line.toLowerCase().includes('registration')) {
          continue;
        }
        
        // Split by tab
        const parts = line.split('\t');
        if (parts.length < 2) {
          results.errors.push(`Line ${i + 1}: Invalid format`);
          continue;
        }
        
        const vehicleNumber = parts[0].trim().padStart(6, '0');
        const dateStr = parts[1].trim();
        
        if (!vehicleNumber || !dateStr) {
          results.skipped++;
          continue;
        }
        
        // Parse date (M/D/YYYY format)
        let parsedDate: Date | null = null;
        try {
          const dateParts = dateStr.split('/');
          if (dateParts.length === 3) {
            const month = parseInt(dateParts[0], 10);
            const day = parseInt(dateParts[1], 10);
            const year = parseInt(dateParts[2], 10);
            parsedDate = new Date(year, month - 1, day);
          }
        } catch (e) {
          results.errors.push(`Line ${i + 1}: Invalid date format for ${vehicleNumber}`);
          continue;
        }
        
        if (!parsedDate || isNaN(parsedDate.getTime())) {
          results.errors.push(`Line ${i + 1}: Invalid date for ${vehicleNumber}`);
          continue;
        }
        
        // Check if vehicle exists in spare_vehicle_details
        const existing = await getDb().select()
          .from(spareVehicleDetails)
          .where(eq(spareVehicleDetails.vehicleNumber, vehicleNumber))
          .limit(1);
        
        if (existing.length > 0) {
          // Only update if registrationRenewalDate is missing
          if (!existing[0].registrationRenewalDate) {
            await getDb().update(spareVehicleDetails)
              .set({ registrationRenewalDate: parsedDate })
              .where(eq(spareVehicleDetails.vehicleNumber, vehicleNumber));
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          // Create new record with registration date for vehicle not yet in spare_vehicle_details
          await getDb().insert(spareVehicleDetails).values({
            vehicleNumber,
            registrationRenewalDate: parsedDate
          });
          results.created++;
        }
      }
      
      console.log(`[Registration Import] Complete: ${results.updated} updated, ${results.created} created, ${results.skipped} skipped, ${results.errors.length} errors`);
      
      res.json({
        success: true,
        updated: results.updated,
        created: results.created,
        skipped: results.skipped,
        errors: results.errors.slice(0, 10) // Only return first 10 errors
      });
      
    } catch (error: any) {
      console.error("[Registration Import] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // =============================================
  // DECOMMISSIONING ENDPOINTS
  // =============================================

  // Get all decommissioning vehicles
  app.get("/decommissioning", async (req, res) => {
    try {
      const vehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
      
      const allTrucks = await fleetScopeStorage.getAllTrucks();
      const rentalTruckNumbers = new Set<string>();
      for (const truck of allTrucks) {
        if (truck.truckNumber) {
          rentalTruckNumbers.add(truck.truckNumber.toString().replace(/^0+/, '') || '0');
        }
      }
      
      const vehiclesWithRental = vehicles.map(v => ({
        ...v,
        withRental: rentalTruckNumbers.has((v.truckNumber || '').replace(/^0+/, '') || '0'),
      }));
      
      res.json(vehiclesWithRental);
    } catch (error: any) {
      console.error("[Decommissioning] Error fetching vehicles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update a decommissioning vehicle field
  app.patch("/decommissioning/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const vehicle = await fleetScopeStorage.updateDecommissioningVehicle(parseInt(id), updates);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }
      
      res.json(vehicle);
    } catch (error: any) {
      console.error("[Decommissioning] Error updating vehicle:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a decommissioning vehicle
  app.delete("/decommissioning/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await fleetScopeStorage.deleteDecommissioningVehicle(parseInt(id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Decommissioning] Error deleting vehicle:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/decommissioning/:id/term-request-file", upload.single('file'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const ext = (file.originalname || "").toLowerCase();
      if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls")) {
        return res.status(400).json({ message: "Only .xlsx or .xls files are accepted" });
      }

      const vehicle = await fleetScopeStorage.getDecommissioningVehicleById(parseInt(id));
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const storageKey = `decommission/term-${vehicle.truckNumber}.xlsx`;

      await client.uploadFromBytes(storageKey, file.buffer);

      const updated = await fleetScopeStorage.updateDecommissioningVehicle(parseInt(id), {
        termRequestFileName: file.originalname,
        termRequestStorageKey: storageKey,
      });

      console.log(`[Decommissioning] Term request file uploaded for truck ${vehicle.truckNumber}: ${file.originalname}`);
      res.json(updated);
    } catch (error: any) {
      console.error("[Decommissioning] Error uploading term request file:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/decommissioning/:id/send-termination-email", async (req, res) => {
    try {
      const { id } = req.params;

      const vehicle = await fleetScopeStorage.getDecommissioningVehicleById(parseInt(id));
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      if (!vehicle.termRequestStorageKey) {
        return res.status(400).json({ message: "No term request file uploaded for this vehicle. Please upload a file first." });
      }

      if (!process.env.FS_SENDGRID_API_KEY) {
        return res.status(503).json({ message: "SendGrid API key not configured (FS_SENDGRID_API_KEY)" });
      }

      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const result = await client.downloadAsBytes(vehicle.termRequestStorageKey);
      if (!result.ok) {
        return res.status(404).json({ message: "Stored file not found in object storage. Please re-upload." });
      }
      const fileBuffer = Buffer.from(result.value);
      const base64Content = fileBuffer.toString("base64");

      sgMail.setApiKey(process.env.FS_SENDGRID_API_KEY);

      const truckNum = vehicle.truckNumber;
      const msg = {
        to: "pranab.dutta@transformco.com",
        from: "notifications@shs.com",
        subject: `Vehicle Termination Request [${truckNum}]`,
        text: `Attached term request for a vehicle not economical to repair or keep road worthy. Please approve and process for termination. Please note that approvals should be routed to Rob Gerlach.\n\nThanks!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <p>Attached term request for a vehicle not economical to repair or keep road worthy. Please approve and process for termination. Please note that approvals should be routed to Rob Gerlach.</p>
            <p>Thanks!</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">This is an automated notification from Fleet Scope.</p>
          </div>
        `,
        attachments: [
          {
            content: base64Content,
            filename: vehicle.termRequestFileName || `term-request-${truckNum}.xlsx`,
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            disposition: "attachment",
          },
        ],
      };

      await sgMail.send(msg);
      console.log(`[Decommissioning] Termination email sent for truck ${truckNum} to pranab.dutta@transformco.com`);
      res.json({ success: true, message: `Termination request email sent for truck ${truckNum}` });
    } catch (error: any) {
      console.error("[Decommissioning] Error sending termination email:", error.message);
      if (error.response) {
        console.error("SendGrid error details:", error.response.body);
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import decommissioning vehicles (paste import)
  app.post("/decommissioning/import", async (req, res) => {
    try {
      const { data } = req.body; // Array of { truckNumber, address, zipCode, phone, comments, stillNotSold }
      
      if (!Array.isArray(data) || data.length === 0) {
        return res.status(400).json({ message: "No data provided" });
      }
      
      // Normalize truck numbers and prepare for upsert
      const vehicles = data.map((row: any) => ({
        truckNumber: row.truckNumber?.toString().padStart(6, '0') || '',
        address: row.address || null,
        zipCode: row.zipCode || null,
        phone: row.phone || null,
        comments: row.comments || null,
        stillNotSold: row.stillNotSold !== false && row.stillNotSold !== '0' && row.stillNotSold?.toString().toLowerCase() !== 'no',
      })).filter((v: any) => v.truckNumber && v.truckNumber !== '000000');
      
      const result = await fleetScopeStorage.bulkUpsertDecommissioningVehicles(vehicles);
      
      console.log(`[Decommissioning Import] Inserted: ${result.inserted}, Updated: ${result.updated}`);
      
      res.json({ 
        success: true, 
        inserted: result.inserted, 
        updated: result.updated,
        total: vehicles.length
      });
    } catch (error: any) {
      console.error("[Decommissioning Import] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Helper function to sync decommissioning tech data from Snowflake
  async function syncDecommissioningTechData(): Promise<{ synced: number; preserved: number; total: number }> {
    const vehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
    if (vehicles.length === 0) {
      return { synced: 0, preserved: 0, total: 0 };
    }

    // TRUCK_NO in TPMS_EXTRACT has leading zeros (e.g., "036023") - keep them
    const truckNumbers = vehicles.map(v => `'${v.truckNumber}'`);

    // Query Snowflake for tech data including all needed fields
    const sql = `
      SELECT 
        TRUCK_NO,
        ENTERPRISE_ID,
        FULL_NAME,
        MOBILEPHONENUMBER,
        PRIMARYZIP,
        MANAGER_ENT_ID,
        MANAGER_NAME
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      WHERE TRUCK_NO IN (${truckNumbers.join(', ')})
    `;

    interface TechRow {
      TRUCK_NO: string;
      ENTERPRISE_ID: string | null;
      FULL_NAME: string | null;
      MOBILEPHONENUMBER: string | null;
      PRIMARYZIP: string | null;
      MANAGER_ENT_ID: string | null;
      MANAGER_NAME: string | null;
    }

    const techData = await executeQuery<TechRow>(sql);

    // Query VIN from HOLMAN_VEHICLES - HOLMAN_VEHICLE_NUMBER is 5 digits (remove first leading zero from our 6-digit format)
    const holmanTruckNumbers = vehicles.map(v => {
      // Remove only the first leading zero to convert 6-digit to 5-digit format
      // e.g., 006611 → 06611, 021148 → 21148
      if (v.truckNumber.startsWith('0') && v.truckNumber.length === 6) {
        return v.truckNumber.substring(1); // Remove first character (leading zero)
      }
      return v.truckNumber;
    });
    const holmanVinSql = `
      SELECT HOLMAN_VEHICLE_NUMBER, VIN
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_VEHICLES
      WHERE HOLMAN_VEHICLE_NUMBER IN (${holmanTruckNumbers.map(n => `'${n}'`).join(', ')})
    `;
    
    interface HolmanRow {
      HOLMAN_VEHICLE_NUMBER: string;
      VIN: string | null;
    }
    
    const holmanData = await executeQuery<HolmanRow>(holmanVinSql);
    console.log(`[Decommissioning Tech Sync] Fetched ${holmanData.length} VINs from HOLMAN_VEHICLES`);
    
    // Build VIN lookup map by normalized truck number (6-digit with leading zeros)
    const vinLookup = new Map<string, string>();
    for (const row of holmanData) {
      if (row.HOLMAN_VEHICLE_NUMBER && row.VIN) {
        // Normalize: pad to 6 digits for consistent matching
        const truckNum = row.HOLMAN_VEHICLE_NUMBER.toString().padStart(6, '0');
        vinLookup.set(truckNum, row.VIN.toString().trim());
      }
    }

    // Also get manager zip codes by querying their ENTERPRISE_ID
    const managerEntIds = new Set<string>();
    for (const row of techData) {
      if (row.MANAGER_ENT_ID) {
        managerEntIds.add(row.MANAGER_ENT_ID.toString().trim());
      }
    }

    // Lookup manager PRIMARYZIP using ENTERPRISE_ID
    const managerZipLookup = new Map<string, string>();
    if (managerEntIds.size > 0) {
      const managerIds = Array.from(managerEntIds).map(id => `'${id}'`).join(', ');
      const managerSql = `
        SELECT ENTERPRISE_ID, PRIMARYZIP
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
        WHERE ENTERPRISE_ID IN (${managerIds})
      `;
      interface ManagerRow {
        ENTERPRISE_ID: string;
        PRIMARYZIP: string | null;
      }
      const managerData = await executeQuery<ManagerRow>(managerSql);
      for (const row of managerData) {
        if (row.ENTERPRISE_ID && row.PRIMARYZIP) {
          managerZipLookup.set(row.ENTERPRISE_ID.toString().trim(), row.PRIMARYZIP);
        }
      }
    }

    // Build lookup map by truck number (padded to 6 digits for matching)
    const techLookup = new Map<string, {
      enterpriseId: string;
      fullName: string;
      mobilePhone: string;
      primaryZip: string;
      managerEntId: string;
      managerName: string;
      managerZip: string;
    }>();

    for (const row of techData) {
      if (row.TRUCK_NO) {
        // TRUCK_NO comes from Snowflake with leading zeros - use as-is
        const truckNo = row.TRUCK_NO.toString().trim();
        const managerEntId = row.MANAGER_ENT_ID?.toString().trim() || '';
        
        techLookup.set(truckNo, {
          enterpriseId: row.ENTERPRISE_ID?.toString().trim() || '',
          fullName: row.FULL_NAME?.toString().trim() || '',
          mobilePhone: row.MOBILEPHONENUMBER?.toString().trim() || '',
          primaryZip: row.PRIMARYZIP?.toString().trim() || '',
          managerEntId: managerEntId,
          managerName: row.MANAGER_NAME?.toString().trim() || '',
          managerZip: managerZipLookup.get(managerEntId) || '',
        });
      }
    }

    // Update each vehicle - only update if Snowflake has data, otherwise preserve existing
    let synced = 0;
    let preserved = 0;
    const unmatchedWithZip: typeof vehicles = []; // Track vehicles needing ZIP fallback
    
    for (const vehicle of vehicles) {
      const snowflakeData = techLookup.get(vehicle.truckNumber);
      // Get VIN for this vehicle
      const vin = vinLookup.get(vehicle.truckNumber) || null;
      
      if (snowflakeData) {
        // Update with fresh data from Snowflake (direct truck match)
        await fleetScopeStorage.updateDecommissioningVehicle(vehicle.id, {
          vin,
          enterpriseId: snowflakeData.enterpriseId || null,
          fullName: snowflakeData.fullName || null,
          mobilePhone: snowflakeData.mobilePhone || null,
          primaryZip: snowflakeData.primaryZip || null,
          managerEntId: snowflakeData.managerEntId || null,
          managerName: snowflakeData.managerName || null,
          managerZip: snowflakeData.managerZip || null,
          techMatchSource: 'truck', // Direct truck number match
          isAssigned: true, // Truck found in TPMS_EXTRACT
          techDataSyncedAt: new Date(),
        });
        synced++;
      } else {
        // Truck not in Snowflake - try ZIP code fallback if vehicle has a zipCode
        if (vehicle.zipCode && vehicle.zipCode.trim()) {
          unmatchedWithZip.push(vehicle);
        } else {
          // No ZIP code to try fallback - mark as not assigned but preserve existing tech data
          // Still update VIN even if no tech data
          await fleetScopeStorage.updateDecommissioningVehicle(vehicle.id, {
            vin,
            isAssigned: false,
          });
          preserved++;
        }
      }
    }

    // ZIP code-based fallback for unmatched vehicles
    // Find nearest MANAGER by comparing vehicle ZIP to manager's PRIMARY_ZIP (MANAGER_ENT_ID → ENTERPRISE_ID lookup)
    let zipFallbackSynced = 0;
    
    if (unmatchedWithZip.length > 0) {
      console.log(`[Decommissioning Tech Sync] Attempting ZIP fallback for ${unmatchedWithZip.length} vehicles - finding nearest managers`);
      
      // Step 1: Get all unique MANAGER_ENT_IDs and their names from TPMS_EXTRACT
      const managersSql = `
        SELECT DISTINCT
          MANAGER_ENT_ID,
          MANAGER_NAME
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
        WHERE MANAGER_ENT_ID IS NOT NULL AND MANAGER_ENT_ID != ''
      `;
      
      interface ManagerRow {
        MANAGER_ENT_ID: string;
        MANAGER_NAME: string | null;
      }
      
      const allManagers = await executeQuery<ManagerRow>(managersSql);
      console.log(`[Decommissioning Tech Sync] Found ${allManagers.length} unique managers`);
      
      // Step 2: Get each manager's PRIMARY_ZIP by matching MANAGER_ENT_ID to ENTERPRISE_ID
      const managerEntIds = allManagers.map(m => m.MANAGER_ENT_ID?.toString().trim()).filter(Boolean);
      
      interface ManagerWithZipRow {
        ENTERPRISE_ID: string;
        FULL_NAME: string | null;
        MOBILEPHONENUMBER: string | null;
        PRIMARYZIP: string | null;
      }
      
      const managerZipLookup = new Map<string, ManagerWithZipRow>();
      
      if (managerEntIds.length > 0) {
        const mgrIds = managerEntIds.map(id => `'${id}'`).join(', ');
        const mgrZipSql = `
          SELECT DISTINCT
            ENTERPRISE_ID,
            FULL_NAME,
            MOBILEPHONENUMBER,
            PRIMARYZIP
          FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
          WHERE ENTERPRISE_ID IN (${mgrIds}) AND PRIMARYZIP IS NOT NULL AND PRIMARYZIP != ''
        `;
        
        const mgrZipData = await executeQuery<ManagerWithZipRow>(mgrZipSql);
        console.log(`[Decommissioning Tech Sync] Found ${mgrZipData.length} managers with ZIP codes`);
        
        for (const row of mgrZipData) {
          if (row.ENTERPRISE_ID && row.PRIMARYZIP) {
            managerZipLookup.set(row.ENTERPRISE_ID.toString().trim(), row);
          }
        }
      }
      
      // Build a list of managers with their ZIP codes for distance comparison
      interface ManagerInfo {
        managerEntId: string;
        managerName: string;
        managerZip: string;
        enterpriseId: string;
        fullName: string;
        mobilePhone: string;
      }
      
      const managersWithZip: ManagerInfo[] = [];
      for (const mgr of allManagers) {
        const mgrEntId = mgr.MANAGER_ENT_ID?.toString().trim();
        if (!mgrEntId) continue;
        
        const mgrDetails = managerZipLookup.get(mgrEntId);
        if (mgrDetails && mgrDetails.PRIMARYZIP) {
          managersWithZip.push({
            managerEntId: mgrEntId,
            managerName: mgr.MANAGER_NAME?.toString().trim() || '',
            managerZip: mgrDetails.PRIMARYZIP.toString().trim(),
            enterpriseId: mgrDetails.ENTERPRISE_ID?.toString().trim() || '',
            fullName: mgrDetails.FULL_NAME?.toString().trim() || '',
            mobilePhone: mgrDetails.MOBILEPHONENUMBER?.toString().trim() || '',
          });
        }
      }
      
      console.log(`[Decommissioning Tech Sync] ${managersWithZip.length} managers available for ZIP-based matching`);
      
      // Helper function to calculate ZIP code distance (simple numeric difference)
      const getZipDistance = (zip1: string, zip2: string): number => {
        const num1 = parseInt(zip1.replace(/\D/g, '').substring(0, 5), 10);
        const num2 = parseInt(zip2.replace(/\D/g, '').substring(0, 5), 10);
        if (isNaN(num1) || isNaN(num2)) return Infinity;
        return Math.abs(num1 - num2);
      };
      
      // For each unmatched vehicle, find the nearest MANAGER by ZIP
      for (const vehicle of unmatchedWithZip) {
        const vehicleZip = vehicle.zipCode?.trim() || '';
        if (!vehicleZip) continue;
        
        let nearestManager: ManagerInfo | null = null;
        let nearestDistance = Infinity;
        
        for (const mgr of managersWithZip) {
          if (!mgr.managerZip) continue;
          const distance = getZipDistance(vehicleZip, mgr.managerZip);
          
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestManager = mgr;
          }
        }
        
        if (nearestManager) {
          // Get VIN for this vehicle
          const vin = vinLookup.get(vehicle.truckNumber) || null;
          // For unassigned trucks matched by manager ZIP, populate manager info in both tech and manager columns
          // Both Tech ZIP and Manager ZIP are the same (manager's ZIP), so distances should be identical
          
          // Check if the fallback ZIP has changed - only clear distances if it changed
          const newFallbackZip = nearestManager.managerZip || null;
          const zipChanged = vehicle.managerZip !== newFallbackZip || vehicle.primaryZip !== newFallbackZip;
          
          const updateData: Record<string, any> = {
            vin,
            enterpriseId: nearestManager.enterpriseId || null,
            fullName: nearestManager.fullName || null,
            mobilePhone: nearestManager.mobilePhone || null,
            primaryZip: newFallbackZip, // Tech ZIP = Manager ZIP (since we matched by manager)
            managerEntId: nearestManager.managerEntId || null,
            managerName: nearestManager.managerName || null,
            managerZip: newFallbackZip,
            techMatchSource: 'manager_zip_fallback', // Matched by nearest manager ZIP code
            isAssigned: false, // Not directly assigned in TPMS_EXTRACT
            techDataSyncedAt: new Date(),
          };
          
          // Only clear distance cache if ZIP changed - preserve existing distances otherwise
          if (zipChanged) {
            updateData.lastTechZipForDistance = null;
            updateData.lastManagerZipForDistance = null;
            updateData.techDistance = null;
            updateData.managerDistance = null;
          }
          
          await fleetScopeStorage.updateDecommissioningVehicle(vehicle.id, updateData);
          zipFallbackSynced++;
          console.log(`[Decommissioning Manager ZIP Fallback] Vehicle ${vehicle.truckNumber} (ZIP ${vehicleZip}) matched to nearest manager ${nearestManager.managerName} (ZIP ${nearestManager.managerZip})`);
        } else {
          // No match found - mark as not assigned but preserve existing tech data
          // Still update VIN even if no tech data
          const vin = vinLookup.get(vehicle.truckNumber) || null;
          await fleetScopeStorage.updateDecommissioningVehicle(vehicle.id, {
            vin,
            isAssigned: false,
          });
          preserved++;
        }
      }
    }

    return { synced, preserved, zipFallbackSynced, total: vehicles.length };
  }

  // Sync tech data from Snowflake to decommissioning vehicles (manual trigger or daily auto)
  app.post("/decommissioning/sync-tech-data", async (req, res) => {
    try {
      const result = await syncDecommissioningTechData();
      console.log(`[Decommissioning Tech Sync] Synced: ${result.synced}, ZIP Fallback: ${result.zipFallbackSynced}, Preserved: ${result.preserved}`);
      
      // After syncing tech data, calculate distances for vehicles that need it
      const distanceResult = await calculateDecommissioningDistances();
      console.log(`[Decommissioning Distance] Calculated: ${distanceResult.calculated}`);
      
      res.json({ ...result, distancesCalculated: distanceResult.calculated });
    } catch (error: any) {
      console.error("[Decommissioning Tech Sync] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync POs with "Decline and Submit for Sale" to Decommissioning table
  app.post("/decommissioning/sync-from-pos", async (req, res) => {
    try {
      const allPurchaseOrders = await fleetScopeStorage.getAllPurchaseOrders();
      const existingDecomVehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
      const existingTruckNumbers = new Set(existingDecomVehicles.map(v => v.truckNumber));
      
      let added = 0;
      let alreadyExists = 0;
      const addedVehicles: string[] = [];
      
      for (const po of allPurchaseOrders) {
        // Check if this PO has "Decline and Submit for Sale" final approval
        if (po.finalApproval?.toLowerCase().includes('decline') && 
            po.finalApproval?.toLowerCase().includes('sale')) {
          try {
            const rawData = po.rawData ? JSON.parse(po.rawData) : {};
            const vehicleNo = rawData['Vehicle_No'] || rawData['Vehicle No'] || rawData['VEHICLE_NO'] || 
                             rawData['Truck #'] || rawData['Truck Number'] || rawData['TRUCK_NUMBER'] || '';
            
            if (vehicleNo) {
              const paddedTruckNumber = vehicleNo.toString().padStart(6, '0');
              
              if (paddedTruckNumber !== '000000' && !existingTruckNumbers.has(paddedTruckNumber)) {
                await fleetScopeStorage.upsertDecommissioningVehicle({
                  truckNumber: paddedTruckNumber,
                  address: null,
                  zipCode: null,
                  phone: null,
                  comments: null,
                  stillNotSold: true,
                });
                existingTruckNumbers.add(paddedTruckNumber);
                addedVehicles.push(paddedTruckNumber);
                added++;
              } else if (existingTruckNumbers.has(paddedTruckNumber)) {
                alreadyExists++;
              }
            }
          } catch (e) {
            console.warn(`[Decommissioning Sync] Could not parse rawData for PO ${po.poNumber}`);
          }
        }
      }
      
      console.log(`[Decommissioning Sync from POs] Added: ${added}, Already exists: ${alreadyExists}`);
      
      res.json({ 
        success: true, 
        added, 
        alreadyExists,
        addedVehicles
      });
    } catch (error: any) {
      console.error("[Decommissioning Sync from POs] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Calculate distances (both manager and tech) for decommissioning vehicles
  async function calculateDecommissioningDistances(): Promise<{ managerCalculated: number; techCalculated: number }> {
    const { calculateDistancesForDecommissioningVehicles } = await import("./fleet-scope-distance-calculator");
    
    const vehicles = await fleetScopeStorage.getDecommissioningVehiclesNeedingDistanceCalc();
    console.log(`[Decommissioning Distance] ${vehicles.length} vehicles need distance calculation`);
    
    if (vehicles.length === 0) {
      return { managerCalculated: 0, techCalculated: 0 };
    }
    
    const results = await calculateDistancesForDecommissioningVehicles(
      vehicles.map(v => ({
        id: v.id,
        zipCode: v.zipCode,
        managerZip: v.managerZip,
        lastManagerZipForDistance: v.lastManagerZipForDistance,
        managerDistance: v.managerDistance,
        primaryZip: v.primaryZip,
        lastTechZipForDistance: v.lastTechZipForDistance,
        techDistance: v.techDistance,
      }))
    );
    
    // Save distances to database (including failures to prevent retry loops)
    let managerSuccess = 0;
    let techSuccess = 0;
    
    for (const result of results) {
      const vehicle = vehicles.find(v => v.id === result.id);
      if (!vehicle) continue;
      
      // Determine what to update
      const managerZipToSave = result.needsManagerCalc ? vehicle.managerZip : null;
      const techZipToSave = result.needsTechCalc ? vehicle.primaryZip : null;
      
      await fleetScopeStorage.updateDecommissioningVehicleDistance(
        result.id,
        result.needsManagerCalc ? result.managerDistance : null,
        managerZipToSave,
        result.needsTechCalc ? result.techDistance : null,
        techZipToSave
      );
      
      if (result.managerDistance !== null) managerSuccess++;
      if (result.techDistance !== null) techSuccess++;
    }
    
    console.log(`[Decommissioning Distance] Calculated ${managerSuccess} manager distances, ${techSuccess} tech distances`);
    return { managerCalculated: managerSuccess, techCalculated: techSuccess };
  }

  // Manual trigger for distance calculation
  app.post("/decommissioning/calculate-distances", async (req, res) => {
    try {
      const result = await calculateDecommissioningDistances();
      res.json(result);
    } catch (error: any) {
      console.error("[Decommissioning Distance] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Sync parts count from Snowflake NTAO_FIELD_VIEW_ASSORTMENT
  async function syncDecommissioningPartsCount(): Promise<{ synced: number; total: number }> {
    const vehicles = await fleetScopeStorage.getAllDecommissioningVehicles();
    if (vehicles.length === 0) {
      return { synced: 0, total: 0 };
    }

    // TRUCK_NO in Snowflake has leading zeros (e.g., "036023")
    const truckNumbers = vehicles.map(v => `'${v.truckNumber}'`);

    // Query Snowflake for parts count and parts space: sum of ON_HAND and CURRENT_TRUCK_CUFT for each truck's latest CURR_DATE
    const sql = `
      WITH LatestDates AS (
        SELECT TRUCK_NO, MAX(CURR_DATE) AS MAX_DATE
        FROM PARTS_SUPPLYCHAIN.ANAPLAN.NTAO_FIELD_VIEW_ASSORTMENT
        WHERE TRUCK_NO IN (${truckNumbers.join(', ')})
        GROUP BY TRUCK_NO
      )
      SELECT a.TRUCK_NO, SUM(a.ON_HAND) AS PARTS_COUNT, MAX(a.CURRENT_TRUCK_CUFT) AS PARTS_SPACE
      FROM PARTS_SUPPLYCHAIN.ANAPLAN.NTAO_FIELD_VIEW_ASSORTMENT a
      INNER JOIN LatestDates ld ON a.TRUCK_NO = ld.TRUCK_NO AND a.CURR_DATE = ld.MAX_DATE
      GROUP BY a.TRUCK_NO
    `;

    interface PartsRow {
      TRUCK_NO: string;
      PARTS_COUNT: number | null;
      PARTS_SPACE: number | null;
    }

    let partsData: PartsRow[] = [];
    try {
      partsData = await executeQuery<PartsRow>(sql);
      console.log(`[Decommissioning Parts] Fetched parts data for ${partsData.length} trucks from Snowflake`);
    } catch (error: any) {
      console.error("[Decommissioning Parts] Error fetching from Snowflake:", error?.message || error);
      return { synced: 0, total: vehicles.length };
    }

    // Build lookup map by truck number
    const partsLookup = new Map<string, { count: number; space: number }>();
    for (const row of partsData) {
      if (row.TRUCK_NO) {
        const truckNo = row.TRUCK_NO.toString().trim();
        partsLookup.set(truckNo, {
          count: row.PARTS_COUNT ?? 0,
          space: row.PARTS_SPACE ?? 0,
        });
      }
    }

    // Update each vehicle
    let synced = 0;
    const now = new Date();
    
    for (const vehicle of vehicles) {
      const partsInfo = partsLookup.get(vehicle.truckNumber);
      if (partsInfo !== undefined) {
        await fleetScopeStorage.updateDecommissioningVehicle(vehicle.id, {
          partsCount: partsInfo.count,
          partsSpace: partsInfo.space,
          partsCountSyncedAt: now,
        });
        synced++;
      }
    }

    console.log(`[Decommissioning Parts] Updated ${synced} of ${vehicles.length} vehicles with parts count and space`);
    return { synced, total: vehicles.length };
  }

  // Manual trigger for parts count sync
  app.post("/decommissioning/sync-parts-count", async (req, res) => {
    try {
      const result = await syncDecommissioningPartsCount();
      res.json(result);
    } catch (error: any) {
      console.error("[Decommissioning Parts] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Schedule daily decommissioning tech data sync (runs at 7:35 AM ET, after other syncs)
  function scheduleDecommissioningTechSync() {
    const now = new Date();
    const targetHour = 7;
    const targetMinute = 35;
    
    // Calculate next 7:35 AM ET
    const nextRun = new Date(now);
    nextRun.setUTCHours(targetHour + 5, targetMinute, 0, 0); // ET is UTC-5
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const msUntilNextRun = nextRun.getTime() - now.getTime();
    
    setTimeout(async () => {
      console.log(`[Decommissioning Scheduler] Starting daily tech data sync at ${new Date().toISOString()}`);
      try {
        const result = await syncDecommissioningTechData();
        console.log(`[Decommissioning Scheduler] Daily sync complete: ${result.synced} synced, ${result.preserved} preserved`);
        // Also calculate distances after tech data sync
        const distanceResult = await calculateDecommissioningDistances();
        console.log(`[Decommissioning Scheduler] Distance calculation complete: ${distanceResult.managerCalculated} manager, ${distanceResult.techCalculated} tech`);
      } catch (error) {
        console.error("[Decommissioning Scheduler] Daily sync error:", error);
      }
      // Schedule next run
      scheduleDecommissioningTechSync();
    }, msUntilNextRun);
    
    console.log(`[Decommissioning Scheduler] Next tech data sync scheduled for 7:35 AM ET (${nextRun.toISOString()})`);
  }

  // Run initial sync on startup and schedule daily
  setTimeout(async () => {
    console.log("[Decommissioning Scheduler] Running initial tech data sync on startup...");
    try {
      const result = await syncDecommissioningTechData();
      console.log(`[Decommissioning Scheduler] Initial sync complete: ${result.synced} synced, ${result.preserved} preserved`);
      // Also calculate distances after tech data sync
      const distanceResult = await calculateDecommissioningDistances();
      console.log(`[Decommissioning Scheduler] Distance calculation complete: ${distanceResult.managerCalculated} manager, ${distanceResult.techCalculated} tech`);
    } catch (error) {
      console.error("[Decommissioning Scheduler] Initial sync error:", error);
    }
    scheduleDecommissioningTechSync();
  }, 5000); // Wait 5 seconds after startup

  // ============================================================
  // REGISTRATION MESSAGING — Bidirectional SMS with technicians
  // ============================================================

  // In-memory cache of tech phone → truck number mapping (refreshed on demand from registration endpoint)
  let techPhoneLookup: Map<string, { truckNumber: string; techId: string; techName: string; state: string }> | null = null;
  let techPhoneLookupAt: Date | null = null;

  async function getTechPhoneLookup(): Promise<Map<string, { truckNumber: string; techId: string; techName: string; state: string }>> {
    const now = new Date();
    if (techPhoneLookup && techPhoneLookupAt && (now.getTime() - techPhoneLookupAt.getTime()) < 5 * 60 * 1000) {
      return techPhoneLookup;
    }
    // Rebuild from TPMS data
    const tpmsQuery = `
      SELECT TRUCK_LU, ENTERPRISE_ID, FULL_NAME, MOBILEPHONENUMBER, PRIMARYSTATE
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      WHERE MOBILEPHONENUMBER IS NOT NULL
    `;
    const tpmsData = await executeQuery<{ TRUCK_LU: string; ENTERPRISE_ID: string; FULL_NAME: string; MOBILEPHONENUMBER: string; PRIMARYSTATE: string }>(tpmsQuery);
    const map = new Map<string, { truckNumber: string; techId: string; techName: string; state: string }>();
    for (const row of tpmsData) {
      const truckNumber = row.TRUCK_LU?.toString().padStart(6, '0');
      const rawPhone = row.MOBILEPHONENUMBER?.toString().replace(/\D/g, '') || '';
      if (!truckNumber || !rawPhone) continue;
      const last10 = rawPhone.slice(-10);
      map.set(last10, {
        truckNumber,
        techId: row.ENTERPRISE_ID?.toString().trim() || '',
        techName: row.FULL_NAME?.toString().trim() || '',
        state: row.PRIMARYSTATE?.toString().trim() || '',
      });
    }
    techPhoneLookup = map;
    techPhoneLookupAt = now;
    return map;
  }

  // GET /api/reg-messages/:truckNumber — fetch conversation for a truck
  app.get("/reg-messages/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const normalized = truckNumber.padStart(6, '0');
      const messages = await getDb()
        .select()
        .from(regMessages)
        .where(eq(regMessages.truckNumber, normalized))
        .orderBy(regMessages.sentAt);
      res.json(messages);
    } catch (error: any) {
      console.error("[RegMsg] Error fetching messages:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/reg-conversations — list all trucks with at least one message
  app.get("/reg-conversations", async (req, res) => {
    try {
      const allMessages = await getDb()
        .select()
        .from(regMessages)
        .orderBy(desc(regMessages.sentAt));

      // Group by truckNumber
      const conversationMap = new Map<string, {
        truckNumber: string;
        techPhone: string;
        techId: string | null;
        lastMessage: string;
        lastMessageAt: Date | null;
        unreadCount: number;
      }>();

      for (const msg of allMessages) {
        if (!conversationMap.has(msg.truckNumber)) {
          conversationMap.set(msg.truckNumber, {
            truckNumber: msg.truckNumber,
            techPhone: msg.techPhone,
            techId: msg.techId,
            lastMessage: msg.body,
            lastMessageAt: msg.sentAt,
            unreadCount: 0,
          });
        }
        if (msg.direction === 'inbound' && !msg.readAt) {
          const conv = conversationMap.get(msg.truckNumber)!;
          conv.unreadCount++;
        }
      }

      const conversations = Array.from(conversationMap.values());
      res.json(conversations);
    } catch (error: any) {
      console.error("[RegMsg] Error fetching conversations:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/reg-messages — send outbound message
  app.post("/reg-messages", async (req, res) => {
    try {
      const { truckNumber, techPhone, techId, body, sentBy, senderName, triggerType } = req.body;

      if (!truckNumber || !body) {
        return res.status(400).json({ message: "truckNumber and body are required" });
      }

      // Get registration data to find tech phone and state if not provided
      let phone = techPhone;
      let state = '';
      let ldap = techId || '';

      if (!phone) {
        // Look up from TPMS via registration endpoint
        const internalUrl = `${req.protocol}://${req.get('host')}/api/fs/registration`;
        try {
          const regResp = await fetch(internalUrl);
          if (regResp.ok) {
            const regData = await regResp.json() as { trucks: any[] };
            const truck = regData.trucks.find((t: any) => t.truckNumber === truckNumber.padStart(6, '0'));
            if (truck) {
              phone = truck.techPhone;
              state = truck.state;
              ldap = truck.ldap;
            }
          }
        } catch (e) {
          console.warn("[RegMsg] Could not fetch registration data for phone lookup");
        }
      }

      if (!phone) {
        return res.status(400).json({ message: "No phone number found for this truck. Technician may be unassigned." });
      }

      const normalized = truckNumber.padStart(6, '0');
      const formattedPhone = phone.replace(/\D/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1');

      // TCPA quiet hours check
      const nextAllowed = getNextAllowedSendTime(state);
      if (nextAllowed) {
        // Schedule instead of sending now
        await getDb().insert(regScheduledMessages).values({
          truckNumber: normalized,
          techId: ldap || null,
          techPhone: formattedPhone,
          body,
          scheduledFor: nextAllowed,
          status: 'pending',
        });
        return res.status(202).json({
          scheduled: true,
          scheduledFor: nextAllowed,
          message: `Message scheduled for ${nextAllowed.toLocaleString()} (TCPA quiet hours in effect)`,
        });
      }

      // Send immediately
      let sid: string | undefined;
      try {
        sid = await sendTwilioMessage(formattedPhone, body);
      } catch (err: any) {
        console.error("[RegMsg] Twilio send error:", err.message);
        // Still save the message as failed
        const [failedMsg] = await getDb().insert(regMessages).values({
          truckNumber: normalized,
          techId: ldap || null,
          techPhone: formattedPhone,
          direction: 'outbound',
          body,
          status: 'failed',
          sentBy: sentBy || null,
          senderName: senderName || null,
          triggerType: triggerType || 'manual',
          autoTriggered: false,
        }).returning();
        return res.status(500).json({ message: "Failed to send SMS: " + err.message, savedMessage: failedMsg });
      }

      const [msg] = await getDb().insert(regMessages).values({
        truckNumber: normalized,
        techId: ldap || null,
        techPhone: formattedPhone,
        direction: 'outbound',
        body,
        status: 'sent',
        twilioSid: sid,
        sentBy: sentBy || null,
        senderName: senderName || null,
        triggerType: triggerType || 'manual',
        autoTriggered: false,
      }).returning();

      broadcastMessage(normalized, { message: msg });
      res.json(msg);
    } catch (error: any) {
      console.error("[RegMsg] Error sending message:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/reg-messages/read/:truckNumber — mark all inbound messages for truck as read
  app.patch("/reg-messages/read/:truckNumber", async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const normalized = truckNumber.padStart(6, '0');
      await getDb()
        .update(regMessages)
        .set({ readAt: new Date() })
        .where(and(
          eq(regMessages.truckNumber, normalized),
          eq(regMessages.direction, 'inbound'),
          isNull(regMessages.readAt)
        ));
      res.json({ success: true });
    } catch (error: any) {
      console.error("[RegMsg] Error marking messages read:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/webhooks/twilio-reg — Twilio inbound SMS webhook
  app.post("/webhooks/twilio-reg", async (req, res) => {
    try {
      // Validate Twilio signature if auth token is configured
      const authToken = process.env.FS_TWILIO_AUTH_TOKEN;
      if (authToken) {
        const twilio = await import('twilio');
        const signature = req.headers['x-twilio-signature'] as string || '';
        const webhookUrl = `${req.protocol}://${req.get('host')}/api/fs/webhooks/twilio-reg`;
        const isValid = twilio.validateRequest(authToken, signature, webhookUrl, req.body);
        if (!isValid) {
          console.warn('[RegMsg] Invalid Twilio signature on webhook request');
          res.set("Content-Type", "text/xml");
          return res.status(403).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }
      }

      const { From, Body, MessageSid } = req.body;

      if (!From || !Body) {
        res.set("Content-Type", "text/xml");
        return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      const fromDigits = From.replace(/\D/g, '').slice(-10);

      // Look up which truck this phone belongs to
      const lookup = await getTechPhoneLookup();
      const techInfo = lookup.get(fromDigits);

      const truckNumber = techInfo?.truckNumber || 'UNKNOWN';
      const techId = techInfo?.techId || null;

      console.log(`[RegMsg] Inbound SMS from ${From} (truck ${truckNumber}): ${Body.slice(0, 80)}`);

      const [msg] = await getDb().insert(regMessages).values({
        truckNumber,
        techId,
        techPhone: From,
        direction: 'inbound',
        body: Body,
        status: 'received',
        twilioSid: MessageSid || null,
        autoTriggered: false,
      }).returning();

      broadcastMessage(truckNumber, { message: msg });

      // Always respond with empty TwiML
      res.set("Content-Type", "text/xml");
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error: any) {
      console.error("[RegMsg] Webhook error:", error);
      res.set("Content-Type", "text/xml");
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  });

  // GET /reports/last-oil-change.csv — Export last oil change per vehicle as CSV (requires auth)
  app.get("/reports/last-oil-change.csv", requireFsAuth, async (req, res) => {
    const escapeCell = (val: string): string => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const formatDate = (raw: string | null): string => {
      if (!raw) return "";
      const d = new Date(raw);
      return isNaN(d.getTime()) ? String(raw) : d.toISOString().split("T")[0];
    };

    const buildCsv = (rows: { CLIENT_VEHICLE_NUMBER: string | null; HOLMAN_VEHICLE_NUMBER: string | null; PO_DATE: string | null; PO_NUMBER: string | null; PO_STATUS: string | null }[]): string => {
      const lines = ["Vehicle Number,Holman Vehicle Number,Last Oil Change Date,PO Number,PO Status"];
      for (const row of rows) {
        lines.push(
          [
            row.CLIENT_VEHICLE_NUMBER ?? "",
            row.HOLMAN_VEHICLE_NUMBER ?? "",
            formatDate(row.PO_DATE),
            row.PO_NUMBER ?? "",
            row.PO_STATUS ?? "",
          ]
            .map(escapeCell)
            .join(",")
        );
      }
      return lines.join("\r\n");
    };

    try {
      // Partition by HOLMAN_VEHICLE_NUMBER when available, fall back to CLIENT_VEHICLE_NUMBER
      // so that vehicles with a null Holman number are not collapsed together.
      const oilChangeSqlWithAta = `
        WITH ranked AS (
          SELECT
            CLIENT_VEHICLE_NUMBER,
            HOLMAN_VEHICLE_NUMBER,
            PO_DATE,
            PO_NUMBER,
            PO_STATUS,
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(NULLIF(TRIM(HOLMAN_VEHICLE_NUMBER), ''), CLIENT_VEHICLE_NUMBER)
              ORDER BY PO_DATE DESC NULLS LAST
            ) AS rn
          FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
          WHERE REPAIR_TYPE_DESCRIPTION = 'PREVENTATIVE MAINT.'
            AND (
              ATA_GROUP_DESC ILIKE '%OIL%'
              OR ATA_GROUP_DESC ILIKE '%LUBE%'
            )
        )
        SELECT
          CLIENT_VEHICLE_NUMBER,
          HOLMAN_VEHICLE_NUMBER,
          PO_DATE,
          PO_NUMBER,
          PO_STATUS
        FROM ranked
        WHERE rn = 1
        ORDER BY COALESCE(NULLIF(TRIM(HOLMAN_VEHICLE_NUMBER), ''), CLIENT_VEHICLE_NUMBER)
      `;

      let rows = await executeQuery<{
        CLIENT_VEHICLE_NUMBER: string | null;
        HOLMAN_VEHICLE_NUMBER: string | null;
        PO_DATE: string | null;
        PO_NUMBER: string | null;
        PO_STATUS: string | null;
      }>(oilChangeSqlWithAta);

      // Fallback: if oil/lube ATA filter matched nothing, use all PREVENTATIVE MAINT. POs
      if (rows.length === 0) {
        console.log("[OilChangeCSV] No ATA oil/lube matches; falling back to all PREVENTATIVE MAINT. records");
        const oilChangeSqlFallback = `
          WITH ranked AS (
            SELECT
              CLIENT_VEHICLE_NUMBER,
              HOLMAN_VEHICLE_NUMBER,
              PO_DATE,
              PO_NUMBER,
              PO_STATUS,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(NULLIF(TRIM(HOLMAN_VEHICLE_NUMBER), ''), CLIENT_VEHICLE_NUMBER)
                ORDER BY PO_DATE DESC NULLS LAST
              ) AS rn
            FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
            WHERE REPAIR_TYPE_DESCRIPTION = 'PREVENTATIVE MAINT.'
          )
          SELECT
            CLIENT_VEHICLE_NUMBER,
            HOLMAN_VEHICLE_NUMBER,
            PO_DATE,
            PO_NUMBER,
            PO_STATUS
          FROM ranked
          WHERE rn = 1
          ORDER BY COALESCE(NULLIF(TRIM(HOLMAN_VEHICLE_NUMBER), ''), CLIENT_VEHICLE_NUMBER)
        `;
        rows = await executeQuery(oilChangeSqlFallback);
      }

      const csvContent = buildCsv(rows);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="last-oil-change.csv"');
      res.send(csvContent);
    } catch (error: any) {
      console.error("[OilChangeCSV] Error generating CSV:", error.message);
      res.status(500).json({ message: "Failed to generate oil change CSV" });
    }
  });

  return app;
}
