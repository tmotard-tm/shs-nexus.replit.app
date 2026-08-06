/**
 * Pep Boys store directory — generated from the operator-supplied spreadsheet
 * "Copy of Pep Boys Store locations 06.02.2026" (attached_assets, task ruling
 * 2026-08-05). Source of truth for Pep Boys store phone numbers: when the shop
 * of record is a Pep Boys location, the number shown/dialed comes from HERE,
 * not from portal scrapes (which carry placeholder junk like 222-222-2222).
 * Regenerate by re-running the xlsx conversion against a newer sheet.
 */
export interface PepBoysLocation {
  store: string; name: string; address: string; city: string;
  state: string; zip: string; phone: string; email: string;
}
export const PEPBOYS_LOCATIONS: PepBoysLocation[] = [
{
"store": "3",
"name": "BROOKHAVEN",
"address": "3700 EDGMONT AVE",
"city": "BROOKHAVEN",
"state": "PA",
"zip": "19015",
"phone": "6108729075",
"email": "SVCMNGR0003@PEPBOYS.COM"
},
{
"store": "4",
"name": "ROUTE 70",
"address": "6806 DAVIS CIR",
"city": "RALEIGH",
"state": "NC",
"zip": "27613",
"phone": "9197819317",
"email": "SVCMNGR0004@PEPBOYS.COM"
},
{
"store": "7",
"name": "BUSTLETON",
"address": "7422 BUSTLETON AVE",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19152",
"phone": "2153424700",
"email": "SVCMNGR0007@PEPBOYS.COM"
},
{
"store": "10",
"name": "SCRANTON",
"address": "1113 SCRANTON-CARBONDALE",
"city": "SCRANTON",
"state": "PA",
"zip": "18508",
"phone": "5703833600",
"email": "SVCMNGR0010@PEPBOYS.COM"
},
{
"store": "12",
"name": "ARAMINGO",
"address": "2491 ARAMINGO AVE",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19125",
"phone": "2157395510",
"email": "SVCMNGR0012@PEPBOYS.COM"
},
{
"store": "13",
"name": "MACDADE BLVD.",
"address": "20 N MACDADE BLVD",
"city": "GLENOLDEN",
"state": "PA",
"zip": "19036",
"phone": "6105220455",
"email": "SVCMNGR0013@PEPBOYS.COM"
},
{
"store": "14",
"name": "STENTON AVENUE",
"address": "6200 STENTON AVE",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19138",
"phone": "2155496570",
"email": "SVCMNGR0014@PEPBOYS.COM"
},
{
"store": "15",
"name": "ALLENTOWN",
"address": "1901 MACARTHUR RD",
"city": "WHITEHALL",
"state": "PA",
"zip": "18052",
"phone": "6104322515",
"email": "SVCMNGR0015@PEPBOYS.COM"
},
{
"store": "16",
"name": "YORK",
"address": "470 LOUCKS RD",
"city": "YORK",
"state": "PA",
"zip": "17404",
"phone": "7178430908",
"email": "SVCMNGR0016@PEPBOYS.COM"
},
{
"store": "17",
"name": "COLONIAL PARK",
"address": "4949 JONESTOWN RD",
"city": "HARRISBURG",
"state": "PA",
"zip": "17109",
"phone": "7176574941",
"email": "SVCMNGR0017@PEPBOYS.COM"
},
{
"store": "18",
"name": "QUAKERTOWN",
"address": "222 S WESTEND BLVD",
"city": "QUAKERTOWN",
"state": "PA",
"zip": "18951",
"phone": "2155383220",
"email": "SVCMNGR0018@PEPBOYS.COM"
},
{
"store": "20",
"name": "RED LION",
"address": "9880 E ROOSEVELT BLVD",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19115",
"phone": "2156771810",
"email": "SVCMNGR0020@PEPBOYS.COM"
},
{
"store": "21",
"name": "CARLISLE PIKE",
"address": "6100 CARLISLE PIKE",
"city": "MECHANICSBURG",
"state": "PA",
"zip": "17050",
"phone": "7176910860",
"email": "SVCMNGR0021@PEPBOYS.COM"
},
{
"store": "25",
"name": "READING",
"address": "3401 PLAZA DR",
"city": "READING",
"state": "PA",
"zip": "19605",
"phone": "6109291504",
"email": "SVCMNGR0025@PEPBOYS.COM"
},
{
"store": "29",
"name": "23RD STREET",
"address": "2298 W RITNER ST",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19145",
"phone": "2153367180",
"email": "SVCMNGR0029@PEPBOYS.COM"
},
{
"store": "31",
"name": "FREDERICKSBURG",
"address": "2384 PLANK RD",
"city": "FREDERICKSBURG",
"state": "VA",
"zip": "22401",
"phone": "5403730365",
"email": "SVCMNGR0031@PEPBOYS.COM"
},
{
"store": "34",
"name": "OXFORD VALLEY",
"address": "101 LINCOLN HWY",
"city": "FAIRLESS HILLS",
"state": "PA",
"zip": "19030",
"phone": "2155473550",
"email": "SVCMNGR0034@PEPBOYS.COM"
},
{
"store": "37",
"name": "NORTH RIVERS AVENUE",
"address": "6240 RIVERS AVE",
"city": "NORTH CHARLESTON",
"state": "SC",
"zip": "29406",
"phone": "8437447831",
"email": "SVCMNGR0037@PEPBOYS.COM"
},
{
"store": "38",
"name": "SAVANNAH HIGHWAY",
"address": "1550 SAVANNAH HWY",
"city": "CHARLESTON",
"state": "SC",
"zip": "29407",
"phone": "8437667415",
"email": "SVCMNGR0038@PEPBOYS.COM"
},
{
"store": "40",
"name": "EDGEWATER PARK",
"address": "2176 RTE 130",
"city": "BEVERLY",
"state": "NJ",
"zip": "08010",
"phone": "6098779345",
"email": "SVCMNGR0040@PEPBOYS.COM"
},
{
"store": "41",
"name": "PLEASANTVILLE",
"address": "6814 TILTON RD",
"city": "EGG HARBOR TOWNSHIP",
"state": "NJ",
"zip": "08234",
"phone": "6096450404",
"email": "SVCMNGR0041@PEPBOYS.COM"
},
{
"store": "43",
"name": "GORDON AVENUE",
"address": "1725 GORDON HWY",
"city": "AUGUSTA",
"state": "GA",
"zip": "30904",
"phone": "7067369971",
"email": "SVCMNGR0043@PEPBOYS.COM"
},
{
"store": "47",
"name": "MANDARIN",
"address": "9605 SAN JOSE BLVD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32257",
"phone": "9042609660",
"email": "SVCMNGR0047@PEPBOYS.COM"
},
{
"store": "48",
"name": "MARLTON",
"address": "775 WEST RT 70",
"city": "MARLTON",
"state": "NJ",
"zip": "08053",
"phone": "8569830902",
"email": "SVCMNGR0048@PEPBOYS.COM"
},
{
"store": "49",
"name": "GALLATIN PIKE",
"address": "1577 GALLATIN PIKE",
"city": "MADISON",
"state": "TN",
"zip": "37115",
"phone": "6158600285",
"email": "SVCMNGR0049@PEPBOYS.COM"
},
{
"store": "50",
"name": "TOMS RIVER",
"address": "301 RTE 37 E",
"city": "TOMS RIVER",
"state": "NJ",
"zip": "08753",
"phone": "7322861040",
"email": "SVCMNGR0050@PEPBOYS.COM"
},
{
"store": "52",
"name": "VINELAND",
"address": "323 W LANDIS AVE",
"city": "VINELAND",
"state": "NJ",
"zip": "08360",
"phone": "8566910355",
"email": "SVCMNGR0052@PEPBOYS.COM"
},
{
"store": "53",
"name": "WOODBURY",
"address": "137 S BROAD ST",
"city": "WOODBURY",
"state": "NJ",
"zip": "08096",
"phone": "8568450922",
"email": "SVCMNGR0053@PEPBOYS.COM"
},
{
"store": "54",
"name": "HOWELL",
"address": "4204 RTE 9 S",
"city": "HOWELL",
"state": "NJ",
"zip": "07731",
"phone": "7329051900",
"email": "SVCMNGR0054@PEPBOYS.COM"
},
{
"store": "55",
"name": "HAZLET",
"address": "72 HAZLET AVE",
"city": "HAZLET",
"state": "NJ",
"zip": "07730",
"phone": "7328888102",
"email": "SVCMNGR0055@PEPBOYS.COM"
},
{
"store": "56",
"name": "OCEAN TOWNSHIP",
"address": "1608 HIGHWAY 35",
"city": "OAKHURST",
"state": "NJ",
"zip": "07755",
"phone": "7325317800",
"email": "SVCMNGR0056@PEPBOYS.COM"
},
{
"store": "59",
"name": "CHERRY HILL",
"address": "314 HADDONFIELD RD",
"city": "CHERRY HILL",
"state": "NJ",
"zip": "08002",
"phone": "8566620301",
"email": "SVCMNGR0059@PEPBOYS.COM"
},
{
"store": "61",
"name": "STRATFORD/NJ",
"address": "10 N WHITEHORSE PIKE",
"city": "STRATFORD",
"state": "NJ",
"zip": "08084",
"phone": "8567833511",
"email": "SVCMNGR0061@PEPBOYS.COM"
},
{
"store": "62",
"name": "CONCORD PIKE",
"address": "2904 CONCORD PIKE",
"city": "TALLEYVILLE",
"state": "DE",
"zip": "19803",
"phone": "3024787006",
"email": "SVCMNGR0062@PEPBOYS.COM"
},
{
"store": "65",
"name": "FREDERICK",
"address": "1120 W PATRICK ST",
"city": "FREDERICK",
"state": "MD",
"zip": "21703",
"phone": "3016957666",
"email": "SVCMNGR0065@PEPBOYS.COM"
},
{
"store": "66",
"name": "PRICES CORNER",
"address": "3207 ROBERT KIRKWOOD HWY",
"city": "WILMINGTON",
"state": "DE",
"zip": "19808",
"phone": "3029982254",
"email": "SVCMNGR0066@PEPBOYS.COM"
},
{
"store": "67",
"name": "DOVER",
"address": "919 N DUPONT HWY",
"city": "DOVER",
"state": "DE",
"zip": "19901",
"phone": "3026782050",
"email": "SVCMNGR0067@PEPBOYS.COM"
},
{
"store": "68",
"name": "WALDORF",
"address": "3390 CRAIN HWY",
"city": "WALDORF",
"state": "MD",
"zip": "20603",
"phone": "3019328800",
"email": "SVCMNGR0068@PEPBOYS.COM"
},
{
"store": "69",
"name": "ROUTE 1 NORTH",
"address": "3720 CAPITAL BLVD",
"city": "RALEIGH",
"state": "NC",
"zip": "27604",
"phone": "9199540618",
"email": "SVCMNGR0069@PEPBOYS.COM"
},
{
"store": "70",
"name": "MERRITT",
"address": "1503 MERRITT BLVD",
"city": "BALTIMORE",
"state": "MD",
"zip": "21222",
"phone": "4102854820",
"email": "SVCMNGR0070@PEPBOYS.COM"
},
{
"store": "71",
"name": "LANGLEY PARK",
"address": "1804 UNIVERSITY BLVD E",
"city": "HYATTSVILLE",
"state": "MD",
"zip": "20783",
"phone": "3014349480",
"email": "SVCMNGR0071@PEPBOYS.COM"
},
{
"store": "73",
"name": "MARLOW HEIGHTS",
"address": "4500 SAINT BARNABAS RD",
"city": "MARLOW HEIGHTS",
"state": "MD",
"zip": "20748",
"phone": "3014232522",
"email": "SVCMNGR0073@PEPBOYS.COM"
},
{
"store": "74",
"name": "RANDALLSTOWN",
"address": "8635 LIBERTY RD",
"city": "RANDALLSTOWN",
"state": "MD",
"zip": "21133",
"phone": "4109220800",
"email": "SVCMNGR0074@PEPBOYS.COM"
},
{
"store": "75",
"name": "ROUTE 40",
"address": "6515 BALTIMORE NATIONAL P",
"city": "BALTIMORE",
"state": "MD",
"zip": "21228",
"phone": "4107882525",
"email": "SVCMNGR0075@PEPBOYS.COM"
},
{
"store": "77",
"name": "GLEN BURNIE",
"address": "7311 RITCHIE HWY",
"city": "GLEN BURNIE",
"state": "MD",
"zip": "21061",
"phone": "4107609430",
"email": "SVCMNGR0077@PEPBOYS.COM"
},
{
"store": "79",
"name": "TOWSON",
"address": "1739-41 E JOPPA RD",
"city": "BALTIMORE",
"state": "MD",
"zip": "21234",
"phone": "4106684747",
"email": "SVCMNGR0079@PEPBOYS.COM"
},
{
"store": "80",
"name": "FAYETTEVILLE",
"address": "1924 SKIBO RD",
"city": "FAYETTEVILLE",
"state": "NC",
"zip": "28314",
"phone": "9108671372",
"email": "SVCMNGR0080@PEPBOYS.COM"
},
{
"store": "82",
"name": "DAVIS HIGHWAY",
"address": "6340 N DAVIS HWY",
"city": "PENSACOLA",
"state": "FL",
"zip": "32504",
"phone": "8504840605",
"email": "SVCMNGR0082@PEPBOYS.COM"
},
{
"store": "83",
"name": "WEST BROAD/VA",
"address": "4728 WISTAR RD",
"city": "RICHMOND",
"state": "VA",
"zip": "23228",
"phone": "8046721161",
"email": "SVCMNGR0083@PEPBOYS.COM"
},
{
"store": "85",
"name": "DENBIGH",
"address": "13200 WARWICK BLVD",
"city": "NEWPORT NEWS",
"state": "VA",
"zip": "23602",
"phone": "7578755350",
"email": "SVCMNGR0085@PEPBOYS.COM"
},
{
"store": "87",
"name": "ANNANDALE",
"address": "7121 LITTLE RIVER TURNPIK",
"city": "ANNANDALE",
"state": "VA",
"zip": "22003",
"phone": "7032568966",
"email": "SVCMNGR0087@PEPBOYS.COM"
},
{
"store": "88",
"name": "MIDLOTHIAN",
"address": "6300 MIDLOTHIAN TURNPIKE",
"city": "RICHMOND",
"state": "VA",
"zip": "23225",
"phone": "8047457680",
"email": "SVCMNGR0088@PEPBOYS.COM"
},
{
"store": "89",
"name": "WHITE MARSH",
"address": "9909 PULASKI HWY",
"city": "MIDDLE RIVER",
"state": "MD",
"zip": "21220",
"phone": "4106863610",
"email": "SVCMNGR0089@PEPBOYS.COM"
},
{
"store": "90",
"name": "WOODBRIDGE",
"address": "1641 WIGGLESWORTH WAY",
"city": "WOODBRIDGE",
"state": "VA",
"zip": "22191",
"phone": "7034944400",
"email": "SVCMNGR0090@PEPBOYS.COM"
},
{
"store": "94",
"name": "NORTH TRYON STREET",
"address": "4837 N TRYON ST",
"city": "CHARLOTTE",
"state": "NC",
"zip": "28213",
"phone": "7045978181",
"email": "SVCMNGR0094@PEPBOYS.COM"
},
{
"store": "98",
"name": "ROCK HILL",
"address": "2514 N CHERRY RD",
"city": "ROCK HILL",
"state": "SC",
"zip": "29732",
"phone": "8033241980",
"email": "SVCMNGR0098@PEPBOYS.COM"
},
{
"store": "99",
"name": "DISTRICT HEIGHTS",
"address": "6333 MARLBORO PIKE",
"city": "FORESTVILLE",
"state": "MD",
"zip": "20747",
"phone": "3019679140",
"email": "SVCMNGR0099@PEPBOYS.COM"
},
{
"store": "100",
"name": "VIRGINIA BEACH",
"address": "1116 LYNNHAVEN PKWY",
"city": "VIRGINIA BEACH",
"state": "VA",
"zip": "23452",
"phone": "7574301907",
"email": "SVCMNGR0100@PEPBOYS.COM"
},
{
"store": "101",
"name": "BUFORD HIGHWAY",
"address": "4105 BUFORD HWY NE",
"city": "ATLANTA",
"state": "GA",
"zip": "30345",
"phone": "4047289755",
"email": "SVCMNGR0101@PEPBOYS.COM"
},
{
"store": "102",
"name": "NINE MILE ROAD",
"address": "4507 NINE MILE RD",
"city": "RICHMOND",
"state": "VA",
"zip": "23223",
"phone": "8042228105",
"email": "SVCMNGR0102@PEPBOYS.COM"
},
{
"store": "103",
"name": "NORCROSS",
"address": "5820 JIMMY CARTER BLVD",
"city": "NORCROSS",
"state": "GA",
"zip": "30071",
"phone": "7704487776",
"email": "SVCMNGR0103@PEPBOYS.COM"
},
{
"store": "104",
"name": "UNION CITY/GA",
"address": "5000 HWY 138",
"city": "UNION CITY",
"state": "GA",
"zip": "30291",
"phone": "7709640071",
"email": "SVCMNGR0104@PEPBOYS.COM"
},
{
"store": "105",
"name": "GASTONIA",
"address": "3028 E FRANKLIN BLVD",
"city": "GASTONIA",
"state": "NC",
"zip": "28056",
"phone": "7048530040",
"email": "SVCMNGR0105@PEPBOYS.COM"
},
{
"store": "106",
"name": "MARIETTA",
"address": "1531 COBB PARKWAY",
"city": "MARIETTA",
"state": "GA",
"zip": "30060",
"phone": "7709568453",
"email": "SVCMNGR0106@PEPBOYS.COM"
},
{
"store": "108",
"name": "SNELLVILLE",
"address": "2207 E MAIN ST",
"city": "SNELLVILLE",
"state": "GA",
"zip": "30078",
"phone": "7709780834",
"email": "SVCMNGR0108@PEPBOYS.COM"
},
{
"store": "109",
"name": "ATHENS",
"address": "3702 ATLANTA HWY",
"city": "ATHENS",
"state": "GA",
"zip": "30606",
"phone": "7065493428",
"email": "SVCMNGR0109@PEPBOYS.COM"
},
{
"store": "111",
"name": "NORFOLK",
"address": "1230 N MILITARY HWY",
"city": "NORFOLK",
"state": "VA",
"zip": "23502",
"phone": "7574610615",
"email": "SVCMNGR0111@PEPBOYS.COM"
},
{
"store": "112",
"name": "RIVERDALE/GA",
"address": "7000 B HIGHWAY 85",
"city": "RIVERDALE",
"state": "GA",
"zip": "30274",
"phone": "7709919510",
"email": "SVCMNGR0112@PEPBOYS.COM"
},
{
"store": "113",
"name": "ORANGE PARK",
"address": "204 BLANDING BLVD",
"city": "ORANGE PARK",
"state": "FL",
"zip": "32073",
"phone": "9042767680",
"email": "SVCMNGR0113@PEPBOYS.COM"
},
{
"store": "117",
"name": "GRETNA",
"address": "1100 BEHRMAN HWY",
"city": "GRETNA",
"state": "LA",
"zip": "70056",
"phone": "5043910200",
"email": "SVCMNGR0117@PEPBOYS.COM"
},
{
"store": "118",
"name": "LAKELAND",
"address": "4405 US HWY 98 N",
"city": "LAKELAND",
"state": "FL",
"zip": "33809",
"phone": "8638533776",
"email": "SVCMNGR0118@PEPBOYS.COM"
},
{
"store": "119",
"name": "LILBURN",
"address": "3965 LAWRENCEVILLE HWY NW",
"city": "LILBURN",
"state": "GA",
"zip": "30047",
"phone": "7702799877",
"email": "SVCMNGR0119@PEPBOYS.COM"
},
{
"store": "120",
"name": "ALTAMONTE SPRINGS",
"address": "1029 E ALTAMONTE DR",
"city": "ALTAMONTE SPRINGS",
"state": "FL",
"zip": "32701",
"phone": "4073393385",
"email": "SVCMNGR0120@PEPBOYS.COM"
},
{
"store": "121",
"name": "PORTSMOUTH",
"address": "2570 AIRLINE BLVD",
"city": "PORTSMOUTH",
"state": "VA",
"zip": "23701",
"phone": "7574881979",
"email": "SVCMNGR0121@PEPBOYS.COM"
},
{
"store": "123",
"name": "TALLAHASSEE",
"address": "2353 APALACHEE PARKWAY",
"city": "TALLAHASSEE",
"state": "FL",
"zip": "32301",
"phone": "8506569000",
"email": "SVCMNGR0123@PEPBOYS.COM"
},
{
"store": "124",
"name": "WEST HILLSBOROUGH",
"address": "3933 W HILLSBOROUGH AVE",
"city": "TAMPA",
"state": "FL",
"zip": "33614",
"phone": "8138841577",
"email": "SVCMNGR0124@PEPBOYS.COM"
},
{
"store": "127",
"name": "GAINESVILLE",
"address": "7725 W NEWBERRY RD",
"city": "GAINESVILLE",
"state": "FL",
"zip": "32606",
"phone": "3523326003",
"email": "SVCMNGR0127@PEPBOYS.COM"
},
{
"store": "128",
"name": "GARNER",
"address": "1490 US-70",
"city": "GARNER",
"state": "NC",
"zip": "27529",
"phone": "9196627455",
"email": "SVCMNGR0128@PEPBOYS.COM"
},
{
"store": "129",
"name": "ABERCORN",
"address": "8702 ABERCORN ST",
"city": "SAVANNAH",
"state": "GA",
"zip": "31406",
"phone": "9129201442",
"email": "SVCMNGR0129@PEPBOYS.COM"
},
{
"store": "130",
"name": "DUNN AVENUE",
"address": "1105 DUNN AVE",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32218",
"phone": "9046960090",
"email": "SVCMNGR0130@PEPBOYS.COM"
},
{
"store": "132",
"name": "SOUTH BLVD.",
"address": "5020 SOUTH BLVD",
"city": "CHARLOTTE",
"state": "NC",
"zip": "28217",
"phone": "7045296280",
"email": "SVCMNGR0132@PEPBOYS.COM"
},
{
"store": "133",
"name": "CUTLER RIDGE",
"address": "10200 BROAD CHANNEL RD",
"city": "MIAMI",
"state": "FL",
"zip": "33157",
"phone": "3052527311",
"email": "SVCMNGR0133@PEPBOYS.COM"
},
{
"store": "134",
"name": "BROAD RIVER ROAD",
"address": "1804 BROAD RIVER RD",
"city": "COLUMBIA",
"state": "SC",
"zip": "29210",
"phone": "8037500161",
"email": "SVCMNGR0134@PEPBOYS.COM"
},
{
"store": "135",
"name": "LANE AVENUE",
"address": "919 LANE AVE S",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32205",
"phone": "9046957770",
"email": "SVCMNGR0135@PEPBOYS.COM"
},
{
"store": "136",
"name": "FLORIDA AVENUE",
"address": "10124 N FLORIDA AVE",
"city": "TAMPA",
"state": "FL",
"zip": "33612",
"phone": "8139332424",
"email": "SVCMNGR0136@PEPBOYS.COM"
},
{
"store": "139",
"name": "BRANDON",
"address": "1747 W BRANDON BLVD",
"city": "BRANDON",
"state": "FL",
"zip": "33511",
"phone": "8136890700",
"email": "SVCMNGR0139@PEPBOYS.COM"
},
{
"store": "141",
"name": "BOSSIER CITY",
"address": "2941 E TEXAS AVE",
"city": "BOSSIER CITY",
"state": "LA",
"zip": "71111",
"phone": "3187420012",
"email": "SVCMNGR0141@PEPBOYS.COM"
},
{
"store": "142",
"name": "MOBILE HIGHWAY",
"address": "4700 MOBILE HWY",
"city": "PENSACOLA",
"state": "FL",
"zip": "32506",
"phone": "8504571907",
"email": "SVCMNGR0142@PEPBOYS.COM"
},
{
"store": "143",
"name": "NORTH DALE MABRY",
"address": "15625 N DALE MABRY HWY",
"city": "TAMPA",
"state": "FL",
"zip": "33618",
"phone": "8139635545",
"email": "SVCMNGR0143@PEPBOYS.COM"
},
{
"store": "144",
"name": "ANDORRA",
"address": "9101-15 RIDGE AVE",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19128",
"phone": "2154829680",
"email": "SVCMNGR0144@PEPBOYS.COM"
},
{
"store": "145",
"name": "HAMBURG",
"address": "3766 MCKINLEY PARKWAY",
"city": "BLASDELL",
"state": "NY",
"zip": "14219",
"phone": "7168261606",
"email": "SVCMNGR0145@PEPBOYS.COM"
},
{
"store": "146",
"name": "OLD HICKORY",
"address": "15001 OLD HICKORY BLVD",
"city": "NASHVILLE",
"state": "TN",
"zip": "37211",
"phone": "6153331275",
"email": "SVCMNGR0146@PEPBOYS.COM"
},
{
"store": "147",
"name": "SLIDELL",
"address": "1421 GAUSE BLVD",
"city": "SLIDELL",
"state": "LA",
"zip": "70458",
"phone": "9856460600",
"email": "SVCMNGR0147@PEPBOYS.COM"
},
{
"store": "148",
"name": "EAST TOWN CROSSING",
"address": "4770 CENTER LINE DR",
"city": "KNOXVILLE",
"state": "TN",
"zip": "37917",
"phone": "8656738779",
"email": "SVCMNGR0148@PEPBOYS.COM"
},
{
"store": "149",
"name": "CHARLOTTE PIKE",
"address": "5330 CHARLOTTE PIKE",
"city": "NASHVILLE",
"state": "TN",
"zip": "37209",
"phone": "6152925692",
"email": "SVCMNGR0149@PEPBOYS.COM"
},
{
"store": "150",
"name": "INDEPENDENCE BLVD.",
"address": "9415 E INDEPENDENCE BLVD",
"city": "MATTHEWS",
"state": "NC",
"zip": "28105",
"phone": "7048455980",
"email": "SVCMNGR0150@PEPBOYS.COM"
},
{
"store": "151",
"name": "KINGSTON",
"address": "106 MARKET PLACE BLVD",
"city": "KNOXVILLE",
"state": "TN",
"zip": "37922",
"phone": "8656902777",
"email": "SVCMNGR0151@PEPBOYS.COM"
},
{
"store": "152",
"name": "DECKER",
"address": "2455 DECKER BLVD",
"city": "COLUMBIA",
"state": "SC",
"zip": "29206",
"phone": "8036990687",
"email": "SVCMNGR0152@PEPBOYS.COM"
},
{
"store": "153",
"name": "MIAMI LAKES",
"address": "17050 NORTHWEST  57TH AVE",
"city": "HIALEAH",
"state": "FL",
"zip": "33015",
"phone": "3055574498",
"email": "SVCMNGR0153@PEPBOYS.COM"
},
{
"store": "154",
"name": "DEWITT",
"address": "3033 ERIE BLVD E",
"city": "SYRACUSE",
"state": "NY",
"zip": "13224",
"phone": "3154493445",
"email": "SVCMNGR0154@PEPBOYS.COM"
},
{
"store": "155",
"name": "NEW HARTFORD",
"address": "4475 COMMERCIAL DR",
"city": "NEW HARTFORD",
"state": "NY",
"zip": "13413",
"phone": "3157681015",
"email": "SVCMNGR0155@PEPBOYS.COM"
},
{
"store": "156",
"name": "CICERO/NY",
"address": "7885 BREWERTON ROAD",
"city": "CICERO",
"state": "NY",
"zip": "13039",
"phone": "3154586936",
"email": "SVCMNGR0156@PEPBOYS.COM"
},
{
"store": "157",
"name": "LITTLE HAVANA",
"address": "2301 SW 8TH ST",
"city": "MIAMI",
"state": "FL",
"zip": "33135",
"phone": "3055417200",
"email": "SVCMNGR0157@PEPBOYS.COM"
},
{
"store": "158",
"name": "EXTON",
"address": "220 N POTTSTOWN PIKE",
"city": "EXTON",
"state": "PA",
"zip": "19341",
"phone": "6105249800",
"email": "SVCMNGR0158@PEPBOYS.COM"
},
{
"store": "160",
"name": "AUSTELL",
"address": "3829 AUSTELL RD",
"city": "AUSTELL",
"state": "GA",
"zip": "30106",
"phone": "7707391095",
"email": "SVCMNGR0160@PEPBOYS.COM"
},
{
"store": "161",
"name": "METAIRIE",
"address": "6638 VETERANS MEMORIAL BL",
"city": "METAIRIE",
"state": "LA",
"zip": "70003",
"phone": "5044550281",
"email": "SVCMNGR0161@PEPBOYS.COM"
},
{
"store": "162",
"name": "MANASSAS",
"address": "8000 STREAM WALK LN",
"city": "MANASSAS",
"state": "VA",
"zip": "20109",
"phone": "7033306974",
"email": "SVCMNGR0162@PEPBOYS.COM"
},
{
"store": "163",
"name": "DAYTONA BEACH",
"address": "2220 W INTERNATIONAL SPEE",
"city": "DAYTONA BEACH",
"state": "FL",
"zip": "32114",
"phone": "3862556390",
"email": "SVCMNGR0163@PEPBOYS.COM"
},
{
"store": "165",
"name": "POMPANO BEACH",
"address": "240 COPANS RD",
"city": "POMPANO BEACH",
"state": "FL",
"zip": "33064",
"phone": "9547847676",
"email": "SVCMNGR0165@PEPBOYS.COM"
},
{
"store": "166",
"name": "HENRIETTA",
"address": "1375 MARKETPLACE DR",
"city": "ROCHESTER",
"state": "NY",
"zip": "14623",
"phone": "5852727080",
"email": "SVCMNGR0166@PEPBOYS.COM"
},
{
"store": "167",
"name": "WEST MIAMI",
"address": "211 NW 82ND AVE",
"city": "MIAMI",
"state": "FL",
"zip": "33126",
"phone": "3052646355",
"email": "SVCMNGR0167@PEPBOYS.COM"
},
{
"store": "168",
"name": "LINDENHURST",
"address": "231 SUNRISE HWY",
"city": "LINDENHURST",
"state": "NY",
"zip": "11757",
"phone": "6318881122",
"email": "SVCMNGR0168@PEPBOYS.COM"
},
{
"store": "171",
"name": "EAST BRUNSWICK",
"address": "575 STATE ROUTE 18",
"city": "EAST BRUNSWICK",
"state": "NJ",
"zip": "08816",
"phone": "7326511500",
"email": "SVCMNGR0171@PEPBOYS.COM"
},
{
"store": "172",
"name": "SMITHTOWN",
"address": "993 MIDDLE COUNTRY RD",
"city": "LAKE GROVE",
"state": "NY",
"zip": "11755",
"phone": "6313607386",
"email": "SVCMNGR0172@PEPBOYS.COM"
},
{
"store": "173",
"name": "NORTH MIAMI BEACH",
"address": "295 NE 167TH STREET",
"city": "NORTH MIAMI BEACH",
"state": "FL",
"zip": "33162",
"phone": "3056553000",
"email": "SVCMNGR0173@PEPBOYS.COM"
},
{
"store": "174",
"name": "EAST NEW ORLEANS",
"address": "12200 I-10 SERVICE RD",
"city": "NEW ORLEANS",
"state": "LA",
"zip": "70128",
"phone": "5042414006",
"email": "SVCMNGR0174@PEPBOYS.COM"
},
{
"store": "175",
"name": "WILLOW GROVE",
"address": "1509 EASTON RD",
"city": "WILLOW GROVE",
"state": "PA",
"zip": "19090",
"phone": "2158300633",
"email": "SVCMNGR0175@PEPBOYS.COM"
},
{
"store": "176",
"name": "HOLLYWOOD/FL",
"address": "860 S STATE ROAD 7",
"city": "HOLLYWOOD",
"state": "FL",
"zip": "33023",
"phone": "9549859440",
"email": "SVCMNGR0176@PEPBOYS.COM"
},
{
"store": "179",
"name": "ABRAMS",
"address": "6534 E NORTHWEST HWY",
"city": "DALLAS",
"state": "TX",
"zip": "75231",
"phone": "2147391584",
"email": "SVCMNGR0179@PEPBOYS.COM"
},
{
"store": "180",
"name": "ELMONT",
"address": "1802 HEMPSTEAD TURNPIKE",
"city": "ELMONT",
"state": "NY",
"zip": "11003",
"phone": "5163548800",
"email": "SVCMNGR0180@PEPBOYS.COM"
},
{
"store": "181",
"name": "CORPUS CHRISTI",
"address": "5106 S PADRE ISLAND DR",
"city": "CORPUS CHRISTI",
"state": "TX",
"zip": "78411",
"phone": "3619948504",
"email": "SVCMNGR0181@PEPBOYS.COM"
},
{
"store": "182",
"name": "DAVIE",
"address": "2380 S UNIVERSITY DR",
"city": "DAVIE",
"state": "FL",
"zip": "33324",
"phone": "9544762401",
"email": "SVCMNGR0182@PEPBOYS.COM"
},
{
"store": "184",
"name": "GREENVILLE",
"address": "2418 LAURENS RD",
"city": "GREENVILLE",
"state": "SC",
"zip": "29607",
"phone": "8646761365",
"email": "SVCMNGR0184@PEPBOYS.COM"
},
{
"store": "185",
"name": "AIRPORT HIGHWAY/AL",
"address": "831 MONTLIMAR DR",
"city": "MOBILE",
"state": "AL",
"zip": "36609",
"phone": "2514603161",
"email": "SVCMNGR0185@PEPBOYS.COM"
},
{
"store": "186",
"name": "HAMPTON",
"address": "2224 W MERCURY BLVD",
"city": "HAMPTON",
"state": "VA",
"zip": "23666",
"phone": "7578383313",
"email": "SVCMNGR0186@PEPBOYS.COM"
},
{
"store": "188",
"name": "EDISON",
"address": "518 OLD POST RD",
"city": "EDISON",
"state": "NJ",
"zip": "08817",
"phone": "7322484404",
"email": "SVCMNGR0188@PEPBOYS.COM"
},
{
"store": "190",
"name": "SEEKONK",
"address": "216 HIGHLAND AVE",
"city": "SEEKONK",
"state": "MA",
"zip": "02771",
"phone": "5083369990",
"email": "SVCMNGR0190@PEPBOYS.COM"
},
{
"store": "191",
"name": "NORTH LITTLE ROCK",
"address": "4228 E MCCAIN BLVD",
"city": "NORTH LITTLE ROCK",
"state": "AR",
"zip": "72117",
"phone": "5019455050",
"email": "SVCMNGR0191@PEPBOYS.COM"
},
{
"store": "192",
"name": "WEST WINDSOR",
"address": "3505 BRUNSWICK PIKE",
"city": "PRINCETON",
"state": "NJ",
"zip": "08540",
"phone": "6095200031",
"email": "SVCMNGR0192@PEPBOYS.COM"
},
{
"store": "193",
"name": "AMHERST",
"address": "1025 NIAGARA FALLS BLVD",
"city": "AMHERST",
"state": "NY",
"zip": "14226",
"phone": "7168310370",
"email": "SVCMNGR0193@PEPBOYS.COM"
},
{
"store": "194",
"name": "LAKE WORTH/FL",
"address": "4301 LAKE WORTH RD",
"city": "LAKE WORTH",
"state": "FL",
"zip": "33461",
"phone": "5619684688",
"email": "SVCMNGR0194@PEPBOYS.COM"
},
{
"store": "196",
"name": "WEST WARWICK",
"address": "375 QUAKER LANE",
"city": "WEST WARWICK",
"state": "RI",
"zip": "02893",
"phone": "4018263336",
"email": "SVCMNGR0196@PEPBOYS.COM"
},
{
"store": "198",
"name": "BEL AIR",
"address": "403A BALTIMORE PIKE",
"city": "BEL AIR",
"state": "MD",
"zip": "21014",
"phone": "4108381000",
"email": "SVCMNGR0198@PEPBOYS.COM"
},
{
"store": "199",
"name": "SHADYSIDE",
"address": "936 SOUTH MILLVALE AVE",
"city": "PITTSBURGH",
"state": "PA",
"zip": "15213",
"phone": "4125780478",
"email": "SVCMNGR0199@PEPBOYS.COM"
},
{
"store": "200",
"name": "COLONIE",
"address": "1795 CENTRAL AVE",
"city": "ALBANY",
"state": "NY",
"zip": "12205",
"phone": "5184525095",
"email": "SVCMNGR0200@PEPBOYS.COM"
},
{
"store": "202",
"name": "SPRINGFIELD/MO",
"address": "1265 E BATTLEFIELD RD",
"city": "SPRINGFIELD",
"state": "MO",
"zip": "65804",
"phone": "4178890030",
"email": "SVCMNGR0202@PEPBOYS.COM"
},
{
"store": "204",
"name": "FORT MYERS",
"address": "4797 S CLEVELAND AVE",
"city": "FORT MYERS",
"state": "FL",
"zip": "33907",
"phone": "2399395447",
"email": "SVCMNGR0204@PEPBOYS.COM"
},
{
"store": "207",
"name": "SHARPSTOWN",
"address": "7525 SOUTHWEST FWY",
"city": "HOUSTON",
"state": "TX",
"zip": "77074",
"phone": "7137798600",
"email": "SVCMNGR0207@PEPBOYS.COM"
},
{
"store": "208",
"name": "BATON ROUGE",
"address": "9704 AIRLINE HWY",
"city": "BATON ROUGE",
"state": "LA",
"zip": "70816",
"phone": "2259276233",
"email": "SVCMNGR0208@PEPBOYS.COM"
},
{
"store": "209",
"name": "GREENSPOINT",
"address": "10275 NORTH FWY",
"city": "HOUSTON",
"state": "TX",
"zip": "77037",
"phone": "2814455211",
"email": "SVCMNGR0209@PEPBOYS.COM"
},
{
"store": "210",
"name": "NORTH HILLS",
"address": "4751 MCKNIGHT RD",
"city": "PITTSBURGH",
"state": "PA",
"zip": "15237",
"phone": "4123697650",
"email": "SVCMNGR0210@PEPBOYS.COM"
},
{
"store": "212",
"name": "LAFAYETTE/LA",
"address": "5639 JOHNSTON ST",
"city": "LAFAYETTE",
"state": "LA",
"zip": "70503",
"phone": "3379881022",
"email": "SVCMNGR0212@PEPBOYS.COM"
},
{
"store": "213",
"name": "PLEASANT HILLS",
"address": "390 CLAIRTON BLVD",
"city": "PITTSBURGH",
"state": "PA",
"zip": "15236",
"phone": "4126555636",
"email": "SVCMNGR0213@PEPBOYS.COM"
},
{
"store": "215",
"name": "96TH STREET",
"address": "8588 EAST 96TH ST",
"city": "FISHERS",
"state": "IN",
"zip": "46037",
"phone": "3175950677",
"email": "SVCMNGR0215@PEPBOYS.COM"
},
{
"store": "219",
"name": "DEDHAM",
"address": "570-580 PROVIDENCE HWY",
"city": "DEDHAM",
"state": "MA",
"zip": "02026",
"phone": "7814618880",
"email": "SVCMNGR0219@PEPBOYS.COM"
},
{
"store": "222",
"name": "ORANGE",
"address": "145 BOSTON POST RD",
"city": "ORANGE",
"state": "CT",
"zip": "06477",
"phone": "2037951616",
"email": "SVCMNGR0222@PEPBOYS.COM"
},
{
"store": "225",
"name": "MONROEVILLE",
"address": "3475 WILLIAM PENN HWY",
"city": "PITTSBURGH",
"state": "PA",
"zip": "15235",
"phone": "4128295119",
"email": "SVCMNGR0225@PEPBOYS.COM"
},
{
"store": "228",
"name": "COVINGTON HWY",
"address": "5380 COVINGTON HWY",
"city": "DECATUR",
"state": "GA",
"zip": "30035",
"phone": "7703220300",
"email": "SVCMNGR0228@PEPBOYS.COM"
},
{
"store": "232",
"name": "HYBLA VALLEY",
"address": "7800 RICHMOND HWY",
"city": "ALEXANDRIA",
"state": "VA",
"zip": "22306",
"phone": "7037992900",
"email": "SVCMNGR0232@PEPBOYS.COM"
},
{
"store": "233",
"name": "EVANSVILLE",
"address": "101 METRO AVE",
"city": "EVANSVILLE",
"state": "IN",
"zip": "47715",
"phone": "8124749988",
"email": "SVCMNGR0233@PEPBOYS.COM"
},
{
"store": "234",
"name": "DELAWARE AVENUE",
"address": "1000 S COLUMBUS BLVD",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19147",
"phone": "2154639830",
"email": "SVCMNGR0234@PEPBOYS.COM"
},
{
"store": "237",
"name": "MORSE ROAD",
"address": "1321 MORSE RD",
"city": "COLUMBUS",
"state": "OH",
"zip": "43229",
"phone": "6147841266",
"email": "SVCMNGR0237@PEPBOYS.COM"
},
{
"store": "238",
"name": "MANCHESTER/CT",
"address": "205 SPENCER ST",
"city": "MANCHESTER",
"state": "CT",
"zip": "06040",
"phone": "8606465900",
"email": "SVCMNGR0238@PEPBOYS.COM"
},
{
"store": "239",
"name": "NORTH LOOP",
"address": "909 NORTH LOOP W",
"city": "HOUSTON",
"state": "TX",
"zip": "77008",
"phone": "7138647979",
"email": "SVCMNGR0239@PEPBOYS.COM"
},
{
"store": "240",
"name": "MIAMI TOWNSHIP",
"address": "8499 SPRINGBORO PIKE",
"city": "MIAMISBURG",
"state": "OH",
"zip": "45342",
"phone": "9374357755",
"email": "SVCMNGR0240@PEPBOYS.COM"
},
{
"store": "241",
"name": "BROADWAY",
"address": "487 S BROADWAY",
"city": "DENVER",
"state": "CO",
"zip": "80209",
"phone": "3037780440",
"email": "SVCMNGR0241@PEPBOYS.COM"
},
{
"store": "242",
"name": "AURORA",
"address": "12820 E MISSISSIPPI AVE",
"city": "AURORA",
"state": "CO",
"zip": "80012",
"phone": "3033388080",
"email": "SVCMNGR0242@PEPBOYS.COM"
},
{
"store": "247",
"name": "4TH AVENUE",
"address": "354 4TH AVE",
"city": "BROOKLYN",
"state": "NY",
"zip": "11215",
"phone": "7185962833",
"email": "SVCMNGR0247@PEPBOYS.COM"
},
{
"store": "250",
"name": "BERLIN",
"address": "44 BERLIN TURNPIKE",
"city": "BERLIN",
"state": "CT",
"zip": "06037",
"phone": "8608296800",
"email": "SVCMNGR0250@PEPBOYS.COM"
},
{
"store": "253",
"name": "BROOMALL",
"address": "2916 SPRINGFIELD RD",
"city": "BROOMALL",
"state": "PA",
"zip": "19008",
"phone": "6103533384",
"email": "SVCMNGR0253@PEPBOYS.COM"
},
{
"store": "257",
"name": "SPRINGFIELD/MA",
"address": "1177 BOSTON RD",
"city": "SPRINGFIELD",
"state": "MA",
"zip": "01119",
"phone": "4137831500",
"email": "SVCMNGR0257@PEPBOYS.COM"
},
{
"store": "258",
"name": "EAST TREMONT",
"address": "2633 EAST TREMONT AVE",
"city": "BRONX",
"state": "NY",
"zip": "10461",
"phone": "7188224949",
"email": "SVCMNGR0258@PEPBOYS.COM"
},
{
"store": "259",
"name": "FLORENCE MALL",
"address": "832 HEIGHTS BLVD",
"city": "FLORENCE",
"state": "KY",
"zip": "41042",
"phone": "8596479977",
"email": "SVCMNGR0259@PEPBOYS.COM"
},
{
"store": "260",
"name": "EASTGATE MALL",
"address": "4436 GLEN ESTE WITHAMSVIL",
"city": "CINCINNATI",
"state": "OH",
"zip": "45245",
"phone": "5139431100",
"email": "SVCMNGR0260@PEPBOYS.COM"
},
{
"store": "262",
"name": "AUDUBON",
"address": "114 BLACK HORSE PIKE",
"city": "AUDUBON",
"state": "NJ",
"zip": "08106",
"phone": "8565471320",
"email": "SVCMNGR0262@PEPBOYS.COM"
},
{
"store": "263",
"name": "BOARDMAN",
"address": "215 BOARDMAN POLAND RD",
"city": "BOARDMAN",
"state": "OH",
"zip": "44512",
"phone": "3306292322",
"email": "SVCMNGR0263@PEPBOYS.COM"
},
{
"store": "264",
"name": "NILES/OH",
"address": "5555 YOUNGSTOWN WARREN RD",
"city": "NILES",
"state": "OH",
"zip": "44446",
"phone": "3306523313",
"email": "SVCMNGR0264@PEPBOYS.COM"
},
{
"store": "267",
"name": "UNION",
"address": "2525 RT 22 WEST",
"city": "UNION",
"state": "NJ",
"zip": "07083",
"phone": "9086883633",
"email": "SVCMNGR0267@PEPBOYS.COM"
},
{
"store": "268",
"name": "SOUTH ACADEMY",
"address": "135 N ACADEMY BLVD",
"city": "COLORADO SPGS",
"state": "CO",
"zip": "80909",
"phone": "7193800003",
"email": "SVCMNGR0268@PEPBOYS.COM"
},
{
"store": "269",
"name": "TROTWOOD",
"address": "5221 SALEM AVE",
"city": "TROTWOOD",
"state": "OH",
"zip": "45426",
"phone": "9378547007",
"email": "SVCMNGR0269@PEPBOYS.COM"
},
{
"store": "270",
"name": "NORTH ACADEMY",
"address": "7625 N ACADEMY BLVD",
"city": "COLORADO SPRINGS",
"state": "CO",
"zip": "80920",
"phone": "7195994455",
"email": "SVCMNGR0270@PEPBOYS.COM"
},
{
"store": "271",
"name": "LITTLETON",
"address": "7469 PARK MEADOWS DR",
"city": "LONE TREE",
"state": "CO",
"zip": "80124",
"phone": "3037540010",
"email": "SVCMNGR0271@PEPBOYS.COM"
},
{
"store": "276",
"name": "ALPINE",
"address": "3737 ALPINE AVE NW",
"city": "COMSTOCK PARK",
"state": "MI",
"zip": "49321",
"phone": "6167853122",
"email": "SVCMNGR0276@PEPBOYS.COM"
},
{
"store": "277",
"name": "WATERBURY",
"address": "699 WOLCOTT ST",
"city": "WATERBURY",
"state": "CT",
"zip": "06705",
"phone": "2037575678",
"email": "SVCMNGR0277@PEPBOYS.COM"
},
{
"store": "280",
"name": "ROOSEVELT BLVD.",
"address": "4640 ROOSEVELT BLVD",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19124",
"phone": "2155336767",
"email": "SVCMNGR0280@PEPBOYS.COM"
},
{
"store": "281",
"name": "EASTPOINTE",
"address": "24600 GRATIOT AVE",
"city": "EASTPOINTE",
"state": "MI",
"zip": "48021",
"phone": "5867740200",
"email": "SVCMNGR0281@PEPBOYS.COM"
},
{
"store": "283",
"name": "BALDWIN",
"address": "850 SUNRISE HWY",
"city": "BALDWIN",
"state": "NY",
"zip": "11510",
"phone": "5162230600",
"email": "SVCMNGR0283@PEPBOYS.COM"
},
{
"store": "285",
"name": "NORTH LAKE BLVD.",
"address": "3169 NORTHLAKE BLVD",
"city": "PALM BEACH GARDENS",
"state": "FL",
"zip": "33403",
"phone": "5618818744",
"email": "SVCMNGR0285@PEPBOYS.COM"
},
{
"store": "286",
"name": "FARMINGTON",
"address": "28210 W 8 MILE RD",
"city": "FARMINGTON HILLS",
"state": "MI",
"zip": "48336",
"phone": "2484765210",
"email": "SVCMNGR0286@PEPBOYS.COM"
},
{
"store": "288",
"name": "WESTERN HILLS",
"address": "5495 GLENWAY AVE",
"city": "CINCINNATI",
"state": "OH",
"zip": "45238",
"phone": "5133470400",
"email": "SVCMNGR0288@PEPBOYS.COM"
},
{
"store": "289",
"name": "PORTAGE",
"address": "5630 S WESTNEDGE AVE",
"city": "PORTAGE",
"state": "MI",
"zip": "49002",
"phone": "2693882240",
"email": "SVCMNGR0289@PEPBOYS.COM"
},
{
"store": "292",
"name": "CORAL SPRINGS",
"address": "2100 UNIVERSITY DR",
"city": "CORAL SPRINGS",
"state": "FL",
"zip": "33071",
"phone": "9543464041",
"email": "SVCMNGR0292@PEPBOYS.COM"
},
{
"store": "300",
"name": "HACKENSACK",
"address": "65 COURT ST",
"city": "HACKENSACK",
"state": "NJ",
"zip": "07601",
"phone": "2013434100",
"email": "SVCMNGR0300@PEPBOYS.COM"
},
{
"store": "310",
"name": "KISSIMMEE",
"address": "302 W VINE ST",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "4079330055",
"email": "SVCMNGR0310@PEPBOYS.COM"
},
{
"store": "311",
"name": "SUNRISE & FLAGLER",
"address": "601 SUNRISE BLVD",
"city": "FORT LAUDERDALE",
"state": "FL",
"zip": "33304",
"phone": "9547791002",
"email": "SVCMNGR0311@PEPBOYS.COM"
},
{
"store": "314",
"name": "PIEDMONT ROAD",
"address": "2399 PIEDMONT RD",
"city": "ATLANTA",
"state": "GA",
"zip": "30324",
"phone": "4042310032",
"email": "SVCMNGR0314@PEPBOYS.COM"
},
{
"store": "316",
"name": "SANDY SPRINGS",
"address": "6521 ROSWELL RD",
"city": "ATLANTA",
"state": "GA",
"zip": "30328",
"phone": "4048430622",
"email": "SVCMNGR0316@PEPBOYS.COM"
},
{
"store": "317",
"name": "HAMDEN",
"address": "2301 DIXWELL AVE",
"city": "HAMDEN",
"state": "CT",
"zip": "06514",
"phone": "2032814441",
"email": "SVCMNGR0317@PEPBOYS.COM"
},
{
"store": "333",
"name": "COPPERFIELD CENTER",
"address": "6900 HWY 6 NORTH",
"city": "HOUSTON",
"state": "TX",
"zip": "77084",
"phone": "2818598999",
"email": "SVCMNGR0333@PEPBOYS.COM"
},
{
"store": "336",
"name": "BRECKENRIDGE",
"address": "1001 BRECKENRIDGE LN",
"city": "LOUISVILLE",
"state": "KY",
"zip": "40207",
"phone": "5028995090",
"email": "SVCMNGR0336@PEPBOYS.COM"
},
{
"store": "337",
"name": "WASHINGTON STREET",
"address": "7201 E WASHINGTON ST",
"city": "INDIANAPOLIS",
"state": "IN",
"zip": "46219",
"phone": "3173530020",
"email": "SVCMNGR0337@PEPBOYS.COM"
},
{
"store": "343",
"name": "ANNAPOLIS",
"address": "1911 WEST ST",
"city": "ANNAPOLIS",
"state": "MD",
"zip": "21401",
"phone": "4105739880",
"email": "SVCMNGR0343@PEPBOYS.COM"
},
{
"store": "345",
"name": "HICKSVILLE",
"address": "15 E OLD COUNTRY RD",
"city": "HICKSVILLE",
"state": "NY",
"zip": "11801",
"phone": "5168227878",
"email": "SVCMNGR0345@PEPBOYS.COM"
},
{
"store": "348",
"name": "BAYSHORE",
"address": "1321 SUNRISE HWY",
"city": "BAY SHORE",
"state": "NY",
"zip": "11706",
"phone": "6319691717",
"email": "SVCMNGR0348@PEPBOYS.COM"
},
{
"store": "354",
"name": "FOREST AVE",
"address": "1941 FOREST AVE",
"city": "STATEN ISLAND",
"state": "NY",
"zip": "10303",
"phone": "7182738477",
"email": "SVCMNGR0354@PEPBOYS.COM"
},
{
"store": "363",
"name": "CENTRAL AVE.",
"address": "1008 CENTRAL AVE",
"city": "ALBANY",
"state": "NY",
"zip": "12205",
"phone": "5184461660",
"email": "SVCMNGR0363@PEPBOYS.COM"
},
{
"store": "364",
"name": "RED ROSE COMMONS",
"address": "1700 FRUITVILLE PIKE",
"city": "LANCASTER",
"state": "PA",
"zip": "17601",
"phone": "7172910450",
"email": "SVCMNGR0364@PEPBOYS.COM"
},
{
"store": "370",
"name": "MILITARY TRAIL",
"address": "800 N MILITARY TRAIL",
"city": "WEST PALM BEACH",
"state": "FL",
"zip": "33415",
"phone": "5616863004",
"email": "SVCMNGR0370@PEPBOYS.COM"
},
{
"store": "371",
"name": "BETHEL PARK",
"address": "5055 LIBRARY RD",
"city": "BETHEL PARK",
"state": "PA",
"zip": "15102",
"phone": "4128510700",
"email": "SVCMNGR0371@PEPBOYS.COM"
},
{
"store": "372",
"name": "CRANBERRY",
"address": "20229 RT 19",
"city": "CRANBERRY  TOWNSHIP",
"state": "PA",
"zip": "16066",
"phone": "7247794400",
"email": "SVCMNGR0372@PEPBOYS.COM"
},
{
"store": "373",
"name": "ELMWOOD AVE.",
"address": "1996 ELMWOOD AVE",
"city": "BUFFALO",
"state": "NY",
"zip": "14207",
"phone": "7168733404",
"email": "SVCMNGR0373@PEPBOYS.COM"
},
{
"store": "374",
"name": "BEAR",
"address": "1164 PULASKI HWY",
"city": "BEAR",
"state": "DE",
"zip": "19701",
"phone": "3028363338",
"email": "SVCMNGR0374@PEPBOYS.COM"
},
{
"store": "376",
"name": "PLANTATION",
"address": "12251 W SUNRISE BLVD",
"city": "PLANTATION",
"state": "FL",
"zip": "33323",
"phone": "9549169100",
"email": "SVCMNGR0376@PEPBOYS.COM"
},
{
"store": "378",
"name": "LANDOVER HILLS",
"address": "6825 ANNAPOLIS RD",
"city": "LANDOVER HILLS",
"state": "MD",
"zip": "20784",
"phone": "3013412100",
"email": "SVCMNGR0378@PEPBOYS.COM"
},
{
"store": "380",
"name": "WARMINSTER",
"address": "982 W STREET RD",
"city": "WARMINSTER",
"state": "PA",
"zip": "18974",
"phone": "2153289520",
"email": "SVCMNGR0380@PEPBOYS.COM"
},
{
"store": "382",
"name": "TAMARAC",
"address": "7305 W COMMERCIAL BLVD",
"city": "TAMARAC",
"state": "FL",
"zip": "33319",
"phone": "9547268677",
"email": "SVCMNGR0382@PEPBOYS.COM"
},
{
"store": "385",
"name": "HARFORD ROAD",
"address": "4621 HARFORD RD",
"city": "BALTIMORE",
"state": "MD",
"zip": "21214",
"phone": "4104260800",
"email": "SVCMNGR0385@PEPBOYS.COM"
},
{
"store": "386",
"name": "LAWRENCEVILLE",
"address": "589 W PIKE ST",
"city": "LAWRENCEVILLE",
"state": "GA",
"zip": "30045",
"phone": "7705131210",
"email": "SVCMNGR0386@PEPBOYS.COM"
},
{
"store": "387",
"name": "STIRLING ROAD",
"address": "2721 STIRLING RD",
"city": "FORT LAUDERDALE",
"state": "FL",
"zip": "33312",
"phone": "9548941888",
"email": "SVCMNGR0387@PEPBOYS.COM"
},
{
"store": "390",
"name": "WILKES-BARRE",
"address": "450 WILKES BARRE TOWNSHIP",
"city": "WILKES BARRE",
"state": "PA",
"zip": "18702",
"phone": "5708191100",
"email": "SVCMNGR0390@PEPBOYS.COM"
},
{
"store": "391",
"name": "E. VIRGINIA BEACH",
"address": "321 HUTTON LN",
"city": "VIRGINIA BEACH",
"state": "VA",
"zip": "23454",
"phone": "7574639001",
"email": "SVCMNGR0391@PEPBOYS.COM"
},
{
"store": "397",
"name": "JUPITER",
"address": "2064 W INDIANTOWN RD",
"city": "JUPITER",
"state": "FL",
"zip": "33458",
"phone": "5617489444",
"email": "SVCMNGR0397@PEPBOYS.COM"
},
{
"store": "398",
"name": "BRADENTON",
"address": "2303 CORTEZ RD",
"city": "BRADENTON",
"state": "FL",
"zip": "34207",
"phone": "9417391525",
"email": "SVCMNGR0398@PEPBOYS.COM"
},
{
"store": "401",
"name": "GLASSBORO",
"address": "711 N DELSEA DR",
"city": "GLASSBORO",
"state": "NJ",
"zip": "08028",
"phone": "8562568000",
"email": "SVCMNGR0401@PEPBOYS.COM"
},
{
"store": "404",
"name": "MANSFIELD",
"address": "490 N. LEXINGTON-SPRINGMI",
"city": "MANSFIELD",
"state": "OH",
"zip": "44906",
"phone": "4195299455",
"email": "SVCMNGR0404@PEPBOYS.COM"
},
{
"store": "414",
"name": "SALEM",
"address": "232 HIGHLAND AVE",
"city": "SALEM",
"state": "MA",
"zip": "01970",
"phone": "9787443131",
"email": "SVCMNGR0414@PEPBOYS.COM"
},
{
"store": "419",
"name": "EVERETT",
"address": "1848-50 REVERE BEACH PKWY",
"city": "EVERETT",
"state": "MA",
"zip": "02149",
"phone": "6175451000",
"email": "SVCMNGR0419@PEPBOYS.COM"
},
{
"store": "421",
"name": "WEST HARTFORD",
"address": "1000 NEW BRITAIN AVE",
"city": "WEST HARTFORD",
"state": "CT",
"zip": "06110",
"phone": "8605702525",
"email": "SVCMNGR0421@PEPBOYS.COM"
},
{
"store": "422",
"name": "CINNAMINSON",
"address": "202 ROUTE 130 NORTH",
"city": "CINNAMINSON",
"state": "NJ",
"zip": "08077",
"phone": "8563030300",
"email": "SVCMNGR0422@PEPBOYS.COM"
},
{
"store": "430",
"name": "BERLIN",
"address": "260-310 RTE-73 NORTH",
"city": "BERLIN",
"state": "NJ",
"zip": "08009",
"phone": "8567190770",
"email": "SVCMNGR0430@PEPBOYS.COM"
},
{
"store": "436",
"name": "QUEENS VILLAGE",
"address": "208-22 JAMAICA AVE",
"city": "QUEENS VILLAGE",
"state": "NY",
"zip": "11428",
"phone": "7184656700",
"email": "SVCMNGR0436@PEPBOYS.COM"
},
{
"store": "438",
"name": "LIBERTY & MERRICK",
"address": "94-47 MERRICK BLVD",
"city": "JAMAICA",
"state": "NY",
"zip": "11433",
"phone": "7182063131",
"email": "SVCMNGR0438@PEPBOYS.COM"
},
{
"store": "444",
"name": "IRONDEQUOIT",
"address": "711 E RIDGE RD",
"city": "ROCHESTER",
"state": "NY",
"zip": "14621",
"phone": "5853232000",
"email": "SVCMNGR0444@PEPBOYS.COM"
},
{
"store": "445",
"name": "GEORGE DIETER",
"address": "1910 GEORGE DIETER DR",
"city": "EL PASO",
"state": "TX",
"zip": "79936",
"phone": "9158577633",
"email": "SVCMNGR0445@PEPBOYS.COM"
},
{
"store": "446",
"name": "PARSIPPANY",
"address": "1449 ROUTE 46 EAST",
"city": "PARSIPPANY",
"state": "NJ",
"zip": "07054",
"phone": "9735411030",
"email": "SVCMNGR0446@PEPBOYS.COM"
},
{
"store": "453",
"name": "RIDGEWOOD",
"address": "61-01 METROPOLITAN AVE",
"city": "RIDGEWOOD",
"state": "NY",
"zip": "11385",
"phone": "7184977999",
"email": "SVCMNGR0453@PEPBOYS.COM"
},
{
"store": "454",
"name": "N. BRUNSWICK",
"address": "1335 RTE-1 SOUTH",
"city": "NORTH BRUNSWICK",
"state": "NJ",
"zip": "08902",
"phone": "7327451807",
"email": "SVCMNGR0454@PEPBOYS.COM"
},
{
"store": "457",
"name": "PORT JEFFERSON",
"address": "5170 NESCONSET HWY",
"city": "PORT JEFFERSON STATION",
"state": "NY",
"zip": "11776",
"phone": "6314766614",
"email": "SVCMNGR0457@PEPBOYS.COM"
},
{
"store": "462",
"name": "PISCATAWAY",
"address": "1052 STELTON RD",
"city": "PISCATAWAY",
"state": "NJ",
"zip": "08854",
"phone": "7325620087",
"email": "SVCMNGR0462@PEPBOYS.COM"
},
{
"store": "463",
"name": "PROVIDENCE",
"address": "1246 N MAIN ST",
"city": "PROVIDENCE",
"state": "RI",
"zip": "02904",
"phone": "4012732011",
"email": "SVCMNGR0463@PEPBOYS.COM"
},
{
"store": "469",
"name": "RAYNHAM",
"address": "85 RT. 44",
"city": "RAYNHAM",
"state": "MA",
"zip": "02767",
"phone": "5088849577",
"email": "SVCMNGR0469@PEPBOYS.COM"
},
{
"store": "479",
"name": "SKOKIE",
"address": "5220 TOUHY AVE",
"city": "SKOKIE",
"state": "IL",
"zip": "60077",
"phone": "8476755300",
"email": "SVCMNGR0479@PEPBOYS.COM"
},
{
"store": "496",
"name": "JERSEY CITY, HUDSON MALL",
"address": "701 STATE RT 440 SOUTH",
"city": "JERSEY CITY",
"state": "NJ",
"zip": "07304",
"phone": "2014357677",
"email": "SVCMNGR0496@PEPBOYS.COM"
},
{
"store": "504",
"name": "COON RAPIDS",
"address": "3325 124TH AVE NW",
"city": "COON RAPIDS",
"state": "MN",
"zip": "55433",
"phone": "7633671020",
"email": "SVCMNGR0504@PEPBOYS.COM"
},
{
"store": "519",
"name": "POTTSTOWN",
"address": "145 SHOEMAKER ROAD",
"city": "POTTSTOWN",
"state": "PA",
"zip": "19464",
"phone": "6107050202",
"email": "SVCMNGR0519@PEPBOYS.COM"
},
{
"store": "523",
"name": "STATE COLLEGE",
"address": "2268 E COLLEGE AVE",
"city": "STATE COLLEGE",
"state": "PA",
"zip": "16801",
"phone": "8148611680",
"email": "SVCMNGR0523@PEPBOYS.COM"
},
{
"store": "525",
"name": "WINCHESTER/VA",
"address": "2001 S PLEASANT VALLEY RD",
"city": "WINCHESTER",
"state": "VA",
"zip": "22601",
"phone": "5407236600",
"email": "SVCMNGR0525@PEPBOYS.COM"
},
{
"store": "529",
"name": "PUYALLUP",
"address": "12228 MERIDIAN EAST",
"city": "PUYALLUP",
"state": "WA",
"zip": "98373",
"phone": "2538401800",
"email": "SVCMNGR0529@PEPBOYS.COM"
},
{
"store": "544",
"name": "APOPKA",
"address": "2000 EAST SEMORAN BLVD",
"city": "APOPKA",
"state": "FL",
"zip": "32703",
"phone": "4078804500",
"email": "SVCMNGR0544@PEPBOYS.COM"
},
{
"store": "545",
"name": "CLAY",
"address": "8091 OSWEGO RD",
"city": "LIVERPOOL",
"state": "NY",
"zip": "13090",
"phone": "3156525200",
"email": "SVCMNGR0545@PEPBOYS.COM"
},
{
"store": "549",
"name": "ROBINSON TWP",
"address": "6581 STEUBENVILLE PIKE",
"city": "CRAFTON",
"state": "PA",
"zip": "15205",
"phone": "4127884455",
"email": "SVCMNGR0549@PEPBOYS.COM"
},
{
"store": "551",
"name": "SALISBURY",
"address": "1628 N SALISBURY BLVD",
"city": "SALISBURY",
"state": "MD",
"zip": "21801",
"phone": "4105489291",
"email": "SVCMNGR0551@PEPBOYS.COM"
},
{
"store": "562",
"name": "LODI",
"address": "1401 S CHEROKEE LN",
"city": "LODI",
"state": "CA",
"zip": "95240",
"phone": "2093650175",
"email": "SVCMNGR0562@PEPBOYS.COM"
},
{
"store": "564",
"name": "PATCHOGUE",
"address": "425 SUNRISE HWY",
"city": "PATCHOGUE",
"state": "NY",
"zip": "11772",
"phone": "6317580045",
"email": "SVCMNGR0564@PEPBOYS.COM"
},
{
"store": "566",
"name": "GERMANTOWN",
"address": "20900-A FREDERICK RD",
"city": "GERMANTOWN",
"state": "MD",
"zip": "20876",
"phone": "3015404686",
"email": "SVCMNGR0566@PEPBOYS.COM"
},
{
"store": "598",
"name": "OCALA",
"address": "2035 SW COLLEGE RD",
"city": "OCALA",
"state": "FL",
"zip": "34471",
"phone": "3523690303",
"email": "SVCMNGR0598@PEPBOYS.COM"
},
{
"store": "603",
"name": "HUNTINGTON PARK",
"address": "2671 RANDOLPH ST",
"city": "HUNTINGTON PARK",
"state": "CA",
"zip": "90255",
"phone": "3235836855",
"email": "SVCMNGR0603@PEPBOYS.COM"
},
{
"store": "607",
"name": "PASADENA/CA",
"address": "1135 E COLORADO BLVD",
"city": "PASADENA",
"state": "CA",
"zip": "91106",
"phone": "6267938181",
"email": "SVCMNGR0607@PEPBOYS.COM"
},
{
"store": "609",
"name": "SANTA ANA, EAST 1ST ST",
"address": "124 E 1ST ST",
"city": "SANTA ANA",
"state": "CA",
"zip": "92701",
"phone": "7145477477",
"email": "SVCMNGR0609@PEPBOYS.COM"
},
{
"store": "611",
"name": "LA MIRADA",
"address": "14207 ROSECRANS AVE",
"city": "LA MIRADA",
"state": "CA",
"zip": "90638",
"phone": "5629446437",
"email": "SVCMNGR0611@PEPBOYS.COM"
},
{
"store": "612",
"name": "WASHINGTON BOULEVARD",
"address": "1200 W WASHINGTON BLVD",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90007",
"phone": "2137491594",
"email": "SVCMNGR0612@PEPBOYS.COM"
},
{
"store": "614",
"name": "PICO",
"address": "10644 W PICO BLVD",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90064",
"phone": "3108366622",
"email": "SVCMNGR0614@PEPBOYS.COM"
},
{
"store": "618",
"name": "BURBANK",
"address": "254 W OLIVE ST",
"city": "BURBANK",
"state": "CA",
"zip": "91502",
"phone": "8188453555",
"email": "SVCMNGR0618@PEPBOYS.COM"
},
{
"store": "619",
"name": "SIMI VALLEY",
"address": "660 E LOS ANGELES AVE",
"city": "SIMI VALLEY",
"state": "CA",
"zip": "93065",
"phone": "8055224002",
"email": "SVCMNGR0619@PEPBOYS.COM"
},
{
"store": "622",
"name": "BAKERSFIELD, F STREET",
"address": "2411 F ST",
"city": "BAKERSFIELD",
"state": "CA",
"zip": "93301",
"phone": "6613259015",
"email": "SVCMNGR0622@PEPBOYS.COM"
},
{
"store": "630",
"name": "INGLEWOOD",
"address": "200 E SPRUCE AVE",
"city": "INGLEWOOD",
"state": "CA",
"zip": "90301",
"phone": "3236782255",
"email": "SVCMNGR0630@PEPBOYS.COM"
},
{
"store": "634",
"name": "MODESTO",
"address": "1340 MCHENRY AVE",
"city": "MODESTO",
"state": "CA",
"zip": "95350",
"phone": "2095293310",
"email": "SVCMNGR0634@PEPBOYS.COM"
},
{
"store": "635",
"name": "SAN FERNANDO",
"address": "1231 SAN FERNANDO RD",
"city": "SAN FERNANDO",
"state": "CA",
"zip": "91340",
"phone": "8188981491",
"email": "SVCMNGR0635@PEPBOYS.COM"
},
{
"store": "636",
"name": "DOWNEY, LAKEWOOD BLVD",
"address": "10231 LAKEWOOD BLVD",
"city": "DOWNEY",
"state": "CA",
"zip": "90241",
"phone": "5628619909",
"email": "SVCMNGR0636@PEPBOYS.COM"
},
{
"store": "637",
"name": "RANCHO CUCAMONGA",
"address": "9292 FOOTHILL BLVD",
"city": "RANCHO CUCAMONGA",
"state": "CA",
"zip": "91730",
"phone": "9099453313",
"email": "SVCMNGR0637@PEPBOYS.COM"
},
{
"store": "638",
"name": "RESEDA",
"address": "7340 RESEDA BLVD",
"city": "RESEDA",
"state": "CA",
"zip": "91335",
"phone": "8187087002",
"email": "SVCMNGR0638@PEPBOYS.COM"
},
{
"store": "641",
"name": "EL MONTE",
"address": "11937 E VALLEY BLVD",
"city": "EL MONTE",
"state": "CA",
"zip": "91732",
"phone": "6264010404",
"email": "SVCMNGR0641@PEPBOYS.COM"
},
{
"store": "647",
"name": "67TH STREET",
"address": "6714 EL CAJON BLVD",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92115",
"phone": "6194634402",
"email": "SVCMNGR0647@PEPBOYS.COM"
},
{
"store": "649",
"name": "MERCED",
"address": "1207 W MAIN ST",
"city": "MERCED",
"state": "CA",
"zip": "95340",
"phone": "2097233177",
"email": "SVCMNGR0649@PEPBOYS.COM"
},
{
"store": "650",
"name": "OXNARD",
"address": "939 S OXNARD BLVD",
"city": "OXNARD",
"state": "CA",
"zip": "93030",
"phone": "8054866387",
"email": "SVCMNGR0650@PEPBOYS.COM"
},
{
"store": "651",
"name": "N. CHULA VISTA",
"address": "454 BROADWAY",
"city": "CHULA VISTA",
"state": "CA",
"zip": "91910",
"phone": "6194262444",
"email": "SVCMNGR0651@PEPBOYS.COM"
},
{
"store": "652",
"name": "ATLANTIC",
"address": "256 S ATLANTIC BLVD",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90022",
"phone": "3237221000",
"email": "SVCMNGR0652@PEPBOYS.COM"
},
{
"store": "656",
"name": "VISALIA",
"address": "3015 S MOONEY BLVD",
"city": "VISALIA",
"state": "CA",
"zip": "93277",
"phone": "5597334535",
"email": "SVCMNGR0656@PEPBOYS.COM"
},
{
"store": "658",
"name": "TORRANCE, SEPULVEDA BLVD",
"address": "3124 SEPULVEDA BLVD",
"city": "TORRANCE",
"state": "CA",
"zip": "90505",
"phone": "3103263002",
"email": "SVCMNGR0658@PEPBOYS.COM"
},
{
"store": "661",
"name": "SPEEDWAY",
"address": "4491 E SPEEDWAY BLVD",
"city": "TUCSON",
"state": "AZ",
"zip": "85712",
"phone": "5207955993",
"email": "SVCMNGR0661@PEPBOYS.COM"
},
{
"store": "663",
"name": "ANAHEIM",
"address": "3030 W LINCOLN AVE",
"city": "ANAHEIM",
"state": "CA",
"zip": "92801",
"phone": "7148264810",
"email": "SVCMNGR0663@PEPBOYS.COM"
},
{
"store": "664",
"name": "ESCONDIDO",
"address": "855 W MISSION AVE",
"city": "ESCONDIDO",
"state": "CA",
"zip": "92025",
"phone": "7607418426",
"email": "SVCMNGR0664@PEPBOYS.COM"
},
{
"store": "665",
"name": "ARTESIA",
"address": "11944 SOUTH ST",
"city": "CERRITOS",
"state": "CA",
"zip": "90703",
"phone": "5624021987",
"email": "SVCMNGR0665@PEPBOYS.COM"
},
{
"store": "668",
"name": "CLOVIS",
"address": "693 W SHAW AVE",
"city": "CLOVIS",
"state": "CA",
"zip": "93612",
"phone": "5592982557",
"email": "SVCMNGR0668@PEPBOYS.COM"
},
{
"store": "670",
"name": "DECATUR",
"address": "506 S DECATUR BLVD",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89107",
"phone": "7028770791",
"email": "SVCMNGR0670@PEPBOYS.COM"
},
{
"store": "673",
"name": "KINGS CANYON",
"address": "5615 E KINGS CANYON RD",
"city": "FRESNO",
"state": "CA",
"zip": "93727",
"phone": "5592516600",
"email": "SVCMNGR0673@PEPBOYS.COM"
},
{
"store": "674",
"name": "YUMA",
"address": "155 W 32ND ST",
"city": "YUMA",
"state": "AZ",
"zip": "85364",
"phone": "9287266740",
"email": "SVCMNGR0674@PEPBOYS.COM"
},
{
"store": "676",
"name": "WEST COVINA",
"address": "1540 E AMAR RD",
"city": "WEST COVINA",
"state": "CA",
"zip": "91792",
"phone": "6268109936",
"email": "SVCMNGR0676@PEPBOYS.COM"
},
{
"store": "677",
"name": "STOCKDALE TOWN CNT",
"address": "4605 PLANZ RD",
"city": "BAKERSFIELD",
"state": "CA",
"zip": "93309",
"phone": "6618346858",
"email": "SVCMNGR0677@PEPBOYS.COM"
},
{
"store": "678",
"name": "LANCASTER/CA",
"address": "44229 20TH ST W",
"city": "LANCASTER",
"state": "CA",
"zip": "93534",
"phone": "6619459408",
"email": "SVCMNGR0678@PEPBOYS.COM"
},
{
"store": "680",
"name": "FONTANA",
"address": "16711 VALLEY BLVD",
"city": "FONTANA",
"state": "CA",
"zip": "92335",
"phone": "9098237131",
"email": "SVCMNGR0680@PEPBOYS.COM"
},
{
"store": "683",
"name": "NORTH LAS VEGAS",
"address": "2030 N LAS VEGAS BLVD",
"city": "NORTH LAS VEGAS",
"state": "NV",
"zip": "89030",
"phone": "7023990052",
"email": "SVCMNGR0683@PEPBOYS.COM"
},
{
"store": "684",
"name": "SCOTTSDALE",
"address": "2524 N SCOTTSDALE RD",
"city": "SCOTTSDALE",
"state": "AZ",
"zip": "85257",
"phone": "4809459958",
"email": "SVCMNGR0684@PEPBOYS.COM"
},
{
"store": "688",
"name": "SAHARA",
"address": "637 E SAHARA AVE",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89104",
"phone": "7027960600",
"email": "SVCMNGR0688@PEPBOYS.COM"
},
{
"store": "690",
"name": "MAGNOLIA",
"address": "10831 MAGNOLIA AVE",
"city": "RIVERSIDE",
"state": "CA",
"zip": "92505",
"phone": "9513540100",
"email": "SVCMNGR0690@PEPBOYS.COM"
},
{
"store": "695",
"name": "JUAN TABO",
"address": "1308 JUAN TABO NE",
"city": "ALBUQUERQUE",
"state": "NM",
"zip": "87112",
"phone": "5052927111",
"email": "SVCMNGR0695@PEPBOYS.COM"
},
{
"store": "696",
"name": "SAN MATEO",
"address": "5651 SAN MATEO BLVD NE",
"city": "ALBUQUERQUE",
"state": "NM",
"zip": "87109",
"phone": "5058818101",
"email": "SVCMNGR0696@PEPBOYS.COM"
},
{
"store": "698",
"name": "YARBROUGH",
"address": "10501 GATEWAY WEST 11",
"city": "EL PASO",
"state": "TX",
"zip": "79925",
"phone": "9155951958",
"email": "SVCMNGR0698@PEPBOYS.COM"
},
{
"store": "700",
"name": "LAS CRUCES",
"address": "1203 E LOHMAN AVE",
"city": "LAS CRUCES",
"state": "NM",
"zip": "88001",
"phone": "5755247734",
"email": "SVCMNGR0700@PEPBOYS.COM"
},
{
"store": "701",
"name": "ENCINITAS",
"address": "254 N EL CAMINO REAL",
"city": "ENCINITAS",
"state": "CA",
"zip": "92024",
"phone": "7609447007",
"email": "SVCMNGR0701@PEPBOYS.COM"
},
{
"store": "702",
"name": "TROPICANA",
"address": "4670 E TROPICANA AVE",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89121",
"phone": "7024358266",
"email": "SVCMNGR0702@PEPBOYS.COM"
},
{
"store": "703",
"name": "GARLAND",
"address": "2002 NORTHWEST HWY",
"city": "GARLAND",
"state": "TX",
"zip": "75041",
"phone": "9726130077",
"email": "SVCMNGR0703@PEPBOYS.COM"
},
{
"store": "704",
"name": "PLANO",
"address": "928 W SPRING CREEK PKWY",
"city": "PLANO",
"state": "TX",
"zip": "75023",
"phone": "9724227575",
"email": "SVCMNGR0704@PEPBOYS.COM"
},
{
"store": "705",
"name": "IRVING",
"address": "1950 BELTLINE RD",
"city": "IRVING",
"state": "TX",
"zip": "75061",
"phone": "9729862200",
"email": "SVCMNGR0705@PEPBOYS.COM"
},
{
"store": "706",
"name": "DYER STREET",
"address": "9345 DYER ST",
"city": "EL PASO",
"state": "TX",
"zip": "79924",
"phone": "9157514934",
"email": "SVCMNGR0706@PEPBOYS.COM"
},
{
"store": "708",
"name": "RENO",
"address": "5000 SMITHRIDGE DR",
"city": "RENO",
"state": "NV",
"zip": "89502",
"phone": "7758271700",
"email": "SVCMNGR0708@PEPBOYS.COM"
},
{
"store": "709",
"name": "SPARKS",
"address": "300 E PRATER WAY",
"city": "SPARKS",
"state": "NV",
"zip": "89431",
"phone": "7753587200",
"email": "SVCMNGR0709@PEPBOYS.COM"
},
{
"store": "711",
"name": "WEST LANE",
"address": "4987 WEST LANE",
"city": "STOCKTON",
"state": "CA",
"zip": "95210",
"phone": "2099521222",
"email": "SVCMNGR0711@PEPBOYS.COM"
},
{
"store": "712",
"name": "RANCHO CORDOVA",
"address": "10899 FOLSOM BLVD",
"city": "RANCHO CORDOVA",
"state": "CA",
"zip": "95670",
"phone": "9166384808",
"email": "SVCMNGR0712@PEPBOYS.COM"
},
{
"store": "713",
"name": "WALZEM",
"address": "5616 WALZEM RD",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78218",
"phone": "2105990074",
"email": "SVCMNGR0713@PEPBOYS.COM"
},
{
"store": "714",
"name": "SACRAMENTO",
"address": "5895 47TH AVE",
"city": "SACRAMENTO",
"state": "CA",
"zip": "95824",
"phone": "9163923131",
"email": "SVCMNGR0714@PEPBOYS.COM"
},
{
"store": "715",
"name": "COOPER",
"address": "2710 S COOPER ST",
"city": "ARLINGTON",
"state": "TX",
"zip": "76015",
"phone": "8178607558",
"email": "SVCMNGR0715@PEPBOYS.COM"
},
{
"store": "716",
"name": "CAMP WISDOM",
"address": "4010 W CAMP WISDOM RD",
"city": "DALLAS",
"state": "TX",
"zip": "75237",
"phone": "9727091115",
"email": "SVCMNGR0716@PEPBOYS.COM"
},
{
"store": "717",
"name": "MESQUITE",
"address": "2317 N GALLOWAY BLVD",
"city": "MESQUITE",
"state": "TX",
"zip": "75150",
"phone": "9722891834",
"email": "SVCMNGR0717@PEPBOYS.COM"
},
{
"store": "722",
"name": "CAMP BOWIE",
"address": "7208 HIGHWAY 80 WEST",
"city": "FORT WORTH",
"state": "TX",
"zip": "76116",
"phone": "8175604606",
"email": "SVCMNGR0722@PEPBOYS.COM"
},
{
"store": "723",
"name": "ARDEN WAY",
"address": "2500 ARDEN WAY",
"city": "SACRAMENTO",
"state": "CA",
"zip": "95825",
"phone": "9166466671",
"email": "SVCMNGR0723@PEPBOYS.COM"
},
{
"store": "724",
"name": "MORENO VALLEY",
"address": "23470 SUNNY MEAD BLVD",
"city": "MORENO VALLEY",
"state": "CA",
"zip": "92553",
"phone": "9512474564",
"email": "SVCMNGR0724@PEPBOYS.COM"
},
{
"store": "725",
"name": "ARLINGTON",
"address": "1212 N COLLINS ST",
"city": "ARLINGTON",
"state": "TX",
"zip": "76011",
"phone": "8172772996",
"email": "SVCMNGR0725@PEPBOYS.COM"
},
{
"store": "726",
"name": "BUCKNER",
"address": "1710 BUCKNER BLVD S",
"city": "DALLAS",
"state": "TX",
"zip": "75217",
"phone": "2143981549",
"email": "SVCMNGR0726@PEPBOYS.COM"
},
{
"store": "727",
"name": "LAKE WORTH/TX",
"address": "6500 LAKE WORTH BLVD",
"city": "LAKE WORTH",
"state": "TX",
"zip": "76135",
"phone": "8172370440",
"email": "SVCMNGR0727@PEPBOYS.COM"
},
{
"store": "728",
"name": "INA ROAD",
"address": "4275 W INA RD",
"city": "TUCSON",
"state": "AZ",
"zip": "85741",
"phone": "5207446626",
"email": "SVCMNGR0728@PEPBOYS.COM"
},
{
"store": "729",
"name": "MCCART",
"address": "6725 MCCART ST",
"city": "FORT WORTH",
"state": "TX",
"zip": "76133",
"phone": "8172943311",
"email": "SVCMNGR0729@PEPBOYS.COM"
},
{
"store": "731",
"name": "NORTH RICHLAND",
"address": "6755 NORTH EAST LOOP 820",
"city": "NORTH RICHLAND HILLS",
"state": "TX",
"zip": "76180",
"phone": "8175811778",
"email": "SVCMNGR0731@PEPBOYS.COM"
},
{
"store": "732",
"name": "ONTARIO",
"address": "2415 S VINEYARD AVE",
"city": "ONTARIO",
"state": "CA",
"zip": "91761",
"phone": "9099476889",
"email": "SVCMNGR0732@PEPBOYS.COM"
},
{
"store": "733",
"name": "MILITARY",
"address": "830 MILITARY DR SE",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78214",
"phone": "2109245544",
"email": "SVCMNGR0733@PEPBOYS.COM"
},
{
"store": "734",
"name": "SAN PEDRO",
"address": "6200 SAN PEDRO AVE",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78216",
"phone": "2108297505",
"email": "SVCMNGR0734@PEPBOYS.COM"
},
{
"store": "735",
"name": "CHANDLER",
"address": "400 S ARIZONA AVE",
"city": "CHANDLER",
"state": "AZ",
"zip": "85225",
"phone": "4808990822",
"email": "SVCMNGR0735@PEPBOYS.COM"
},
{
"store": "736",
"name": "BEDFORD",
"address": "3305 HARWOOD RD",
"city": "BEDFORD",
"state": "TX",
"zip": "76021",
"phone": "8172832588",
"email": "SVCMNGR0736@PEPBOYS.COM"
},
{
"store": "737",
"name": "MARBACH",
"address": "8103 MARBACH RD",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78227",
"phone": "2106755008",
"email": "SVCMNGR0737@PEPBOYS.COM"
},
{
"store": "738",
"name": "EAST MAIN",
"address": "7715 E MAIN ST",
"city": "MESA",
"state": "AZ",
"zip": "85207",
"phone": "4809861193",
"email": "SVCMNGR0738@PEPBOYS.COM"
},
{
"store": "739",
"name": "THOUSAND OAKS",
"address": "2099E THOUSAND OAKS BLVD",
"city": "THOUSAND OAKS",
"state": "CA",
"zip": "91362",
"phone": "8054970089",
"email": "SVCMNGR0739@PEPBOYS.COM"
},
{
"store": "741",
"name": "NACOGDOCHES",
"address": "12535 NACOGDOCHES RD",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78217",
"phone": "2105990068",
"email": "SVCMNGR0741@PEPBOYS.COM"
},
{
"store": "742",
"name": "TRI-CITY CROSSROAD",
"address": "3752 PLAZA DR",
"city": "OCEANSIDE",
"state": "CA",
"zip": "92056",
"phone": "7607242726",
"email": "SVCMNGR0742@PEPBOYS.COM"
},
{
"store": "744",
"name": "LEON VALLEY",
"address": "7680 BANDERA RD",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78238",
"phone": "2106801675",
"email": "SVCMNGR0744@PEPBOYS.COM"
},
{
"store": "745",
"name": "WESTMORELAND",
"address": "3120 FORT WORTH AVE",
"city": "DALLAS",
"state": "TX",
"zip": "75211",
"phone": "2143395108",
"email": "SVCMNGR0745@PEPBOYS.COM"
},
{
"store": "748",
"name": "PEORIA",
"address": "7440 W PEORIA AVE",
"city": "PEORIA",
"state": "AZ",
"zip": "85345",
"phone": "6234864544",
"email": "SVCMNGR0748@PEPBOYS.COM"
},
{
"store": "749",
"name": "AUSTIN",
"address": "8917 RESEARCH BLVD",
"city": "AUSTIN",
"state": "TX",
"zip": "78758",
"phone": "5123391144",
"email": "SVCMNGR0749@PEPBOYS.COM"
},
{
"store": "751",
"name": "SEMINARY",
"address": "101 W SEMINARY DR",
"city": "FORT WORTH",
"state": "TX",
"zip": "76115",
"phone": "8179267737",
"email": "SVCMNGR0751@PEPBOYS.COM"
},
{
"store": "753",
"name": "SIERRA PLAZA",
"address": "7465 N MESA ST",
"city": "EL PASO",
"state": "TX",
"zip": "79912",
"phone": "9155848276",
"email": "SVCMNGR0753@PEPBOYS.COM"
},
{
"store": "754",
"name": "SOUTH WALKER",
"address": "7600 S WALKER ST",
"city": "OKLAHOMA CITY",
"state": "OK",
"zip": "73139",
"phone": "4056310070",
"email": "SVCMNGR0754@PEPBOYS.COM"
},
{
"store": "756",
"name": "NORTHWEST HIGHWAY",
"address": "7401 NW EXPRESSWAY",
"city": "OKLAHOMA CITY",
"state": "OK",
"zip": "73132",
"phone": "4057225081",
"email": "SVCMNGR0756@PEPBOYS.COM"
},
{
"store": "757",
"name": "VAN BUREN",
"address": "2502 W VAN BUREN",
"city": "PHOENIX",
"state": "AZ",
"zip": "85009",
"phone": "6022696771",
"email": "SVCMNGR0757@PEPBOYS.COM"
},
{
"store": "760",
"name": "HARLINGEN",
"address": "2321 W EXPRESSWAY 83",
"city": "HARLINGEN",
"state": "TX",
"zip": "78552",
"phone": "9564258611",
"email": "SVCMNGR0760@PEPBOYS.COM"
},
{
"store": "761",
"name": "FOREST LANE",
"address": "2992 FOREST LN",
"city": "DALLAS",
"state": "TX",
"zip": "75234",
"phone": "9722434401",
"email": "SVCMNGR0761@PEPBOYS.COM"
},
{
"store": "763",
"name": "BELLFLOWER",
"address": "8533 ARTESIA BLVD",
"city": "BELLFLOWER",
"state": "CA",
"zip": "90706",
"phone": "5626308985",
"email": "SVCMNGR0763@PEPBOYS.COM"
},
{
"store": "764",
"name": "QUAIL SPRINGS",
"address": "2317 W MEMORIAL RD",
"city": "OKLAHOMA CITY",
"state": "OK",
"zip": "73134",
"phone": "4057490260",
"email": "SVCMNGR0764@PEPBOYS.COM"
},
{
"store": "766",
"name": "BROWNSVILLE",
"address": "2336 BOCA CHICA BLVD",
"city": "BROWNSVILLE",
"state": "TX",
"zip": "78521",
"phone": "9565461934",
"email": "SVCMNGR0766@PEPBOYS.COM"
},
{
"store": "767",
"name": "WESLACO",
"address": "212 W. EXPRESSWAY  83",
"city": "WESLACO",
"state": "TX",
"zip": "78596",
"phone": "9569690856",
"email": "SVCMNGR0767@PEPBOYS.COM"
},
{
"store": "768",
"name": "MCALLEN",
"address": "609 S 10TH ST",
"city": "MCALLEN",
"state": "TX",
"zip": "78501",
"phone": "9566310023",
"email": "SVCMNGR0768@PEPBOYS.COM"
},
{
"store": "769",
"name": "KOLB",
"address": "7227 E 22ND ST",
"city": "TUCSON",
"state": "AZ",
"zip": "85710",
"phone": "5207210424",
"email": "SVCMNGR0769@PEPBOYS.COM"
},
{
"store": "771",
"name": "CALEXICO",
"address": "400 IMPERIAL AVE",
"city": "CALEXICO",
"state": "CA",
"zip": "92231",
"phone": "7603574966",
"email": "SVCMNGR0771@PEPBOYS.COM"
},
{
"store": "772",
"name": "PALMDALE",
"address": "3054 E PALMDALE BLVD",
"city": "PALMDALE",
"state": "CA",
"zip": "93550",
"phone": "6612660193",
"email": "SVCMNGR0772@PEPBOYS.COM"
},
{
"store": "773",
"name": "HESPERIA",
"address": "15659 MAIN ST",
"city": "HESPERIA",
"state": "CA",
"zip": "92345",
"phone": "7609474791",
"email": "SVCMNGR0773@PEPBOYS.COM"
},
{
"store": "775",
"name": "LAREDO",
"address": "4401 SAN DARIO ST",
"city": "LAREDO",
"state": "TX",
"zip": "78041",
"phone": "9567269795",
"email": "SVCMNGR0775@PEPBOYS.COM"
},
{
"store": "776",
"name": "FLAMINGO",
"address": "4155 S JONES BLVD",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89103",
"phone": "7023623833",
"email": "SVCMNGR0776@PEPBOYS.COM"
},
{
"store": "777",
"name": "SHAW",
"address": "4490 W SHAW AVE",
"city": "FRESNO",
"state": "CA",
"zip": "93722",
"phone": "5592767501",
"email": "SVCMNGR0777@PEPBOYS.COM"
},
{
"store": "778",
"name": "CORONA",
"address": "581 N MAIN ST",
"city": "CORONA",
"state": "CA",
"zip": "92880",
"phone": "9512799230",
"email": "SVCMNGR0778@PEPBOYS.COM"
},
{
"store": "784",
"name": "RIVERDALE/UT",
"address": "4240 RIVERDALE RD",
"city": "OGDEN",
"state": "UT",
"zip": "84405",
"phone": "8013931200",
"email": "SVCMNGR0784@PEPBOYS.COM"
},
{
"store": "785",
"name": "WEST VALLEY",
"address": "2040 W 3500 SOUTH ST",
"city": "WEST VALLEY CITY",
"state": "UT",
"zip": "84119",
"phone": "8019725550",
"email": "SVCMNGR0785@PEPBOYS.COM"
},
{
"store": "786",
"name": "WACO",
"address": "581 N VALLEY MILLS DR",
"city": "WACO",
"state": "TX",
"zip": "76710",
"phone": "2547725805",
"email": "SVCMNGR0786@PEPBOYS.COM"
},
{
"store": "787",
"name": "TYLER",
"address": "3616 S BROADWAY AVE",
"city": "TYLER",
"state": "TX",
"zip": "75701",
"phone": "9035618820",
"email": "SVCMNGR0787@PEPBOYS.COM"
},
{
"store": "788",
"name": "ABILENE",
"address": "2473 S DANVILLE ST",
"city": "ABILENE",
"state": "TX",
"zip": "79605",
"phone": "3256927374",
"email": "SVCMNGR0788@PEPBOYS.COM"
},
{
"store": "790",
"name": "RIALTO, FOOTHILL BLVD",
"address": "505 E FOOTHILL BLVD",
"city": "RIALTO",
"state": "CA",
"zip": "92376",
"phone": "9094211177",
"email": "SVCMNGR0790@PEPBOYS.COM"
},
{
"store": "792",
"name": "SANTA FE SPRINGS",
"address": "11456 E WASHINGTON BLVD",
"city": "WHITTIER",
"state": "CA",
"zip": "90606",
"phone": "5629084400",
"email": "SVCMNGR0792@PEPBOYS.COM"
},
{
"store": "793",
"name": "SANDY CITY",
"address": "9319 S 700 EAST",
"city": "SANDY",
"state": "UT",
"zip": "84070",
"phone": "8015658811",
"email": "SVCMNGR0793@PEPBOYS.COM"
},
{
"store": "795",
"name": "NOGALES",
"address": "470 N GRAND AVE",
"city": "NOGALES",
"state": "AZ",
"zip": "85621",
"phone": "5202873626",
"email": "SVCMNGR0795@PEPBOYS.COM"
},
{
"store": "796",
"name": "EAST CENTRAL AVENUE",
"address": "5600 CENTRAL AVE SE",
"city": "ALBUQUERQUE",
"state": "NM",
"zip": "87108",
"phone": "5052660036",
"email": "SVCMNGR0796@PEPBOYS.COM"
},
{
"store": "798",
"name": "LAKE FOREST",
"address": "22675 LAKE FOREST DR",
"city": "LAKE FOREST",
"state": "CA",
"zip": "92630",
"phone": "9498559593",
"email": "SVCMNGR0798@PEPBOYS.COM"
},
{
"store": "799",
"name": "HUNTINGTON BEACH",
"address": "19122 BROOKHURST ST",
"city": "HUNTINGTON BEACH",
"state": "CA",
"zip": "92646",
"phone": "7149640777",
"email": "SVCMNGR0799@PEPBOYS.COM"
},
{
"store": "800",
"name": "TEMECULA",
"address": "40605 WINCHESTER RD",
"city": "TEMECULA",
"state": "CA",
"zip": "92591",
"phone": "9516952322",
"email": "SVCMNGR0800@PEPBOYS.COM"
},
{
"store": "803",
"name": "LONG BEACH",
"address": "4645 E PACIFIC COAST HWY",
"city": "LONG BEACH",
"state": "CA",
"zip": "90804",
"phone": "5629850778",
"email": "SVCMNGR0803@PEPBOYS.COM"
},
{
"store": "806",
"name": "ORANGE, KATELLA AVENUE",
"address": "215 E KATELLA AVE",
"city": "ORANGE",
"state": "CA",
"zip": "92867",
"phone": "7149971540",
"email": "SVCMNGR0806@PEPBOYS.COM"
},
{
"store": "808",
"name": "SANTA CLARITA",
"address": "20600 GOLDEN TRIANGLE RD",
"city": "SANTA CLARITA",
"state": "CA",
"zip": "91351",
"phone": "6612518004",
"email": "SVCMNGR0808@PEPBOYS.COM"
},
{
"store": "809",
"name": "ANAHEIM HILLS",
"address": "8205 E SANTA ANA CANYON R",
"city": "ANAHEIM",
"state": "CA",
"zip": "92808",
"phone": "7149740105",
"email": "SVCMNGR0809@PEPBOYS.COM"
},
{
"store": "810",
"name": "NORMAL HEIGHTS",
"address": "3550 EL CAJON BLVD",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92104",
"phone": "6192837107",
"email": "SVCMNGR0810@PEPBOYS.COM"
},
{
"store": "812",
"name": "CHINO HILLS",
"address": "4046 GRAND AVE",
"city": "CHINO HILLS",
"state": "CA",
"zip": "91710",
"phone": "9095907141",
"email": "SVCMNGR0812@PEPBOYS.COM"
},
{
"store": "813",
"name": "EL CAJON",
"address": "201 JAMACHA RD",
"city": "EL CAJON",
"state": "CA",
"zip": "92019",
"phone": "6195900084",
"email": "SVCMNGR0813@PEPBOYS.COM"
},
{
"store": "814",
"name": "REDONDO",
"address": "1800 ARTESIA BLVD",
"city": "REDONDO BEACH",
"state": "CA",
"zip": "90278",
"phone": "3107989968",
"email": "SVCMNGR0814@PEPBOYS.COM"
},
{
"store": "816",
"name": "UNION CITY/CA",
"address": "30085 INDUSTRIAL PARKWAY",
"city": "UNION CITY",
"state": "CA",
"zip": "94587",
"phone": "5104410261",
"email": "SVCMNGR0816@PEPBOYS.COM"
},
{
"store": "817",
"name": "ORLAND PARK",
"address": "15911 S. LAGRANGE RD",
"city": "ORLAND PK",
"state": "IL",
"zip": "60467",
"phone": "7083490130",
"email": "SVCMNGR0817@PEPBOYS.COM"
},
{
"store": "818",
"name": "NAPERVILLE",
"address": "2936 W OGDEN AVE",
"city": "NAPERVILLE",
"state": "IL",
"zip": "60540",
"phone": "6306371350",
"email": "SVCMNGR0818@PEPBOYS.COM"
},
{
"store": "819",
"name": "SUMMERLIN",
"address": "7399 W LAKE MEAD BLVD",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89128",
"phone": "7028384646",
"email": "SVCMNGR0819@PEPBOYS.COM"
},
{
"store": "822",
"name": "BEDFORD PARK",
"address": "7030 S CICERO AVE",
"city": "CHICAGO",
"state": "IL",
"zip": "60638",
"phone": "7084969123",
"email": "SVCMNGR0822@PEPBOYS.COM"
},
{
"store": "823",
"name": "BRICKYARD MALL",
"address": "6811 W GRAND AVE",
"city": "CHICAGO",
"state": "IL",
"zip": "60707",
"phone": "7738896395",
"email": "SVCMNGR0823@PEPBOYS.COM"
},
{
"store": "830",
"name": "PORTSMOUTH /NH",
"address": "50 DURGIN LN",
"city": "PORTSMOUTH",
"state": "NH",
"zip": "03801",
"phone": "6034306223",
"email": "SVCMNGR0830@PEPBOYS.COM"
},
{
"store": "831",
"name": "HODGKINS",
"address": "6247 LA GRANGE RD",
"city": "HODGKINS",
"state": "IL",
"zip": "60525",
"phone": "7083529211",
"email": "SVCMNGR0831@PEPBOYS.COM"
},
{
"store": "833",
"name": "REDLANDS",
"address": "1650 W REDLANDS BLVD",
"city": "REDLANDS",
"state": "CA",
"zip": "92373",
"phone": "9097929110",
"email": "SVCMNGR0833@PEPBOYS.COM"
},
{
"store": "837",
"name": "BROADVIEW",
"address": "900 BROADVIEW VILLAGE SQ",
"city": "BROADVIEW",
"state": "IL",
"zip": "60155",
"phone": "7083439881",
"email": "SVCMNGR0837@PEPBOYS.COM"
},
{
"store": "840",
"name": "SUNNYVALE",
"address": "170 E EL CAMINO BLVD",
"city": "SUNNYVALE",
"state": "CA",
"zip": "94087",
"phone": "4087740159",
"email": "SVCMNGR0840@PEPBOYS.COM"
},
{
"store": "841",
"name": "COVINA",
"address": "1270 N AZUSA AVE",
"city": "COVINA",
"state": "CA",
"zip": "91722",
"phone": "6269661244",
"email": "SVCMNGR0841@PEPBOYS.COM"
},
{
"store": "846",
"name": "JOLIET",
"address": "1824 W JEFFERSON ST",
"city": "JOLIET",
"state": "IL",
"zip": "60435",
"phone": "8157440150",
"email": "SVCMNGR0846@PEPBOYS.COM"
},
{
"store": "847",
"name": "SAN LEANDRO",
"address": "14845 E 14TH STREET",
"city": "SAN LEANDRO",
"state": "CA",
"zip": "94578",
"phone": "5108959200",
"email": "SVCMNGR0847@PEPBOYS.COM"
},
{
"store": "848",
"name": "SALEM/NH",
"address": "524 S BROADWAY",
"city": "SALEM",
"state": "NH",
"zip": "03079",
"phone": "6038900555",
"email": "SVCMNGR0848@PEPBOYS.COM"
},
{
"store": "849",
"name": "MANCHESTER/NH",
"address": "875 S WILLOW ST",
"city": "MANCHESTER",
"state": "NH",
"zip": "03103",
"phone": "6036246277",
"email": "SVCMNGR0849@PEPBOYS.COM"
},
{
"store": "850",
"name": "NASHUA",
"address": "274 AMHERST ST",
"city": "NASHUA",
"state": "NH",
"zip": "03063",
"phone": "6035986600",
"email": "SVCMNGR0850@PEPBOYS.COM"
},
{
"store": "853",
"name": "CRESTWOOD",
"address": "13401 S CICERO AVE",
"city": "CRESTWOOD",
"state": "IL",
"zip": "60445",
"phone": "7084892693",
"email": "SVCMNGR0853@PEPBOYS.COM"
},
{
"store": "854",
"name": "NORTH HOLLYWOOD",
"address": "6065 LANKERSHIM BLVD",
"city": "N HOLLYWOOD",
"state": "CA",
"zip": "91606",
"phone": "8187630355",
"email": "SVCMNGR0854@PEPBOYS.COM"
},
{
"store": "856",
"name": "ELSTON",
"address": "2604 N ELSTON AVE",
"city": "CHICAGO",
"state": "IL",
"zip": "60647",
"phone": "7733954444",
"email": "SVCMNGR0856@PEPBOYS.COM"
},
{
"store": "857",
"name": "ATWATER VILLAGE",
"address": "3332 SAN FERNANDO RD",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90065",
"phone": "3232580325",
"email": "SVCMNGR0857@PEPBOYS.COM"
},
{
"store": "858",
"name": "CHICAGO RIDGE",
"address": "10100 S RIDGELAND AVE",
"city": "CHICAGO RIDGE",
"state": "IL",
"zip": "60415",
"phone": "7083460776",
"email": "SVCMNGR0858@PEPBOYS.COM"
},
{
"store": "859",
"name": "HANFORD",
"address": "1836 W LACEY BLVD",
"city": "HANFORD",
"state": "CA",
"zip": "93230",
"phone": "5595839790",
"email": "SVCMNGR0859@PEPBOYS.COM"
},
{
"store": "866",
"name": "HEMET",
"address": "2050 W FLORIDA AVE",
"city": "HEMET",
"state": "CA",
"zip": "92545",
"phone": "9517661477",
"email": "SVCMNGR0866@PEPBOYS.COM"
},
{
"store": "868",
"name": "RANCHO DRIVE",
"address": "4141 RANCHO DR",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89130",
"phone": "7026451811",
"email": "SVCMNGR0868@PEPBOYS.COM"
},
{
"store": "869",
"name": "HENDERSON",
"address": "408 S BOULDER HWY",
"city": "HENDERSON",
"state": "NV",
"zip": "89015",
"phone": "7025645566",
"email": "SVCMNGR0869@PEPBOYS.COM"
},
{
"store": "872",
"name": "RANCHO DEL REY",
"address": "1000 TIERRA DEL REY",
"city": "CHULA VISTA",
"state": "CA",
"zip": "91910",
"phone": "6192164604",
"email": "SVCMNGR0872@PEPBOYS.COM"
},
{
"store": "873",
"name": "STEVENS CREEK",
"address": "3780 STEVENS CREEK BLVD",
"city": "SAN JOSE",
"state": "CA",
"zip": "95117",
"phone": "4082468090",
"email": "SVCMNGR0873@PEPBOYS.COM"
},
{
"store": "879",
"name": "PANORAMA CITY",
"address": "8521 VAN NUYS BLVD",
"city": "PANORAMA CITY",
"state": "CA",
"zip": "91402",
"phone": "8188912949",
"email": "SVCMNGR0879@PEPBOYS.COM"
},
{
"store": "880",
"name": "ALISO VIEJO",
"address": "26881 ALISO CREEK RD",
"city": "ALISO VIEJO",
"state": "CA",
"zip": "92656",
"phone": "9493629254",
"email": "SVCMNGR0880@PEPBOYS.COM"
},
{
"store": "881",
"name": "CHINO",
"address": "11980 CENTRAL AVE",
"city": "CHINO",
"state": "CA",
"zip": "91710",
"phone": "9096273662",
"email": "SVCMNGR0881@PEPBOYS.COM"
},
{
"store": "888",
"name": "SHERMAN OAKS",
"address": "6110 SEPULVEDA BLVD",
"city": "VAN NUYS",
"state": "CA",
"zip": "91411",
"phone": "8187873311",
"email": "SVCMNGR0888@PEPBOYS.COM"
},
{
"store": "889",
"name": "LANSING",
"address": "17015 TORRENCE AVE",
"city": "LANSING",
"state": "IL",
"zip": "60438",
"phone": "7088955859",
"email": "SVCMNGR0889@PEPBOYS.COM"
},
{
"store": "894",
"name": "CULVER CITY",
"address": "4520 S SEPULVEDA BLVD 102",
"city": "CULVER CITY",
"state": "CA",
"zip": "90230",
"phone": "3103975553",
"email": "SVCMNGR0894@PEPBOYS.COM"
},
{
"store": "898",
"name": "SANTEE",
"address": "10041 MISSION GORGE RD",
"city": "SANTEE",
"state": "CA",
"zip": "92071",
"phone": "6195964567",
"email": "SVCMNGR0898@PEPBOYS.COM"
},
{
"store": "905",
"name": "FAJARDO",
"address": "4190 CARR 3",
"city": "FAJARDO",
"state": "PR",
"zip": "00738",
"phone": "7878602700",
"email": "SVCMNGR0905@PEPBOYS.COM"
},
{
"store": "906",
"name": "JUANA DIAZ",
"address": "200 CARR 149",
"city": "JUANA DIAZ",
"state": "PR",
"zip": "00795",
"phone": "7878370200",
"email": "SVCMNGR0906@PEPBOYS.COM"
},
{
"store": "907",
"name": "SAN GERMAN",
"address": "300 AVE CASTO PEREZ",
"city": "SAN GERMAN",
"state": "PR",
"zip": "00683",
"phone": "7878922700",
"email": "SVCMNGR0907@PEPBOYS.COM"
},
{
"store": "908",
"name": "HATILLO",
"address": "505 CALLE LA MILITAR",
"city": "HATILLO",
"state": "PR",
"zip": "00659",
"phone": "7878802700",
"email": "SVCMNGR0908@PEPBOYS.COM"
},
{
"store": "909",
"name": "CAYEY",
"address": "6000 AVE JESUS T PINIERO",
"city": "CAYEY",
"state": "PR",
"zip": "00736",
"phone": "7872632700",
"email": "SVCMNGR0909@PEPBOYS.COM"
},
{
"store": "910",
"name": "HUMACAO",
"address": "350 CARR 3",
"city": "HUMACAO",
"state": "PR",
"zip": "00791",
"phone": "7878529000",
"email": "SVCMNGR0910@PEPBOYS.COM"
},
{
"store": "911",
"name": "ISABELA",
"address": "3535 AVE MILITAL",
"city": "ISABELA",
"state": "PR",
"zip": "00662",
"phone": "7878722700",
"email": "SVCMNGR0911@PEPBOYS.COM"
},
{
"store": "912",
"name": "CAGUAS",
"address": "200 AVE RAFELCORDRO",
"city": "CAGUAS",
"state": "PR",
"zip": "00725",
"phone": "7872862700",
"email": "SVCMNGR0912@PEPBOYS.COM"
},
{
"store": "913",
"name": "LEVITTOWN",
"address": "60 CALLE ACACIA",
"city": "TOA BAJA",
"state": "PR",
"zip": "00949",
"phone": "7877952700",
"email": "SVCMNGR0913@PEPBOYS.COM"
},
{
"store": "914",
"name": "CAROLINA",
"address": "14100 AVE 65 INFANTERIA",
"city": "CAROLINA",
"state": "PR",
"zip": "00987",
"phone": "7872762700",
"email": "SVCMNGR0914@PEPBOYS.COM"
},
{
"store": "917",
"name": "65TH & INFANTRY",
"address": "845 AVE 65 INFANTERIA",
"city": "SAN JUAN",
"state": "PR",
"zip": "00924",
"phone": "7877542700",
"email": "SVCMNGR0917@PEPBOYS.COM"
},
{
"store": "918",
"name": "N.BAYAMON",
"address": "715 AVE WEST MAIN",
"city": "BAYAMON",
"state": "PR",
"zip": "00961",
"phone": "7877982700",
"email": "SVCMNGR0918@PEPBOYS.COM"
},
{
"store": "919",
"name": "BAYAMON UNIVERSITY",
"address": "1000 AVE RAMON LUIS RIVER",
"city": "BAYAMON",
"state": "PR",
"zip": "00959",
"phone": "7872692700",
"email": "SVCMNGR0919@PEPBOYS.COM"
},
{
"store": "920",
"name": "N. MAYAGUEZ",
"address": "2765 AVE HOSTOS",
"city": "MAYAGUEZ",
"state": "PR",
"zip": "00682",
"phone": "7878052700",
"email": "SVCMNGR0920@PEPBOYS.COM"
},
{
"store": "921",
"name": "TRUJILLO ALTO",
"address": "160 MARGNAL LAGO ALTO",
"city": "TRUJILLO ALTO",
"state": "PR",
"zip": "00976",
"phone": "7877482700",
"email": "SVCMNGR0921@PEPBOYS.COM"
},
{
"store": "922",
"name": "JUNCOS",
"address": "350 JUNCOS PLZ",
"city": "JUNCOS",
"state": "PR",
"zip": "00777",
"phone": "7877340010",
"email": "SVCMNGR0922@PEPBOYS.COM"
},
{
"store": "923",
"name": "S. PONCE",
"address": "2422 PONCE BYP",
"city": "PONCE",
"state": "PR",
"zip": "00716",
"phone": "7872592700",
"email": "SVCMNGR0923@PEPBOYS.COM"
},
{
"store": "924",
"name": "GUAYAMA",
"address": "730 CALLE MARGINAL",
"city": "GUAYAMA",
"state": "PR",
"zip": "00784",
"phone": "7878662700",
"email": "SVCMNGR0924@PEPBOYS.COM"
},
{
"store": "925",
"name": "AGUADILLA",
"address": "15068 CARR 2 AGUADILLA",
"city": "AGUADILLA",
"state": "PR",
"zip": "00603",
"phone": "7878820700",
"email": "SVCMNGR0925@PEPBOYS.COM"
},
{
"store": "926",
"name": "ALTAMIRA",
"address": "1903 AVE JESUS T.PINERO",
"city": "SAN JUAN",
"state": "PR",
"zip": "00920",
"phone": "7877749000",
"email": "SVCMNGR0926@PEPBOYS.COM"
},
{
"store": "927",
"name": "RIO GRANDE",
"address": "23110 PR-3",
"city": "RIO GRANDE",
"state": "PR",
"zip": "00745",
"phone": "7878882700",
"email": "SVCMNGR0927@PEPBOYS.COM"
},
{
"store": "929",
"name": "S. MAYAGUEZ",
"address": "990 AVE HOSTOS",
"city": "MAYAGUEZ",
"state": "PR",
"zip": "00682",
"phone": "7872650610",
"email": "SVCMNGR0929@PEPBOYS.COM"
},
{
"store": "930",
"name": "CAMPO RICO",
"address": "1700 AVE ROBERTO SANCHEZ",
"city": "CAROLINA",
"state": "PR",
"zip": "00982",
"phone": "7877622700",
"email": "SVCMNGR0930@PEPBOYS.COM"
},
{
"store": "931",
"name": "SAN SEBASTIAN",
"address": "4172 AVE ARCADIO ESTRADA",
"city": "SAN SEBASTIAN",
"state": "PR",
"zip": "00685",
"phone": "7878960707",
"email": "SVCMNGR0931@PEPBOYS.COM"
},
{
"store": "960",
"name": "UPLAND",
"address": "304 E FOOTHILL BLVD",
"city": "UPLAND",
"state": "CA",
"zip": "91786",
"phone": "9099319996",
"email": "SVCMNGR0960@PEPBOYS.COM"
},
{
"store": "966",
"name": "WAUKEGAN",
"address": "620 N GREENBAY RD",
"city": "WAUKEGAN",
"state": "IL",
"zip": "60085",
"phone": "8476626455",
"email": "SVCMNGR0966@PEPBOYS.COM"
},
{
"store": "968",
"name": "PLEASANT HILL",
"address": "520 CONTRA COSTA BLVD",
"city": "PLEASANT HILL",
"state": "CA",
"zip": "94523",
"phone": "9256910178",
"email": "SVCMNGR0968@PEPBOYS.COM"
},
{
"store": "970",
"name": "CRENSHAW & RODEO",
"address": "3737 CRENSHAW BLVD",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90016",
"phone": "3232901125",
"email": "SVCMNGR0970@PEPBOYS.COM"
},
{
"store": "972",
"name": "VICTORVILLE",
"address": "14475 7TH ST",
"city": "VICTORVILLE",
"state": "CA",
"zip": "92395",
"phone": "7602456055",
"email": "SVCMNGR0972@PEPBOYS.COM"
},
{
"store": "975",
"name": "WEST HILLS",
"address": "6325 FALLBROOK AVE",
"city": "WOODLAND HILLS",
"state": "CA",
"zip": "91367",
"phone": "8188831770",
"email": "SVCMNGR0975@PEPBOYS.COM"
},
{
"store": "978",
"name": "CLAIREMONT",
"address": "4441 GENESEE AVE",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92117",
"phone": "8585699533",
"email": "SVCMNGR0978@PEPBOYS.COM"
},
{
"store": "979",
"name": "STREAMWOOD",
"address": "160 N BARRINGTON RD",
"city": "STREAMWOOD",
"state": "IL",
"zip": "60107",
"phone": "6308306442",
"email": "SVCMNGR0979@PEPBOYS.COM"
},
{
"store": "980",
"name": "CHICO",
"address": "1555 MANGROVE AVE",
"city": "CHICO",
"state": "CA",
"zip": "95926",
"phone": "5308951336",
"email": "SVCMNGR0980@PEPBOYS.COM"
},
{
"store": "985",
"name": "MONROVIA",
"address": "201 WEST HUNTINGTON DR",
"city": "MONROVIA",
"state": "CA",
"zip": "91016",
"phone": "6263033906",
"email": "SVCMNGR0985@PEPBOYS.COM"
},
{
"store": "987",
"name": "ROUND LAKE",
"address": "818 E ROLLINS RD",
"city": "ROUND LAKE BEACH",
"state": "IL",
"zip": "60073",
"phone": "8475488711",
"email": "SVCMNGR0987@PEPBOYS.COM"
},
{
"store": "990",
"name": "61ST WESTERN",
"address": "5959 S WESTERN AVE",
"city": "CHICAGO",
"state": "IL",
"zip": "60636",
"phone": "7737769477",
"email": "SVCMNGR0990@PEPBOYS.COM"
},
{
"store": "995",
"name": "EL CENTRO",
"address": "902 N IMPERIAL AVE",
"city": "EL CENTRO",
"state": "CA",
"zip": "92243",
"phone": "7603538565",
"email": "SVCMNGR0995@PEPBOYS.COM"
},
{
"store": "1003",
"name": "CIDRA",
"address": "500 CARR 172",
"city": "CIDRA",
"state": "PR",
"zip": "00739",
"phone": "7877142700",
"email": "SVCMNGR1003@PEPBOYS.COM"
},
{
"store": "1011",
"name": "BLOOMINGTON/IN",
"address": "3160 W. SUSAN DR",
"city": "BLOOMINGTON",
"state": "IN",
"zip": "47404",
"phone": "8123340204",
"email": "SVCMNGR1011@PEPBOYS.COM"
},
{
"store": "1014",
"name": "BRIDGEWATER",
"address": "735 PROMENADE BLVD",
"city": "BRIDGEWATER",
"state": "NJ",
"zip": "08807",
"phone": "7325609559",
"email": "SVCMNGR1014@PEPBOYS.COM"
},
{
"store": "1048",
"name": "PATERSON",
"address": "261 MCLEAN BLVD",
"city": "PATERSON",
"state": "NJ",
"zip": "07504",
"phone": "9733418140",
"email": "SVCMNGR1048@PEPBOYS.COM"
},
{
"store": "1051",
"name": "LINDBERGH",
"address": "7720 LINDBERGH BLVD",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19153",
"phone": "2159217912",
"email": "SVCMNGR1051@PEPBOYS.COM"
},
{
"store": "1053",
"name": "CARTERET",
"address": "773 ROOSEVELT AVE",
"city": "CARTERET",
"state": "NJ",
"zip": "07008",
"phone": "7329690921",
"email": "SVCMNGR1053@PEPBOYS.COM"
},
{
"store": "1054",
"name": "CLERMONT",
"address": "950 HOOKS STREET",
"city": "CLERMONT",
"state": "FL",
"zip": "34711",
"phone": "3522432109",
"email": "SVCMNGR1054@PEPBOYS.COM"
},
{
"store": "1057",
"name": "HASBROUCK HEIGHTS",
"address": "5 NJ-17",
"city": "HASBROUCK HEIGHTS",
"state": "NJ",
"zip": "07604",
"phone": "2012702721",
"email": "SVCMNGR1057@PEPBOYS.COM"
},
{
"store": "1058",
"name": "COLLEGEVILLE",
"address": "222 EAST MAIN STREET",
"city": "COLLEGEVILLE",
"state": "PA",
"zip": "19426",
"phone": "6104543000",
"email": "SVCMNGR1058@PEPBOYS.COM"
},
{
"store": "1059",
"name": "ACWORTH",
"address": "3638 COBB PARKWAY NORTH",
"city": "ACWORTH",
"state": "GA",
"zip": "30101",
"phone": "7706596169",
"email": "SVCMNGR1059@PEPBOYS.COM"
},
{
"store": "1060",
"name": "GUNBARREL ROAD",
"address": "2114 GUNBARREL RD",
"city": "CHATTANOOGA",
"state": "TN",
"zip": "37421",
"phone": "4232989104",
"email": "SVCMNGR1060@PEPBOYS.COM"
},
{
"store": "1061",
"name": "OVIEDO",
"address": "2994 ALAFAYA TRAIL",
"city": "OVIEDO",
"state": "FL",
"zip": "32765",
"phone": "4073265000",
"email": "SVCMNGR1061@PEPBOYS.COM"
},
{
"store": "1063",
"name": "SUGARLAND",
"address": "10225 HIGHWAY 6 SOUTH",
"city": "SUGAR LAND",
"state": "TX",
"zip": "77498",
"phone": "2812400419",
"email": "SVCMNGR1063@PEPBOYS.COM"
},
{
"store": "1064",
"name": "MALL OF GEORGIA",
"address": "2908 BUFORD DRIVE NE",
"city": "BUFORD",
"state": "GA",
"zip": "30519",
"phone": "7708315418",
"email": "SVCMNGR1064@PEPBOYS.COM"
},
{
"store": "1067",
"name": "QUEENS BAYSIDE",
"address": "20411 NORTHERN BLVD",
"city": "BAYSIDE",
"state": "NY",
"zip": "11361",
"phone": "7187170002",
"email": "SVCMNGR1067@PEPBOYS.COM"
},
{
"store": "1069",
"name": "KING OF PRUSSIA",
"address": "214 E. DEKALB PIKE",
"city": "KING OF PRUSSIA",
"state": "PA",
"zip": "19406",
"phone": "6103824002",
"email": "SVCMNGR1069@PEPBOYS.COM"
},
{
"store": "1070",
"name": "HOMEWOOD",
"address": "804 GREENSPRINGS HIGHWAY",
"city": "HOMEWOOD",
"state": "AL",
"zip": "35209",
"phone": "2059481233",
"email": "SVCMNGR1070@PEPBOYS.COM"
},
{
"store": "1071",
"name": "ROSELLE",
"address": "711 EAST 1ST AVENUE",
"city": "ROSELLE",
"state": "NJ",
"zip": "07203",
"phone": "9082452041",
"email": "SVCMNGR1071@PEPBOYS.COM"
},
{
"store": "1072",
"name": "LONG ISLAND CITY",
"address": "38-19 21ST STEET",
"city": "LONG ISLAND CITY",
"state": "NY",
"zip": "11101",
"phone": "7187067830",
"email": "SVCMNGR1072@PEPBOYS.COM"
},
{
"store": "1073",
"name": "EAST NORRITON",
"address": "69 W GERMANTOWN PIKE",
"city": "NORRISTOWN",
"state": "PA",
"zip": "19401",
"phone": "6102796720",
"email": "SVCMNGR1073@PEPBOYS.COM"
},
{
"store": "1401",
"name": "VENTURA (SO)",
"address": "2705 EAST THOMPSON BLVD",
"city": "VENTURA",
"state": "CA",
"zip": "93003",
"phone": "8056520653",
"email": "SVCMNGR1401@PEPBOYS.COM"
},
{
"store": "1404",
"name": "E. PUENTE HILL",
"address": "17811 COLIMA RD",
"city": "CITY OF INDUSTRY",
"state": "CA",
"zip": "91748",
"phone": "6269648176",
"email": "SVCMNGR1404@PEPBOYS.COM"
},
{
"store": "1405",
"name": "BRICK",
"address": "274 BRICK BLVD",
"city": "BRICK",
"state": "NJ",
"zip": "08723",
"phone": "7322625293",
"email": "SVCMNGR1405@PEPBOYS.COM"
},
{
"store": "1407",
"name": "ELGIN SERVICE CENTER",
"address": "1020 SUMMIT ST",
"city": "ELGIN",
"state": "IL",
"zip": "60120",
"phone": "8476958640",
"email": "SVCMNGR1407@PEPBOYS.COM"
},
{
"store": "1408",
"name": "SOUTH BROAD STREET",
"address": "1201 SOUTH BROAD ST",
"city": "PHILADELPHIA",
"state": "PA",
"zip": "19147",
"phone": "2152716813",
"email": "SVCMNGR1408@PEPBOYS.COM"
},
{
"store": "1411",
"name": "FOREST PARK",
"address": "25 SOUTH HARLEM AVE",
"city": "FOREST PARK",
"state": "IL",
"zip": "60130",
"phone": "7087715365",
"email": "SVCMNGR1411@PEPBOYS.COM"
},
{
"store": "1414",
"name": "EATONTOWN",
"address": "79 S. HIGHWAY 35",
"city": "EATONTOWN",
"state": "NJ",
"zip": "07724",
"phone": "7323892821",
"email": "SVCMNGR1414@PEPBOYS.COM"
},
{
"store": "1417",
"name": "CLERMONT",
"address": "1437 SUNRISE PLAZA DR",
"city": "CLERMONT",
"state": "FL",
"zip": "34714",
"phone": "3525361177",
"email": "SVCMNGR1417@PEPBOYS.COM"
},
{
"store": "1419",
"name": "LEESBURG",
"address": "1314 W MAIN ST",
"city": "LEESBURG",
"state": "FL",
"zip": "34748",
"phone": "3527872144",
"email": "SVCMNGR1419@PEPBOYS.COM"
},
{
"store": "1422",
"name": "APOPKA SERVICE AND TIRE",
"address": "260 E MAIN STREET",
"city": "APOPKA",
"state": "FL",
"zip": "32703",
"phone": "4078862699",
"email": "SVCMNGR1422@PEPBOYS.COM"
},
{
"store": "1423",
"name": "CELEBRATION",
"address": "70 BLAKE DR",
"city": "CELEBRATION",
"state": "FL",
"zip": "34747",
"phone": "3219392581",
"email": "SVCMNGR1423@PEPBOYS.COM"
},
{
"store": "1424",
"name": "EUSTIS",
"address": "15469 US HIGHWAY 441",
"city": "EUSTIS",
"state": "FL",
"zip": "32726",
"phone": "3523572637",
"email": "SVCMNGR1424@PEPBOYS.COM"
},
{
"store": "1429",
"name": "WHITLOCK",
"address": "1008 WHITLOCK AVE",
"city": "MARIETTA",
"state": "GA",
"zip": "30064",
"phone": "7704285524",
"email": "SVCMNGR1429@PEPBOYS.COM"
},
{
"store": "1431",
"name": "BURBANK",
"address": "3514 W. BURBANK BLVD",
"city": "BURBANK",
"state": "CA",
"zip": "91505",
"phone": "8188400745",
"email": "SVCMNGR1431@PEPBOYS.COM"
},
{
"store": "1433",
"name": "DELAND",
"address": "2835 S. WOODLAND BLVD",
"city": "DELAND",
"state": "FL",
"zip": "32720",
"phone": "3869439299",
"email": "SVCMNGR1433@PEPBOYS.COM"
},
{
"store": "1434",
"name": "FOREST CITY",
"address": "710 W. HIGHWAY 436",
"city": "ALTAMONTE SPRINGS",
"state": "FL",
"zip": "32714",
"phone": "4077746830",
"email": "SVCMNGR1434@PEPBOYS.COM"
},
{
"store": "1435",
"name": "LONGWOOD",
"address": "100 S. HIGHWAY 17-92",
"city": "LONGWOOD",
"state": "FL",
"zip": "32750",
"phone": "4073394611",
"email": "SVCMNGR1435@PEPBOYS.COM"
},
{
"store": "1436",
"name": "ORMOND BEACH",
"address": "234 WEST GRANADA BLVD",
"city": "ORMOND BEACH",
"state": "FL",
"zip": "32174",
"phone": "3866775037",
"email": "SVCMNGR1436@PEPBOYS.COM"
},
{
"store": "1437",
"name": "RADIO ROAD",
"address": "10209 HIGHWAY 441",
"city": "LEESBURG",
"state": "FL",
"zip": "34788",
"phone": "3523146913",
"email": "SVCMNGR1437@PEPBOYS.COM"
},
{
"store": "1438",
"name": "BEAR VALLEY",
"address": "16349 BEAR VALLEY RD",
"city": "HESPERIA",
"state": "CA",
"zip": "92345",
"phone": "7609492430",
"email": "SVCMNGR1438@PEPBOYS.COM"
},
{
"store": "1439",
"name": "FOOTHILL BLVD.",
"address": "340 E. FOOTHILL BLVD",
"city": "POMONA",
"state": "CA",
"zip": "91767",
"phone": "9093921038",
"email": "SVCMNGR1439@PEPBOYS.COM"
},
{
"store": "1447",
"name": "CLEARWATER",
"address": "29889 US 19 NORTH",
"city": "CLEARWATER",
"state": "FL",
"zip": "33761",
"phone": "7277852803",
"email": "SVCMNGR1447@PEPBOYS.COM"
},
{
"store": "1450",
"name": "BETHLEHEM",
"address": "1610 STEFKO BLVD",
"city": "BETHLEHEM",
"state": "PA",
"zip": "18017",
"phone": "6108682108",
"email": "SVCMNGR1450@PEPBOYS.COM"
},
{
"store": "1454",
"name": "SPRING VALLEY",
"address": "8888 JAMACHA BLVD",
"city": "SPRING VALLEY",
"state": "CA",
"zip": "91977",
"phone": "6194640406",
"email": "SVCMNGR1454@PEPBOYS.COM"
},
{
"store": "1455",
"name": "ANAHEIM",
"address": "2312 E. LINCOLN AVE",
"city": "ANAHEIM",
"state": "CA",
"zip": "92806",
"phone": "7145333469",
"email": "SVCMNGR1455@PEPBOYS.COM"
},
{
"store": "1460",
"name": "BRIDGEVILLE",
"address": "1193 WASHINGTON PIKE",
"city": "BRIDGEVILLE",
"state": "PA",
"zip": "15017",
"phone": "4122572817",
"email": "SVCMNGR1460@PEPBOYS.COM"
},
{
"store": "1462",
"name": "LOCKPORT",
"address": "5658 S. TRANSIT RD",
"city": "LOCKPORT",
"state": "NY",
"zip": "14094",
"phone": "7164336905",
"email": "SVCMNGR1462@PEPBOYS.COM"
},
{
"store": "1463",
"name": "WILLIAMSTOWN",
"address": "1074 N. BLACK HORSE PIKE",
"city": "WILLIAMSTOWN",
"state": "NJ",
"zip": "08094",
"phone": "8567400965",
"email": "SVCMNGR1463@PEPBOYS.COM"
},
{
"store": "1465",
"name": "NILES",
"address": "9643 1/2 NORTH MILWAUKEE",
"city": "NILES",
"state": "IL",
"zip": "60714",
"phone": "8475830287",
"email": "SVCMNGR1465@PEPBOYS.COM"
},
{
"store": "1466",
"name": "DARIEN",
"address": "6818 SOUTH KINGERY HWY",
"city": "DARIEN",
"state": "IL",
"zip": "60561",
"phone": "6304552439",
"email": "SVCMNGR1466@PEPBOYS.COM"
},
{
"store": "1468",
"name": "LODI",
"address": "145 US 46 WEST",
"city": "LODI",
"state": "NJ",
"zip": "07644",
"phone": "9737731618",
"email": "SVCMNGR1468@PEPBOYS.COM"
},
{
"store": "1469",
"name": "WEST SENECA",
"address": "1881 RIDGE RD",
"city": "WEST SENECA",
"state": "NY",
"zip": "14224",
"phone": "7166740490",
"email": "SVCMNGR1469@PEPBOYS.COM"
},
{
"store": "1478",
"name": "MIDLOTHIAN TURNPIKE",
"address": "10040 MIDLOTHIAN TURNPIKE",
"city": "RICHMOND",
"state": "VA",
"zip": "23235",
"phone": "8042721107",
"email": "SVCMNGR1478@PEPBOYS.COM"
},
{
"store": "1479",
"name": "POMPTON PLAINS",
"address": "711 ROUTE 23",
"city": "POMPTON PLAINS",
"state": "NJ",
"zip": "07444",
"phone": "9738391218",
"email": "SVCMNGR1479@PEPBOYS.COM"
},
{
"store": "1480",
"name": "BRENTWOOD",
"address": "1846 5TH AVENUE",
"city": "BAY SHORE",
"state": "NY",
"zip": "11717",
"phone": "6319528724",
"email": "SVCMNGR1480@PEPBOYS.COM"
},
{
"store": "1481",
"name": "ATASCOCITA",
"address": "7432 FM 1960 RD EAST",
"city": "HUMBLE",
"state": "TX",
"zip": "77346",
"phone": "2818128811",
"email": "SVCMNGR1481@PEPBOYS.COM"
},
{
"store": "1484",
"name": "GREEN TRAILS",
"address": "845 S. FRY RD",
"city": "KATY",
"state": "TX",
"zip": "77450",
"phone": "2816476666",
"email": "SVCMNGR1484@PEPBOYS.COM"
},
{
"store": "1485",
"name": "JONES ROAD",
"address": "9105 JONES RD",
"city": "HOUSTON",
"state": "TX",
"zip": "77065",
"phone": "2819709100",
"email": "SVCMNGR1485@PEPBOYS.COM"
},
{
"store": "1486",
"name": "KINGWOOD",
"address": "2408 NORTHPARK DR",
"city": "KINGWOOD",
"state": "TX",
"zip": "77339",
"phone": "2813592040",
"email": "SVCMNGR1486@PEPBOYS.COM"
},
{
"store": "1487",
"name": "WEST U.",
"address": "4141 GREENBRIAR  ST",
"city": "HOUSTON",
"state": "TX",
"zip": "77098",
"phone": "7135288811",
"email": "SVCMNGR1487@PEPBOYS.COM"
},
{
"store": "1488",
"name": "MIDWAY",
"address": "4800 KIRKWOOD HWY",
"city": "WILMINGTON",
"state": "DE",
"zip": "19808",
"phone": "3029955497",
"email": "SVCMNGR1488@PEPBOYS.COM"
},
{
"store": "1489",
"name": "BAYMEADOWS",
"address": "8397 BAYMEADOWS RD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32256",
"phone": "9044485042",
"email": "SVCMNGR1489@PEPBOYS.COM"
},
{
"store": "1493",
"name": "YUCAIPA",
"address": "33133 YUCAIPA BLVD",
"city": "YUCAIPA",
"state": "CA",
"zip": "92399",
"phone": "9097906841",
"email": "SVCMNGR1493@PEPBOYS.COM"
},
{
"store": "1495",
"name": "GULF BREEZE",
"address": "3113 GULF BREEZE PKWY",
"city": "GULF BREEZE",
"state": "FL",
"zip": "32563",
"phone": "8509326425",
"email": "SVCMNGR1495@PEPBOYS.COM"
},
{
"store": "1496",
"name": "SEMORAN BOULEVARD",
"address": "4400 S. SEMORAN BLVD",
"city": "ORLANDO",
"state": "FL",
"zip": "32822",
"phone": "4073818537",
"email": "SVCMNGR1496@PEPBOYS.COM"
},
{
"store": "1497",
"name": "NORTH MILWAUKEE",
"address": "4164 NORTH MILWAUKEE AVE",
"city": "CHICAGO",
"state": "IL",
"zip": "60641",
"phone": "7736851477",
"email": "SVCMNGR1497@PEPBOYS.COM"
},
{
"store": "1498",
"name": "PALATINE",
"address": "315 WEST NORTHWEST HWY",
"city": "PALATINE",
"state": "IL",
"zip": "60067",
"phone": "8473593007",
"email": "SVCMNGR1498@PEPBOYS.COM"
},
{
"store": "1499",
"name": "BLACKWOOD",
"address": "1501 BLACKWOOD-CLEMENTON",
"city": "BLACKWOOD",
"state": "NJ",
"zip": "08012",
"phone": "8562282786",
"email": "SVCMNGR1499@PEPBOYS.COM"
},
{
"store": "1516",
"name": "MITCHELL HAMMOCK ROAD",
"address": "907 SOUTH LAKE JESSUP AVE",
"city": "OVIEDO",
"state": "FL",
"zip": "32765",
"phone": "4073660202",
"email": "SVCMNGR1516@PEPBOYS.COM"
},
{
"store": "1518",
"name": "UNION PARK",
"address": "10306 E COLONIAL DR",
"city": "UNION PARK",
"state": "FL",
"zip": "32817",
"phone": "4072823155",
"email": "SVCMNGR1518@PEPBOYS.COM"
},
{
"store": "1519",
"name": "ST. CLOUD",
"address": "4561 13TH STREET",
"city": "ST CLOUD",
"state": "FL",
"zip": "34769",
"phone": "4078913661",
"email": "SVCMNGR1519@PEPBOYS.COM"
},
{
"store": "1520",
"name": "LB MCLEOD ROAD",
"address": "5546 LB MCLEOD RD",
"city": "ORLANDO",
"state": "FL",
"zip": "32811",
"phone": "4072952658",
"email": "SVCMNGR1520@PEPBOYS.COM"
},
{
"store": "1521",
"name": "ST. JOSEPHS",
"address": "4170 WEST STATE ROAD 46",
"city": "SANFORD",
"state": "FL",
"zip": "32771",
"phone": "4073229896",
"email": "SVCMNGR1521@PEPBOYS.COM"
},
{
"store": "1522",
"name": "WOODLAND LAKES DRIVE",
"address": "420 WOODLAND LAKES DR",
"city": "ORLANDO",
"state": "FL",
"zip": "32828",
"phone": "4072071750",
"email": "SVCMNGR1522@PEPBOYS.COM"
},
{
"store": "1523",
"name": "MONROE STREET",
"address": "2525 NORTH MONROE ST",
"city": "TALLAHASSEE",
"state": "FL",
"zip": "32303",
"phone": "8503855323",
"email": "SVCMNGR1523@PEPBOYS.COM"
},
{
"store": "1524",
"name": "TENNESSEE STREET",
"address": "1425 WEST TENNESSEE ST",
"city": "TALLAHASSEE",
"state": "FL",
"zip": "32304",
"phone": "8502240095",
"email": "SVCMNGR1524@PEPBOYS.COM"
},
{
"store": "1525",
"name": "CAPITAL CIRCLE",
"address": "2237 CAPITAL CIRCLE NE",
"city": "TALLAHASSEE",
"state": "FL",
"zip": "32308",
"phone": "8503854377",
"email": "SVCMNGR1525@PEPBOYS.COM"
},
{
"store": "1526",
"name": "APALACHEE PARKWAY",
"address": "2984 APALACHEE PKWY",
"city": "TALLAHASSEE",
"state": "FL",
"zip": "32301",
"phone": "8506561024",
"email": "SVCMNGR1526@PEPBOYS.COM"
},
{
"store": "1527",
"name": "CALLAWAY",
"address": "161 N TYNDALL PKWY",
"city": "CALLAWAY",
"state": "FL",
"zip": "32404",
"phone": "8507690261",
"email": "SVCMNGR1527@PEPBOYS.COM"
},
{
"store": "1528",
"name": "23RD & BREEZY",
"address": "712 W 23RD ST",
"city": "PANAMA CITY",
"state": "FL",
"zip": "32405",
"phone": "8507637936",
"email": "SVCMNGR1528@PEPBOYS.COM"
},
{
"store": "1529",
"name": "PANAMA CITY BEACH",
"address": "8113 FRONT BEACH RD",
"city": "PANAMA CITY BEACH",
"state": "FL",
"zip": "32407",
"phone": "8502367585",
"email": "SVCMNGR1529@PEPBOYS.COM"
},
{
"store": "1530",
"name": "OCEAN CITY",
"address": "311 NE RACETRACK RD",
"city": "FORT WALTON BEACH",
"state": "FL",
"zip": "32547",
"phone": "8508631102",
"email": "SVCMNGR1530@PEPBOYS.COM"
},
{
"store": "1531",
"name": "DESTIN",
"address": "35800 EMERALD COAST PKWY",
"city": "DESTIN",
"state": "FL",
"zip": "32541",
"phone": "8506501575",
"email": "SVCMNGR1531@PEPBOYS.COM"
},
{
"store": "1532",
"name": "FORT WALTON BEACH",
"address": "15 W MIRACLE STRIP PKWY",
"city": "FORT WALTON BEACH",
"state": "FL",
"zip": "32548",
"phone": "8502437632",
"email": "SVCMNGR1532@PEPBOYS.COM"
},
{
"store": "1533",
"name": "CRESTVIEW",
"address": "883 N FERDON BLVD",
"city": "CRESTVIEW",
"state": "FL",
"zip": "32536",
"phone": "8506891550",
"email": "SVCMNGR1533@PEPBOYS.COM"
},
{
"store": "1534",
"name": "WRIGHT",
"address": "705 NORTH BEAL ST",
"city": "FORT WALTON BEACH",
"state": "FL",
"zip": "32547",
"phone": "8508622164",
"email": "SVCMNGR1534@PEPBOYS.COM"
},
{
"store": "1535",
"name": "NICEVILLE",
"address": "796 JOHN SIMS PKWY",
"city": "NICEVILLE",
"state": "FL",
"zip": "32578",
"phone": "8506780887",
"email": "SVCMNGR1535@PEPBOYS.COM"
},
{
"store": "1536",
"name": "ENSLEY",
"address": "317 E NINE MILE RD",
"city": "PENSACOLA",
"state": "FL",
"zip": "32514",
"phone": "8504766530",
"email": "SVCMNGR1536@PEPBOYS.COM"
},
{
"store": "1537",
"name": "NEW WARRINGTON",
"address": "549 NEW WARRINGTON RD",
"city": "PENSACOLA",
"state": "FL",
"zip": "32506",
"phone": "8504551305",
"email": "SVCMNGR1537@PEPBOYS.COM"
},
{
"store": "1538",
"name": "CERVANTES",
"address": "300 E CERVANTES ST",
"city": "PENSACOLA",
"state": "FL",
"zip": "32501",
"phone": "8504335471",
"email": "SVCMNGR1538@PEPBOYS.COM"
},
{
"store": "1539",
"name": "MILTON",
"address": "6611 CAROLINE ST",
"city": "MILTON",
"state": "FL",
"zip": "32570",
"phone": "8506234377",
"email": "SVCMNGR1539@PEPBOYS.COM"
},
{
"store": "1541",
"name": "PACE",
"address": "4128 HWY. 90",
"city": "PACE",
"state": "FL",
"zip": "32571",
"phone": "8509940777",
"email": "SVCMNGR1541@PEPBOYS.COM"
},
{
"store": "1544",
"name": "ORANGE BEACH",
"address": "25770 CANAL RD",
"city": "ORANGE BEACH",
"state": "AL",
"zip": "36561",
"phone": "2519812060",
"email": "SVCMNGR1544@PEPBOYS.COM"
},
{
"store": "1545",
"name": "9TH & TIPPIN",
"address": "6389 NORTH 9TH AVE",
"city": "PENSACOLA",
"state": "FL",
"zip": "32504",
"phone": "8504770330",
"email": "SVCMNGR1545@PEPBOYS.COM"
},
{
"store": "1546",
"name": "AIRPORT & SCHILLINGER",
"address": "7756 AIRPORT BLVD",
"city": "MOBILE",
"state": "AL",
"zip": "36608",
"phone": "2516399680",
"email": "SVCMNGR1546@PEPBOYS.COM"
},
{
"store": "1547",
"name": "SARALAND",
"address": "821 HIGHWAY 43 S",
"city": "SARALAND",
"state": "AL",
"zip": "36571",
"phone": "2516752171",
"email": "SVCMNGR1547@PEPBOYS.COM"
},
{
"store": "1548",
"name": "AIRPORT & GENERAL BULLARD",
"address": "4700 AIRPORT BLVD",
"city": "MOBILE",
"state": "AL",
"zip": "36608",
"phone": "2513431430",
"email": "SVCMNGR1548@PEPBOYS.COM"
},
{
"store": "1549",
"name": "DAPHNE",
"address": "2112 HIGHWAY 98",
"city": "DAPHNE",
"state": "AL",
"zip": "36526",
"phone": "2516211712",
"email": "SVCMNGR1549@PEPBOYS.COM"
},
{
"store": "1550",
"name": "FOLEY",
"address": "1327 S MCKENZIE ST",
"city": "FOLEY",
"state": "AL",
"zip": "36535",
"phone": "2519711212",
"email": "SVCMNGR1550@PEPBOYS.COM"
},
{
"store": "1551",
"name": "TILLMANS CORNER",
"address": "5335 HIGHWAY WAY 90 WEST",
"city": "MOBILE",
"state": "AL",
"zip": "36619",
"phone": "2516617974",
"email": "SVCMNGR1551@PEPBOYS.COM"
},
{
"store": "1553",
"name": "JONESBORO",
"address": "8015 TARA BLVD",
"city": "JONESBORO",
"state": "GA",
"zip": "30236",
"phone": "7704739930",
"email": "SVCMNGR1553@PEPBOYS.COM"
},
{
"store": "1554",
"name": "MCDONOUGH HWY",
"address": "1717 HWY 20",
"city": "CONYERS",
"state": "GA",
"zip": "30013",
"phone": "7703889267",
"email": "SVCMNGR1554@PEPBOYS.COM"
},
{
"store": "1556",
"name": "ALPHARETTA",
"address": "11845 ALPHARETTA HWY",
"city": "ROSWELL",
"state": "GA",
"zip": "30076",
"phone": "7706648473",
"email": "SVCMNGR1556@PEPBOYS.COM"
},
{
"store": "1557",
"name": "HAMMOND DRIVE",
"address": "224 HAMMOND DR",
"city": "SANDY SPRINGS",
"state": "GA",
"zip": "30328",
"phone": "4042564195",
"email": "SVCMNGR1557@PEPBOYS.COM"
},
{
"store": "1558",
"name": "HIRAM",
"address": "4569 JIMMY LEE SMITH PKWY",
"city": "HIRAM",
"state": "GA",
"zip": "30141",
"phone": "7702225054",
"email": "SVCMNGR1558@PEPBOYS.COM"
},
{
"store": "1559",
"name": "MCDONOUGH",
"address": "325 JONESBORO RD",
"city": "MCDONOUGH",
"state": "GA",
"zip": "30253",
"phone": "6784326339",
"email": "SVCMNGR1559@PEPBOYS.COM"
},
{
"store": "1561",
"name": "HWY 78 & PAXTON DRIVE",
"address": "4125 HIGHWAY 78",
"city": "LILBURN",
"state": "GA",
"zip": "30047",
"phone": "7709790308",
"email": "SVCMNGR1561@PEPBOYS.COM"
},
{
"store": "1562",
"name": "PEACHTREE ROAD",
"address": "3884 PEACHTREE RD NE",
"city": "ATLANTA",
"state": "GA",
"zip": "30319",
"phone": "4048166655",
"email": "SVCMNGR1562@PEPBOYS.COM"
},
{
"store": "1563",
"name": "PEACHTREE CITY",
"address": "1120 CROSSTOWN CT",
"city": "PEACHTREE CITY",
"state": "GA",
"zip": "30269",
"phone": "7704875923",
"email": "SVCMNGR1563@PEPBOYS.COM"
},
{
"store": "1564",
"name": "MACLAND CROSSING",
"address": "2045 MACLAND CROSSING CIR",
"city": "MARIETTA",
"state": "GA",
"zip": "30008",
"phone": "7707943265",
"email": "SVCMNGR1564@PEPBOYS.COM"
},
{
"store": "1565",
"name": "SALEM ROAD",
"address": "2500 SALEM RD",
"city": "CONYERS",
"state": "GA",
"zip": "30013",
"phone": "7704831280",
"email": "SVCMNGR1565@PEPBOYS.COM"
},
{
"store": "1566",
"name": "MONROE",
"address": "2035 WEST SPRING ST",
"city": "MONROE",
"state": "GA",
"zip": "30655",
"phone": "7702075650",
"email": "SVCMNGR1566@PEPBOYS.COM"
},
{
"store": "1567",
"name": "STOCKBRIDGE",
"address": "5270 NORTH HENRY BLVD",
"city": "STOCKBRIDGE",
"state": "GA",
"zip": "30281",
"phone": "7703897318",
"email": "SVCMNGR1567@PEPBOYS.COM"
},
{
"store": "1568",
"name": "DOGWOOD ROAD",
"address": "883 DOGWOOD RD",
"city": "LAWRENCEVILLE",
"state": "GA",
"zip": "30044",
"phone": "7709852264",
"email": "SVCMNGR1568@PEPBOYS.COM"
},
{
"store": "1569",
"name": "DOUGLASVILLE",
"address": "6942 DOUGLAS BLVD",
"city": "DOUGLASVILLE",
"state": "GA",
"zip": "30135",
"phone": "7708521500",
"email": "SVCMNGR1569@PEPBOYS.COM"
},
{
"store": "1570",
"name": "KENNESAW",
"address": "2773 COBB PKWY NW",
"city": "KENNESAW",
"state": "GA",
"zip": "30152",
"phone": "7704239019",
"email": "SVCMNGR1570@PEPBOYS.COM"
},
{
"store": "1571",
"name": "ALPHARETTA MIDWAY",
"address": "4960 ATLANTA HWY",
"city": "ALPHARETTA",
"state": "GA",
"zip": "30004",
"phone": "6783190271",
"email": "SVCMNGR1571@PEPBOYS.COM"
},
{
"store": "1572",
"name": "PHENIX CITY",
"address": "5 ASHWOOD DR",
"city": "PHENIX CITY",
"state": "AL",
"zip": "36867",
"phone": "3342910813",
"email": "SVCMNGR1572@PEPBOYS.COM"
},
{
"store": "1573",
"name": "WHITTLESEY BLVD",
"address": "6437 WHITTLESEY BLVD",
"city": "COLUMBUS",
"state": "GA",
"zip": "31909",
"phone": "7066531053",
"email": "SVCMNGR1573@PEPBOYS.COM"
},
{
"store": "1576",
"name": "EASTDALE MALL",
"address": "5706 ATLANTA HWY",
"city": "MONTGOMERY",
"state": "AL",
"zip": "36117",
"phone": "3342777072",
"email": "SVCMNGR1576@PEPBOYS.COM"
},
{
"store": "1577",
"name": "STURBRIDGE",
"address": "3541 MALCOLM DR",
"city": "MONTGOMERY",
"state": "AL",
"zip": "36116",
"phone": "3342133260",
"email": "SVCMNGR1577@PEPBOYS.COM"
},
{
"store": "1578",
"name": "PRATTVILLE",
"address": "1749 E MAIN ST",
"city": "PRATTVILLE",
"state": "AL",
"zip": "36066",
"phone": "3343619608",
"email": "SVCMNGR1578@PEPBOYS.COM"
},
{
"store": "1579",
"name": "ZELDA ROAD",
"address": "2769 ZELDA RD",
"city": "MONTGOMERY",
"state": "AL",
"zip": "36106",
"phone": "3342712278",
"email": "SVCMNGR1579@PEPBOYS.COM"
},
{
"store": "1580",
"name": "PELHAM",
"address": "3318 PELHAM PKWY",
"city": "PELHAM",
"state": "AL",
"zip": "35124",
"phone": "2056636421",
"email": "SVCMNGR1580@PEPBOYS.COM"
},
{
"store": "1582",
"name": "BESSEMER",
"address": "730 ACADEMY DR",
"city": "BESSEMER",
"state": "AL",
"zip": "35022",
"phone": "2054257923",
"email": "SVCMNGR1582@PEPBOYS.COM"
},
{
"store": "1583",
"name": "EDWARDS LAKE ROAD",
"address": "1901 EDWARDS LAKE RD",
"city": "BIRMINGHAM",
"state": "AL",
"zip": "35235",
"phone": "2056613199",
"email": "SVCMNGR1583@PEPBOYS.COM"
},
{
"store": "1584",
"name": "RIVERCHASE GALLERIA",
"address": "3300 GALLERIA CIRCLE",
"city": "HOOVER",
"state": "AL",
"zip": "35244",
"phone": "2056820807",
"email": "SVCMNGR1584@PEPBOYS.COM"
},
{
"store": "1585",
"name": "VESTAVIA HILLS",
"address": "1453 MONTGOMERY HWY",
"city": "VESTAVIA HILLS",
"state": "AL",
"zip": "35216",
"phone": "2058231453",
"email": "SVCMNGR1585@PEPBOYS.COM"
},
{
"store": "1586",
"name": "GARDENDALE",
"address": "1210 DECATUR HWY",
"city": "GARDENDALE",
"state": "AL",
"zip": "35071",
"phone": "2056312344",
"email": "SVCMNGR1586@PEPBOYS.COM"
},
{
"store": "1587",
"name": "HOOVER",
"address": "5489 HIGHWAY 280",
"city": "BIRMINGHAM",
"state": "AL",
"zip": "35242",
"phone": "2054087501",
"email": "SVCMNGR1587@PEPBOYS.COM"
},
{
"store": "1588",
"name": "HUEYTOWN",
"address": "3019 ALLISON BONNETT MEMO",
"city": "HUEYTOWN",
"state": "AL",
"zip": "35023",
"phone": "2057448473",
"email": "SVCMNGR1588@PEPBOYS.COM"
},
{
"store": "1589",
"name": "MCFARLAND BLVD",
"address": "3025 MCFARLAND BLVD",
"city": "TUSCALOOSA",
"state": "AL",
"zip": "35405",
"phone": "2055560934",
"email": "SVCMNGR1589@PEPBOYS.COM"
},
{
"store": "1590",
"name": "SKYLAND BLVD",
"address": "535 SKYLAND BLVD",
"city": "TUSCALOOSA",
"state": "AL",
"zip": "35405",
"phone": "2053453045",
"email": "SVCMNGR1590@PEPBOYS.COM"
},
{
"store": "1591",
"name": "BRANDONTON",
"address": "2301 JORDAN LANE NW",
"city": "HUNTSVILLE",
"state": "AL",
"zip": "35816",
"phone": "2568300240",
"email": "SVCMNGR1591@PEPBOYS.COM"
},
{
"store": "1592",
"name": "MEMORIAL & BEN GILES",
"address": "11114 MEMORIAL PKWY SW",
"city": "HUNTSVILLE",
"state": "AL",
"zip": "35803",
"phone": "2568821276",
"email": "SVCMNGR1592@PEPBOYS.COM"
},
{
"store": "1593",
"name": "MEMORIAL & SHONEY",
"address": "3305 S MEMORIAL PKWY",
"city": "HUNTSVILLE",
"state": "AL",
"zip": "35801",
"phone": "2568813940",
"email": "SVCMNGR1593@PEPBOYS.COM"
},
{
"store": "1594",
"name": "MADISON",
"address": "105 IVORY WAY",
"city": "MADISON",
"state": "AL",
"zip": "35758",
"phone": "2567720250",
"email": "SVCMNGR1594@PEPBOYS.COM"
},
{
"store": "1595",
"name": "DECATUR",
"address": "2330 HIGHWAY 31 SOUTH",
"city": "DECATUR",
"state": "AL",
"zip": "35601",
"phone": "2563505381",
"email": "SVCMNGR1595@PEPBOYS.COM"
},
{
"store": "1596",
"name": "ATHENS",
"address": "1033 US-72",
"city": "ATHENS",
"state": "AL",
"zip": "35611",
"phone": "2562166181",
"email": "SVCMNGR1596@PEPBOYS.COM"
},
{
"store": "1597",
"name": "OPELIKA",
"address": "3904 PEPPERELL PKWY",
"city": "OPELIKA",
"state": "AL",
"zip": "36801",
"phone": "3347410275",
"email": "SVCMNGR1597@PEPBOYS.COM"
},
{
"store": "1598",
"name": "COLLEGE STREET",
"address": "1347 S COLLEGE ST",
"city": "AUBURN",
"state": "AL",
"zip": "36832",
"phone": "3345018969",
"email": "SVCMNGR1598@PEPBOYS.COM"
},
{
"store": "1600",
"name": "ROBERTSDALE",
"address": "21613 HIGHWAY 59",
"city": "ROBERTSDALE",
"state": "AL",
"zip": "36567",
"phone": "2519451435",
"email": "SVCMNGR1600@PEPBOYS.COM"
},
{
"store": "1610",
"name": "PALM BAY",
"address": "2035 PALM BAY ROAD NE",
"city": "PALM BAY",
"state": "FL",
"zip": "32905",
"phone": "3217230280",
"email": "SVCMNGR1610@PEPBOYS.COM"
},
{
"store": "1611",
"name": "MERRITT ISLAND",
"address": "1090 N COURTENAY PKWY",
"city": "MERRITT ISLAND",
"state": "FL",
"zip": "32953",
"phone": "3214539583",
"email": "SVCMNGR1611@PEPBOYS.COM"
},
{
"store": "1612",
"name": "CALDWELL",
"address": "523 BLOOMFIELD AVENUE",
"city": "CALDWELL",
"state": "NJ",
"zip": "07006",
"phone": "9732281493",
"email": "SVCMNGR1612@PEPBOYS.COM"
},
{
"store": "1613",
"name": "OCOEE",
"address": "8805 WEST COLONIAL DR",
"city": "OCOEE",
"state": "FL",
"zip": "34761",
"phone": "4072938634",
"email": "SVCMNGR1613@PEPBOYS.COM"
},
{
"store": "1614",
"name": "ALLISON PARK",
"address": "4966 WILLIAM FLYNN HWY",
"city": "ALLISON PARK",
"state": "PA",
"zip": "15101",
"phone": "7244432600",
"email": "SVCMNGR1614@PEPBOYS.COM"
},
{
"store": "1616",
"name": "PINEBROOK",
"address": "13 US-46",
"city": "PINE BROOK",
"state": "NJ",
"zip": "07058",
"phone": "9732274847",
"email": "SVCMNGR1616@PEPBOYS.COM"
},
{
"store": "1617",
"name": "MALVERN",
"address": "309 LANCASTER AVE",
"city": "MALVERN",
"state": "PA",
"zip": "19355",
"phone": "6108893727",
"email": "SVCMNGR1617@PEPBOYS.COM"
},
{
"store": "1618",
"name": "AURORA KIRK ROAD",
"address": "2945 KIRK ROAD",
"city": "AURORA",
"state": "IL",
"zip": "60502",
"phone": "6308202314",
"email": "SVCMNGR1618@PEPBOYS.COM"
},
{
"store": "1619",
"name": "MULBERRY",
"address": "6820 S. FLORIDA AVENUE",
"city": "LAKELAND",
"state": "FL",
"zip": "33813",
"phone": "8636443420",
"email": "SVCMNGR1619@PEPBOYS.COM"
},
{
"store": "1620",
"name": "GUNN HIGHWAY",
"address": "6022 GUNN HWY",
"city": "TAMPA",
"state": "FL",
"zip": "33625",
"phone": "8139610361",
"email": "SVCMNGR1620@PEPBOYS.COM"
},
{
"store": "1621",
"name": "VETERANS ROAD",
"address": "575 VETERANS ROAD WEST",
"city": "STATEN ISLAND",
"state": "NY",
"zip": "10309",
"phone": "7183565923",
"email": "SVCMNGR1621@PEPBOYS.COM"
},
{
"store": "1623",
"name": "WAKE FOREST",
"address": "935 GATEWAY COMMONS CIRCL",
"city": "WAKE FOREST",
"state": "NC",
"zip": "27587",
"phone": "9195690085",
"email": "SVCMNGR1623@PEPBOYS.COM"
},
{
"store": "1624",
"name": "CHAPEL HILL",
"address": "1510 EAST FRANKLIN STREET",
"city": "CHAPEL HILL",
"state": "NC",
"zip": "27514",
"phone": "9199687716",
"email": "SVCMNGR1624@PEPBOYS.COM"
},
{
"store": "1625",
"name": "CLAYMONT",
"address": "729 PHILADELPHIA PIKE",
"city": "WILMINGTON",
"state": "DE",
"zip": "19809",
"phone": "3027644391",
"email": "SVCMNGR1625@PEPBOYS.COM"
},
{
"store": "1626",
"name": "QUEENS-HILLSIDE AVE",
"address": "13929 HILLSIDE AVE.",
"city": "JAMAICA",
"state": "NY",
"zip": "11435",
"phone": "7185261837",
"email": "SVCMNGR1626@PEPBOYS.COM"
},
{
"store": "1627",
"name": "CLAYTON",
"address": "11999 CLAYTON BLVD",
"city": "CLAYTON",
"state": "NC",
"zip": "27520",
"phone": "9195500003",
"email": "SVCMNGR1627@PEPBOYS.COM"
},
{
"store": "1628",
"name": "ELMHURST",
"address": "4802 QUEENS BLVD",
"city": "WOODSIDE",
"state": "NY",
"zip": "11377",
"phone": "7186515950",
"email": "SVCMNGR1628@PEPBOYS.COM"
},
{
"store": "1629",
"name": "CUMMING",
"address": "1880 BUFORD HWY",
"city": "CUMMING",
"state": "GA",
"zip": "30041",
"phone": "6784556794",
"email": "SVCMNGR1629@PEPBOYS.COM"
},
{
"store": "1630",
"name": "GRIFFIN",
"address": "1300 N. EXPRESSWAY",
"city": "GRIFFIN",
"state": "GA",
"zip": "30223",
"phone": "7702338704",
"email": "SVCMNGR1630@PEPBOYS.COM"
},
{
"store": "1631",
"name": "MIDDLEBURG",
"address": "1716 BLANDING BLVD.",
"city": "MIDDLEBURG",
"state": "FL",
"zip": "32068",
"phone": "9044064758",
"email": "SVCMNGR1631@PEPBOYS.COM"
},
{
"store": "1632",
"name": "RIVERVIEW",
"address": "10119 MCMULLEN ROAD",
"city": "RIVERVIEW",
"state": "FL",
"zip": "33569",
"phone": "8136770950",
"email": "SVCMNGR1632@PEPBOYS.COM"
},
{
"store": "1634",
"name": "VERONA",
"address": "15 POMPTON AVENUE",
"city": "VERONA",
"state": "NJ",
"zip": "07044",
"phone": "9735712102",
"email": "SVCMNGR1634@PEPBOYS.COM"
},
{
"store": "1636",
"name": "PARLIN",
"address": "1072 US HIGHWAY 9 SOUTH",
"city": "PARLIN",
"state": "NJ",
"zip": "08859",
"phone": "7327272057",
"email": "SVCMNGR1636@PEPBOYS.COM"
},
{
"store": "1637",
"name": "MAPLE SHADE",
"address": "598 ROUTE 38 EAST",
"city": "MAPLE SHADE",
"state": "NJ",
"zip": "08052",
"phone": "8562350652",
"email": "SVCMNGR1637@PEPBOYS.COM"
},
{
"store": "1639",
"name": "WOODLAND",
"address": "26030 I-45 N",
"city": "SPRING",
"state": "TX",
"zip": "77386",
"phone": "2812988395",
"email": "SVCMNGR1639@PEPBOYS.COM"
},
{
"store": "1641",
"name": "TITUSVILLE",
"address": "3100 CHENEY HWY",
"city": "TITUSVILLE",
"state": "FL",
"zip": "32780",
"phone": "3212681534",
"email": "SVCMNGR1641@PEPBOYS.COM"
},
{
"store": "1643",
"name": "EASTWOOD VILLAGE",
"address": "1566 MONTCLAIR ROAD",
"city": "BIRMINGHAM",
"state": "AL",
"zip": "35210",
"phone": "2059569871",
"email": "SVCMNGR1643@PEPBOYS.COM"
},
{
"store": "1644",
"name": "I-45 SPRING",
"address": "20220 I-45",
"city": "SPRING",
"state": "TX",
"zip": "77373",
"phone": "2815289370",
"email": "SVCMNGR1644@PEPBOYS.COM"
},
{
"store": "1646",
"name": "TROOPER",
"address": "2647 RIDGE PIKE",
"city": "NORRISTOWN",
"state": "PA",
"zip": "19403",
"phone": "6106301604",
"email": "SVCMNGR1646@PEPBOYS.COM"
},
{
"store": "1648",
"name": "MURTLAND AVENUE",
"address": "190 MURTLAND AVENUE",
"city": "WASHINGTON",
"state": "PA",
"zip": "15301",
"phone": "7242224076",
"email": "SVCMNGR1648@PEPBOYS.COM"
},
{
"store": "1649",
"name": "PINELLAS PARK",
"address": "6492 PARK BLVD",
"city": "PINELLAS PARK",
"state": "FL",
"zip": "33781",
"phone": "7275416154",
"email": "SVCMNGR1649@PEPBOYS.COM"
},
{
"store": "1650",
"name": "GLENSIDE",
"address": "245 S EASTON ROAD",
"city": "GLENSIDE",
"state": "PA",
"zip": "19038",
"phone": "2158843138",
"email": "SVCMNGR1650@PEPBOYS.COM"
},
{
"store": "1651",
"name": "EGGERT PLAZA",
"address": "3195 EGGERT ROAD",
"city": "TONAWANDA",
"state": "NY",
"zip": "14150",
"phone": "7168628213",
"email": "SVCMNGR1651@PEPBOYS.COM"
},
{
"store": "1654",
"name": "ABSECON",
"address": "609 WHITE HORSE PIKE",
"city": "ABSECON",
"state": "NJ",
"zip": "08201",
"phone": "6094848931",
"email": "SVCMNGR1654@PEPBOYS.COM"
},
{
"store": "1655",
"name": "OSCEOLA PARKWAY",
"address": "2708 W. OSCEOLA PARKWAY",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "4075182098",
"email": "SVCMNGR1655@PEPBOYS.COM"
},
{
"store": "1656",
"name": "ORCHARD SQUARE",
"address": "4290 BELLS FERRY ROAD NW",
"city": "KENNESAW",
"state": "GA",
"zip": "30144",
"phone": "7705920811",
"email": "SVCMNGR1656@PEPBOYS.COM"
},
{
"store": "1657",
"name": "JOHNS CREEK",
"address": "10965 JONES BRIDGE ROAD",
"city": "JOHNS CREEK",
"state": "GA",
"zip": "30022",
"phone": "7707401391",
"email": "SVCMNGR1657@PEPBOYS.COM"
},
{
"store": "1658",
"name": "DACULA",
"address": "571 DACULA ROAD",
"city": "DACULA",
"state": "GA",
"zip": "30019",
"phone": "7709955813",
"email": "SVCMNGR1658@PEPBOYS.COM"
},
{
"store": "1659",
"name": "SILVER SPRINGS",
"address": "2170 NE 49TH COURT RD",
"city": "OCALA",
"state": "FL",
"zip": "34470",
"phone": "3526248654",
"email": "SVCMNGR1659@PEPBOYS.COM"
},
{
"store": "1660",
"name": "NEWNAN",
"address": "85 MARKETPLACE DRIVE",
"city": "NEWNAN",
"state": "GA",
"zip": "30265",
"phone": "7703041561",
"email": "SVCMNGR1660@PEPBOYS.COM"
},
{
"store": "1661",
"name": "BAKERSFIELD, ROSEDALE HWY",
"address": "10500 ROSEDALE HWY",
"city": "BAKERSFIELD",
"state": "CA",
"zip": "93312",
"phone": "6615898368",
"email": "SVCMNGR1661@PEPBOYS.COM"
},
{
"store": "1663",
"name": "NEWPORT",
"address": "1950 NEWPORT BLVD",
"city": "COSTA MESA",
"state": "CA",
"zip": "92627",
"phone": "9496453554",
"email": "SVCMNGR1663@PEPBOYS.COM"
},
{
"store": "1664",
"name": "DOWNEY, PARAMOUNT BLVD",
"address": "11432 PARAMOUNT BLVD",
"city": "DOWNEY",
"state": "CA",
"zip": "90241",
"phone": "5626226757",
"email": "SVCMNGR1664@PEPBOYS.COM"
},
{
"store": "1665",
"name": "HOLLYWOOD, FOUNTAIN AVE",
"address": "3904 FOUNTAIN AVE",
"city": "LOS ANGELES",
"state": "CA",
"zip": "90029",
"phone": "3236626401",
"email": "SVCMNGR1665@PEPBOYS.COM"
},
{
"store": "1666",
"name": "LAKEWOOD",
"address": "5453 E DEL AMO BLVD",
"city": "LAKEWOOD",
"state": "CA",
"zip": "90712",
"phone": "5628041436",
"email": "SVCMNGR1666@PEPBOYS.COM"
},
{
"store": "1668",
"name": "CUCAMONGA, TERRA VISTA",
"address": "11788 FOOTHILL BLVD",
"city": "RANCHO CUCAMONGA",
"state": "CA",
"zip": "91730",
"phone": "9094841801",
"email": "SVCMNGR1668@PEPBOYS.COM"
},
{
"store": "1669",
"name": "RIALTO, WEST VALLEY BLVD",
"address": "484 W VALLEY BLVD",
"city": "RIALTO",
"state": "CA",
"zip": "92376",
"phone": "9098773421",
"email": "SVCMNGR1669@PEPBOYS.COM"
},
{
"store": "1672",
"name": "SANTA MONICA",
"address": "2411 PICO BLVD",
"city": "SANTA MONICA",
"state": "CA",
"zip": "90405",
"phone": "3108291534",
"email": "SVCMNGR1672@PEPBOYS.COM"
},
{
"store": "1676",
"name": "TUJUNGA",
"address": "6511 FOOTHILL BLVD",
"city": "TUJUNGA",
"state": "CA",
"zip": "91042",
"phone": "8183538100",
"email": "SVCMNGR1676@PEPBOYS.COM"
},
{
"store": "1679",
"name": "FUQUAY VARINA",
"address": "1516 N MAIN STREET",
"city": "FUQUAY VARINA",
"state": "NC",
"zip": "27526",
"phone": "9195670662",
"email": "SVCMNGR1679@PEPBOYS.COM"
},
{
"store": "1681",
"name": "NEW LENOX",
"address": "631 E LINCOLN HWY",
"city": "NEW LENOX",
"state": "IL",
"zip": "60451",
"phone": "8154624380",
"email": "SVCMNGR1681@PEPBOYS.COM"
},
{
"store": "1682",
"name": "SUWANEE",
"address": "7750 MCGINNIS FERRY ROAD",
"city": "SUWANEE",
"state": "GA",
"zip": "30024",
"phone": "7708133269",
"email": "SVCMNGR1682@PEPBOYS.COM"
},
{
"store": "1684",
"name": "HIGHLAND CREEK",
"address": "8620 ARBOR CREEK DRIVE",
"city": "CHARLOTTE",
"state": "NC",
"zip": "28269",
"phone": "7049925768",
"email": "SVCMNGR1684@PEPBOYS.COM"
},
{
"store": "1685",
"name": "MURRYSVILLE",
"address": "4360 WILLIAM PENN HWY",
"city": "MURRYSVILLE",
"state": "PA",
"zip": "15668",
"phone": "7243872839",
"email": "SVCMNGR1685@PEPBOYS.COM"
},
{
"store": "1686",
"name": "WINTER HAVEN",
"address": "5694 SE CYPRESS GARDENS",
"city": "WINTER HAVEN",
"state": "FL",
"zip": "33884",
"phone": "8633241824",
"email": "SVCMNGR1686@PEPBOYS.COM"
},
{
"store": "1687",
"name": "LAND O'LAKES, LUTZ",
"address": "22545 CATFISH LAKE ROAD",
"city": "LUTZ",
"state": "FL",
"zip": "33549",
"phone": "8139097175",
"email": "SVCMNGR1687@PEPBOYS.COM"
},
{
"store": "1688",
"name": "TRAEMOOR VILLAGE",
"address": "2961 TOWN CENTER DRIVE",
"city": "FAYETTEVILLE",
"state": "NC",
"zip": "28306",
"phone": "9103210318",
"email": "SVCMNGR1688@PEPBOYS.COM"
},
{
"store": "1689",
"name": "FAYETTEVILLE & TEN TEN",
"address": "8100 FAYETTEVILLE RD",
"city": "RALEIGH",
"state": "NC",
"zip": "27603",
"phone": "9196614382",
"email": "SVCMNGR1689@PEPBOYS.COM"
},
{
"store": "1692",
"name": "IRWIN",
"address": "12043 LINCOLN WAY",
"city": "NORTH HUNTINGDON",
"state": "PA",
"zip": "15642",
"phone": "7248631793",
"email": "SVCMNGR1692@PEPBOYS.COM"
},
{
"store": "1693",
"name": "UTICA AVE",
"address": "2015 UTICA AVENUE",
"city": "BROOKLYN",
"state": "NY",
"zip": "11234",
"phone": "7184443549",
"email": "SVCMNGR1693@PEPBOYS.COM"
},
{
"store": "1694",
"name": "AVALON PARK BLVD",
"address": "351 AVALON PARK S BLVD",
"city": "ORLANDO",
"state": "FL",
"zip": "32828",
"phone": "4072074588",
"email": "SVCMNGR1694@PEPBOYS.COM"
},
{
"store": "1695",
"name": "BORDENTOWN",
"address": "45 US 130 N",
"city": "TRENTON",
"state": "NJ",
"zip": "08620",
"phone": "6092982497",
"email": "SVCMNGR1695@PEPBOYS.COM"
},
{
"store": "1696",
"name": "HARRISBURG",
"address": "3616 RUCKUS ROAD",
"city": "HARRISBURG",
"state": "NC",
"zip": "28075",
"phone": "7044552697",
"email": "SVCMNGR1696@PEPBOYS.COM"
},
{
"store": "1697",
"name": "HAINESPORT",
"address": "1386 ROUTE 38",
"city": "HAINESPORT",
"state": "NJ",
"zip": "08036",
"phone": "6092889160",
"email": "SVCMNGR1697@PEPBOYS.COM"
},
{
"store": "1698",
"name": "THE VILLAGES",
"address": "8697 SE 165TH MULBERRY LN",
"city": "THE VILLAGES",
"state": "FL",
"zip": "32162",
"phone": "3522057746",
"email": "SVCMNGR1698@PEPBOYS.COM"
},
{
"store": "1701",
"name": "HOLLY SPRINGS",
"address": "4980 HOLLY SPRINGS PKWY",
"city": "WOODSTOCK",
"state": "GA",
"zip": "30188",
"phone": "7705929497",
"email": "SVCMNGR1701@PEPBOYS.COM"
},
{
"store": "1702",
"name": "SCENIC HIGHWAY",
"address": "845 SCENIC HIGHWAY S",
"city": "LAWRENCEVILLE",
"state": "GA",
"zip": "30046",
"phone": "6784076148",
"email": "SVCMNGR1702@PEPBOYS.COM"
},
{
"store": "1703",
"name": "SPRING HILL",
"address": "14414 SPRING HILL DRIVE",
"city": "SPRING HILL",
"state": "FL",
"zip": "34609",
"phone": "3525448273",
"email": "SVCMNGR1703@PEPBOYS.COM"
},
{
"store": "1710",
"name": "BUSBEE @ WADE GREEN",
"address": "1466 GEORG BUSBEE PKWY NW",
"city": "KENNESAW",
"state": "GA",
"zip": "30144",
"phone": "7704290509",
"email": "SVCMNGR1710@PEPBOYS.COM"
},
{
"store": "1711",
"name": "CARTERSVILLE",
"address": "425 GRASSDALE RD",
"city": "CARTERSVILLE",
"state": "GA",
"zip": "30121",
"phone": "7703348977",
"email": "SVCMNGR1711@PEPBOYS.COM"
},
{
"store": "1712",
"name": "SAN MARCOS",
"address": "868 W SAN MARCOS BLVD",
"city": "SAN MARCOS",
"state": "CA",
"zip": "92069",
"phone": "7605913900",
"email": "SVCMNGR1712@PEPBOYS.COM"
},
{
"store": "1715",
"name": "FRISCO",
"address": "9215 WARREN PARKWAY",
"city": "FRISCO",
"state": "TX",
"zip": "75034",
"phone": "4693627645",
"email": "SVCMNGR1715@PEPBOYS.COM"
},
{
"store": "1716",
"name": "N CENTRAL",
"address": "6530 N CENTRAL EXPRESSWAY",
"city": "DALLAS",
"state": "TX",
"zip": "75206",
"phone": "2143610041",
"email": "SVCMNGR1716@PEPBOYS.COM"
},
{
"store": "1717",
"name": "LEMMON",
"address": "4329 LEMMON AVE",
"city": "DALLAS",
"state": "TX",
"zip": "75219",
"phone": "2145228985",
"email": "SVCMNGR1717@PEPBOYS.COM"
},
{
"store": "1722",
"name": "MONTANO",
"address": "4311 MONTANO RD NW",
"city": "ALBUQUERQUE",
"state": "NM",
"zip": "87120",
"phone": "5057928323",
"email": "SVCMNGR1722@PEPBOYS.COM"
},
{
"store": "1731",
"name": "KILLEEN",
"address": "2002 E CENTRAL TX EXPY D",
"city": "KILLEEN",
"state": "TX",
"zip": "76541",
"phone": "2545266628",
"email": "SVCMNGR1731@PEPBOYS.COM"
},
{
"store": "1732",
"name": "WEATHERFORD",
"address": "148 W INTERSTATE 20",
"city": "WEATHERFORD",
"state": "TX",
"zip": "76086",
"phone": "8175949389",
"email": "SVCMNGR1732@PEPBOYS.COM"
},
{
"store": "1749",
"name": "LAKEWOOD",
"address": "7817 W. JEWELL AVE",
"city": "LAKEWOOD",
"state": "CO",
"zip": "80226",
"phone": "3037635454",
"email": "SVCMNGR1749@PEPBOYS.COM"
},
{
"store": "1750",
"name": "PARKER",
"address": "1390 S. PARKER RD",
"city": "DENVER",
"state": "CO",
"zip": "80231",
"phone": "3033372380",
"email": "SVCMNGR1750@PEPBOYS.COM"
},
{
"store": "1752",
"name": "NORTHGLENN",
"address": "920 E 120TH AVENUE",
"city": "NORTHGLENN",
"state": "CO",
"zip": "80233",
"phone": "3034503191",
"email": "SVCMNGR1752@PEPBOYS.COM"
},
{
"store": "1754",
"name": "TEMPE",
"address": "445 W BROADWAY RD",
"city": "TEMPE",
"state": "AZ",
"zip": "85282",
"phone": "4807360113",
"email": "SVCMNGR1754@PEPBOYS.COM"
},
{
"store": "1760",
"name": "ELLSWORTH",
"address": "9249 EAST GUADALUPE RD",
"city": "MESA",
"state": "AZ",
"zip": "85212",
"phone": "4803572191",
"email": "SVCMNGR1760@PEPBOYS.COM"
},
{
"store": "1767",
"name": "PEARLAND",
"address": "1433 E. BROADWAY ST",
"city": "PEARLAND",
"state": "TX",
"zip": "77581",
"phone": "2816482081",
"email": "SVCMNGR1767@PEPBOYS.COM"
},
{
"store": "1768",
"name": "CONROE",
"address": "1103 N LOOP 336 WEST",
"city": "CONROE",
"state": "TX",
"zip": "77301",
"phone": "9364414501",
"email": "SVCMNGR1768@PEPBOYS.COM"
},
{
"store": "1773",
"name": "BAYTOWN",
"address": "3704 GARTH RD",
"city": "BAYTOWN",
"state": "TX",
"zip": "77521",
"phone": "2814256953",
"email": "SVCMNGR1773@PEPBOYS.COM"
},
{
"store": "1784",
"name": "ROANOKE",
"address": "121 E SH 114 HWY",
"city": "ROANOKE",
"state": "TX",
"zip": "76262",
"phone": "8174917380",
"email": "SVCMNGR1784@PEPBOYS.COM"
},
{
"store": "1785",
"name": "NORTH BEACH",
"address": "8665 N. BEACH STREET",
"city": "KELLER",
"state": "TX",
"zip": "76244",
"phone": "8173373005",
"email": "SVCMNGR1785@PEPBOYS.COM"
},
{
"store": "1786",
"name": "LUBBOCK",
"address": "4417 SOUTH LOOP 289",
"city": "LUBBOCK",
"state": "TX",
"zip": "79424",
"phone": "8065774966",
"email": "SVCMNGR1786@PEPBOYS.COM"
},
{
"store": "1787",
"name": "CASTLE ROCK",
"address": "4400 BARRANCA LANE",
"city": "CASTLE ROCK",
"state": "CO",
"zip": "80104",
"phone": "3036630312",
"email": "SVCMNGR1787@PEPBOYS.COM"
},
{
"store": "1790",
"name": "JIMMY CARTER",
"address": "4148 JIMMY CARTER BLVD",
"city": "NORCROSS",
"state": "GA",
"zip": "30093",
"phone": "7704931651",
"email": "SVCMNGR1790@PEPBOYS.COM"
},
{
"store": "1792",
"name": "HOWELL MILL",
"address": "1685 HOWELL MILL ROAD NW",
"city": "ATLANTA",
"state": "GA",
"zip": "30318",
"phone": "4043670101",
"email": "SVCMNGR1792@PEPBOYS.COM"
},
{
"store": "1795",
"name": "CUMBERLAND",
"address": "2653 COBB PKWY SE",
"city": "SMYRNA",
"state": "GA",
"zip": "30080",
"phone": "7709531003",
"email": "SVCMNGR1795@PEPBOYS.COM"
},
{
"store": "1796",
"name": "STONE MOUNTAIN",
"address": "4805 MEMORIAL DR",
"city": "STONE MOUNTAIN",
"state": "GA",
"zip": "30083",
"phone": "4045495321",
"email": "SVCMNGR1796@PEPBOYS.COM"
},
{
"store": "1801",
"name": "PLEASANT HILL",
"address": "1625 PLEASANT HILL RD",
"city": "DULUTH",
"state": "GA",
"zip": "30096",
"phone": "6783804354",
"email": "SVCMNGR1801@PEPBOYS.COM"
},
{
"store": "1802",
"name": "W. HILLSBOROUGH",
"address": "7655 W HILLSBOROUGH AVE",
"city": "TAMPA",
"state": "FL",
"zip": "33615",
"phone": "8132497736",
"email": "SVCMNGR1802@PEPBOYS.COM"
},
{
"store": "1803",
"name": "BRANDON",
"address": "214 E. BRANDON BLVD",
"city": "BRANDON",
"state": "FL",
"zip": "33511",
"phone": "8136553476",
"email": "SVCMNGR1803@PEPBOYS.COM"
},
{
"store": "1804",
"name": "PALM HARBOR",
"address": "35061 US HIGHWAY 19 NORTH",
"city": "PALM HARBOR",
"state": "FL",
"zip": "34684",
"phone": "7277716216",
"email": "SVCMNGR1804@PEPBOYS.COM"
},
{
"store": "1805",
"name": "LARGO",
"address": "13015 SEMINOLE BLVD",
"city": "LARGO",
"state": "FL",
"zip": "33778",
"phone": "7275186476",
"email": "SVCMNGR1805@PEPBOYS.COM"
},
{
"store": "1806",
"name": "GULF TO BAY",
"address": "1559B GULF TO BAY BLVD",
"city": "CLEARWATER",
"state": "FL",
"zip": "33755",
"phone": "7274431194",
"email": "SVCMNGR1806@PEPBOYS.COM"
},
{
"store": "1808",
"name": "BAYSHORE GARDENS",
"address": "6324 14TH STREET WEST",
"city": "BRADENTON",
"state": "FL",
"zip": "34207",
"phone": "9417517519",
"email": "SVCMNGR1808@PEPBOYS.COM"
},
{
"store": "1809",
"name": "BEE RIDGE",
"address": "4427 BEE RIDGE RD",
"city": "SARASOTA",
"state": "FL",
"zip": "34233",
"phone": "9413711377",
"email": "SVCMNGR1809@PEPBOYS.COM"
},
{
"store": "1810",
"name": "BEARSS",
"address": "2304 E. BEARSS AVE",
"city": "TAMPA",
"state": "FL",
"zip": "33613",
"phone": "8138668790",
"email": "SVCMNGR1810@PEPBOYS.COM"
},
{
"store": "1811",
"name": "OCOEE",
"address": "11460 W COLONIAL DRIVE",
"city": "OCOEE",
"state": "FL",
"zip": "34761",
"phone": "4076549847",
"email": "SVCMNGR1811@PEPBOYS.COM"
},
{
"store": "1813",
"name": "CASSELBERRY",
"address": "690 E SEMORAN BLVD",
"city": "CASSELBERRY",
"state": "FL",
"zip": "32707",
"phone": "4076829988",
"email": "SVCMNGR1813@PEPBOYS.COM"
},
{
"store": "1819",
"name": "OCALA",
"address": "2425 NE SILVER SPRNGS BLV",
"city": "OCALA",
"state": "FL",
"zip": "34470",
"phone": "3523683697",
"email": "SVCMNGR1819@PEPBOYS.COM"
},
{
"store": "1820",
"name": "CAPE CORAL",
"address": "1820 S. DEL PRADO BLVD",
"city": "CAPE CORAL",
"state": "FL",
"zip": "33990",
"phone": "2392146911",
"email": "SVCMNGR1820@PEPBOYS.COM"
},
{
"store": "1822",
"name": "NEW PORT RICHEY",
"address": "9208 US HWY 19 N",
"city": "PORT RICHEY",
"state": "FL",
"zip": "34668",
"phone": "7276194854",
"email": "SVCMNGR1822@PEPBOYS.COM"
},
{
"store": "1823",
"name": "N. DALE MABRY",
"address": "8705 N. DALE MABRY",
"city": "TAMPA",
"state": "FL",
"zip": "33614",
"phone": "8133363330",
"email": "SVCMNGR1823@PEPBOYS.COM"
},
{
"store": "1824",
"name": "JACKSONVILLE",
"address": "1300 NORTH 3RD STREET",
"city": "JACKSONVILLE BEACH",
"state": "FL",
"zip": "32250",
"phone": "9047588649",
"email": "SVCMNGR1824@PEPBOYS.COM"
},
{
"store": "1826",
"name": "DELAND",
"address": "722 S WOODLAND BLVD",
"city": "DELAND",
"state": "FL",
"zip": "32720",
"phone": "3863373530",
"email": "SVCMNGR1826@PEPBOYS.COM"
},
{
"store": "1828",
"name": "HOBE SOUND",
"address": "11350 SE FEDERAL HWY",
"city": "HOBE SOUND",
"state": "FL",
"zip": "33455",
"phone": "7725462195",
"email": "SVCMNGR1828@PEPBOYS.COM"
},
{
"store": "1832",
"name": "HORIZON",
"address": "750 E. HORIZON DRIVE",
"city": "HENDERSON",
"state": "NV",
"zip": "89015",
"phone": "7025316882",
"email": "SVCMNGR1832@PEPBOYS.COM"
},
{
"store": "1833",
"name": "NELLIS",
"address": "774 N. NELLIS BLVD",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89110",
"phone": "7028384335",
"email": "SVCMNGR1833@PEPBOYS.COM"
},
{
"store": "1835",
"name": "STEPHANIE",
"address": "140 S STEPHANIE ST",
"city": "HENDERSON",
"state": "NV",
"zip": "89012",
"phone": "7023829988",
"email": "SVCMNGR1835@PEPBOYS.COM"
},
{
"store": "1836",
"name": "SIMMONS",
"address": "5690 SIMMONS RD",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89031",
"phone": "7022270557",
"email": "SVCMNGR1836@PEPBOYS.COM"
},
{
"store": "1837",
"name": "WARM SPRINGS",
"address": "7465 S. EASTERN AVE",
"city": "LAS VEGAS",
"state": "NV",
"zip": "89123",
"phone": "7026148381",
"email": "SVCMNGR1837@PEPBOYS.COM"
},
{
"store": "1845",
"name": "281 NORTH",
"address": "26676 US HWY 281 N",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78260",
"phone": "8309809002",
"email": "SVCMNGR1845@PEPBOYS.COM"
},
{
"store": "1847",
"name": "MILITARY HWY",
"address": "14335 NW MILITARY HWY",
"city": "SHAVANO PARK",
"state": "TX",
"zip": "78231",
"phone": "2107641260",
"email": "SVCMNGR1847@PEPBOYS.COM"
},
{
"store": "1848",
"name": "THOUSAND OAKS",
"address": "3102 THOUSAND OAKS",
"city": "SAN ANTONIO",
"state": "TX",
"zip": "78247",
"phone": "2104025340",
"email": "SVCMNGR1848@PEPBOYS.COM"
},
{
"store": "6392",
"name": "COLLIERVILLE",
"address": "1120 W. POPLAR AVE",
"city": "COLLIERVILLE",
"state": "TN",
"zip": "38017",
"phone": "9018531593",
"email": "SVCMNGR6392@PEPBOYS.COM"
},
{
"store": "6393",
"name": "PARK AVE",
"address": "5115 PARK AVE",
"city": "MEMPHIS",
"state": "TN",
"zip": "38117",
"phone": "9017679054",
"email": "SVCMNGR6393@PEPBOYS.COM"
},
{
"store": "6394",
"name": "E. STATELINE",
"address": "301 STATLINE RD W",
"city": "SOUTHAVEN",
"state": "MS",
"zip": "38671",
"phone": "6623426021",
"email": "SVCMNGR6394@PEPBOYS.COM"
},
{
"store": "6395",
"name": "WOLFCHASE",
"address": "8529 US-64",
"city": "MEMPHIS",
"state": "TN",
"zip": "38133",
"phone": "9013809115",
"email": "SVCMNGR6395@PEPBOYS.COM"
},
{
"store": "6396",
"name": "E. SHELBY",
"address": "6791 E. SHELBY DRIVE",
"city": "MEMPHIS",
"state": "TN",
"zip": "38141",
"phone": "9013654701",
"email": "SVCMNGR6396@PEPBOYS.COM"
},
{
"store": "6397",
"name": "OLIVE BRANCH",
"address": "7071 COMMERCE DRIVE",
"city": "OLIVE BRANCH",
"state": "MS",
"zip": "38654",
"phone": "6628903444",
"email": "SVCMNGR6397@PEPBOYS.COM"
},
{
"store": "6398",
"name": "SOUTHAVEN",
"address": "1394 E. GOODMAN ROAD",
"city": "SOUTHAVEN",
"state": "MS",
"zip": "38671",
"phone": "6625361727",
"email": "SVCMNGR6398@PEPBOYS.COM"
},
{
"store": "6399",
"name": "BARTLETT CENTER",
"address": "5975 BARTLETT CENTER DR",
"city": "BARTLETT",
"state": "TN",
"zip": "38134",
"phone": "9013736265",
"email": "SVCMNGR6399@PEPBOYS.COM"
},
{
"store": "6401",
"name": "FRANKLIN SQUARE",
"address": "195 NEW HYDE PARK ROAD",
"city": "FRANKLIN SQUARE",
"state": "NY",
"zip": "11010",
"phone": "5163549411",
"email": "SVCMNGR6401@PEPBOYS.COM"
},
{
"store": "6402",
"name": "POPLAR AVE",
"address": "2516 POPLAR AVE",
"city": "MEMPHIS",
"state": "TN",
"zip": "38112",
"phone": "9013277328",
"email": "SVCMNGR6402@PEPBOYS.COM"
},
{
"store": "6405",
"name": "SOUTHINGTON",
"address": "1217 QUEEN STREET",
"city": "SOUTHINGTON",
"state": "CT",
"zip": "06489",
"phone": "8607930505",
"email": "SVCMNGR6405@PEPBOYS.COM"
},
{
"store": "6406",
"name": "MONTAUK",
"address": "222 MONTAUK HIGHWAY",
"city": "LINDENHURST",
"state": "NY",
"zip": "11757",
"phone": "6312252932",
"email": "SVCMNGR6406@PEPBOYS.COM"
},
{
"store": "6446",
"name": "EVERETT",
"address": "531 128TH STREET SW",
"city": "EVERETT",
"state": "WA",
"zip": "98204",
"phone": "4253484270",
"email": "SVCMNGR6446@PEPBOYS.COM"
},
{
"store": "6447",
"name": "KENT",
"address": "25923 104TH AVE SE",
"city": "KENT",
"state": "WA",
"zip": "98030",
"phone": "2533731500",
"email": "SVCMNGR6447@PEPBOYS.COM"
},
{
"store": "6448",
"name": "MT. VERNON",
"address": "1621 RIVERSIDE DRIVE",
"city": "MT. VERNON",
"state": "WA",
"zip": "98273",
"phone": "3604282711",
"email": "SVCMNGR6448@PEPBOYS.COM"
},
{
"store": "6449",
"name": "BALLARD",
"address": "5601 15TH AVENUE NW",
"city": "SEATTLE",
"state": "WA",
"zip": "98107",
"phone": "2067834423",
"email": "SVCMNGR6449@PEPBOYS.COM"
},
{
"store": "6451",
"name": "SODO",
"address": "1961 4TH AVE S",
"city": "SEATTLE",
"state": "WA",
"zip": "98134",
"phone": "2064472700",
"email": "SVCMNGR6451@PEPBOYS.COM"
},
{
"store": "6453",
"name": "WOODINVILLE",
"address": "13018 NE 175TH ST",
"city": "WOODINVILLE",
"state": "WA",
"zip": "98072",
"phone": "4254818211",
"email": "SVCMNGR6453@PEPBOYS.COM"
},
{
"store": "6455",
"name": "85TH STREET",
"address": "12856 NE 85TH ST",
"city": "KIRKLAND",
"state": "WA",
"zip": "98033",
"phone": "4258225330",
"email": "SVCMNGR6455@PEPBOYS.COM"
},
{
"store": "6459",
"name": "HASKELL",
"address": "1223 RINGWOOD AVE",
"city": "HASKELL",
"state": "NJ",
"zip": "07420",
"phone": "9738352761",
"email": "SVCMNGR6459@PEPBOYS.COM"
},
{
"store": "6460",
"name": "ORANGE",
"address": "234 SCOTLAND ROAD",
"city": "ORANGE",
"state": "NJ",
"zip": "07050",
"phone": "9736783924",
"email": "SVCMNGR6460@PEPBOYS.COM"
},
{
"store": "6461",
"name": "AUGUSTA",
"address": "3127 WASHINGTON ROAD",
"city": "AUGUSTA",
"state": "GA",
"zip": "30909",
"phone": "7068632540",
"email": "SVCMNGR6461@PEPBOYS.COM"
},
{
"store": "6464",
"name": "CLAWSON",
"address": "1200 W 14 MILES RD",
"city": "CLAWSON",
"state": "MI",
"zip": "48017",
"phone": "2484357070",
"email": "SVCMNGR6464@PEPBOYS.COM"
},
{
"store": "6466",
"name": "E. GREENWAY PARKWAY",
"address": "810 E GREENWAY PARKWAY",
"city": "PHOENIX",
"state": "AZ",
"zip": "85022",
"phone": "6028634411",
"email": "SVCMNGR6466@PEPBOYS.COM"
},
{
"store": "6467",
"name": "N. HIGLEY ROAD",
"address": "1947 W HIGLEY ROAD",
"city": "MESA",
"state": "AZ",
"zip": "85205",
"phone": "4809855400",
"email": "SVCMNGR6467@PEPBOYS.COM"
},
{
"store": "6470",
"name": "E. SAHUARO DRIVE",
"address": "11478 E SAHUARO DR",
"city": "SCOTTSDALE",
"state": "AZ",
"zip": "85259",
"phone": "4804519695",
"email": "SVCMNGR6470@PEPBOYS.COM"
},
{
"store": "6472",
"name": "E. THOMAS ROAD",
"address": "6828 E THOMAS RD",
"city": "SCOTTSDALE",
"state": "AZ",
"zip": "85251",
"phone": "4802907850",
"email": "SVCMNGR6472@PEPBOYS.COM"
},
{
"store": "6474",
"name": "GILBERT",
"address": "1267 E BASELINE RD",
"city": "GILBERT",
"state": "AZ",
"zip": "85233",
"phone": "4808134262",
"email": "SVCMNGR6474@PEPBOYS.COM"
},
{
"store": "6475",
"name": "N. ALMA SCHOOL ROAD",
"address": "2160 N ALMA SCHOOL RD",
"city": "CHANDLER",
"state": "AZ",
"zip": "85224",
"phone": "4808212292",
"email": "SVCMNGR6475@PEPBOYS.COM"
},
{
"store": "6477",
"name": "N. KASPER AVENUE",
"address": "3735 N KASPER DRIVE",
"city": "FLAGSTAFF",
"state": "AZ",
"zip": "86004",
"phone": "9285260556",
"email": "SVCMNGR6477@PEPBOYS.COM"
},
{
"store": "6478",
"name": "PRESCOTT",
"address": "1052 WILLOW CREEK RD",
"city": "PRESCOTT",
"state": "AZ",
"zip": "86301",
"phone": "9284453218",
"email": "SVCMNGR6478@PEPBOYS.COM"
},
{
"store": "6479",
"name": "PRESCOTT VALLEY",
"address": "6801 E FIRST STREET",
"city": "PRESCOTT VALLEY",
"state": "AZ",
"zip": "86314",
"phone": "9287729013",
"email": "SVCMNGR6479@PEPBOYS.COM"
},
{
"store": "6483",
"name": "RANCHO SANTA MARGARITA",
"address": "23071 ANTONIO PARKWAY",
"city": "RANCHO SANTA MARGARITA",
"state": "CA",
"zip": "92688",
"phone": "9494591841",
"email": "SVCMNGR6483@PEPBOYS.COM"
},
{
"store": "6537",
"name": "PINE ISLAND ROAD",
"address": "4397 N PINE ISLAND RD",
"city": "SUNRISE",
"state": "FL",
"zip": "33351",
"phone": "9547413111",
"email": "SVCMNGR6537@PEPBOYS.COM"
},
{
"store": "6539",
"name": "MORRISVILLE",
"address": "9515 CHAPEL HILL RD",
"city": "MORRISVILLE",
"state": "NC",
"zip": "27560",
"phone": "9194669645",
"email": "SVCMNGR6539@PEPBOYS.COM"
},
{
"store": "6540",
"name": "DRACUT",
"address": "1337 LAKEVIEW AVE",
"city": "DRACUT",
"state": "MA",
"zip": "01826",
"phone": "9789576397",
"email": "SVCMNGR6540@PEPBOYS.COM"
},
{
"store": "6560",
"name": "SOUTHWESTERN BLVD",
"address": "5071 SOUTHWESTERN BLVD",
"city": "HAMBURG",
"state": "NY",
"zip": "14075",
"phone": "7166495719",
"email": "SVCMNGR6560@PEPBOYS.COM"
},
{
"store": "6563",
"name": "TROY",
"address": "2245 STEPHENSON HWY",
"city": "TROY",
"state": "MI",
"zip": "48083",
"phone": "2487407878",
"email": "SVCMNGR6563@PEPBOYS.COM"
},
{
"store": "6565",
"name": "AUSTIN",
"address": "11928 RESEARCH BLVD",
"city": "AUSTIN",
"state": "TX",
"zip": "78759",
"phone": "5125068368",
"email": "SVCMNGR6565@PEPBOYS.COM"
},
{
"store": "6566",
"name": "FRANKLIN",
"address": "320 N MORTON ST",
"city": "FRANKLIN",
"state": "IN",
"zip": "46131",
"phone": "3173467788",
"email": "SVCMNGR6566@PEPBOYS.COM"
},
{
"store": "6588",
"name": "MOBILE TRAILER 1",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "6892607729",
"email": "SVCMNGR6588@PEPBOYS.COM"
},
{
"store": "6589",
"name": "MOBILE TRAILER 2",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "6892600997",
"email": "SVCMNGR6589@PEPBOYS.COM"
},
{
"store": "6659",
"name": "MOBILE VAN 1",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "3242000055",
"email": "SVCMNGR6659@PEPBOYS.COM"
},
{
"store": "6660",
"name": "MOBILE VAN 2",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "4074564553",
"email": "SVCMNGR6660@PEPBOYS.COM"
},
{
"store": "6661",
"name": "MOBILE VAN 3",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "4074584266",
"email": "SVCMNGR6661@PEPBOYS.COM"
},
{
"store": "6662",
"name": "MOBILE VAN 4",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "6452076767",
"email": "SVCMNGR6662@PEPBOYS.COM"
},
{
"store": "6663",
"name": "MOBILE VAN 5",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "8136133885",
"email": "SVCMNGR6663@PEPBOYS.COM"
},
{
"store": "6664",
"name": "MOBILE VAN 6",
"address": "302 WEST VINE STREET",
"city": "KISSIMMEE",
"state": "FL",
"zip": "34741",
"phone": "6893493280",
"email": "SVCMNGR6664@PEPBOYS.COM"
},
{
"store": "6591",
"name": "MYSTIC",
"address": "2400 GOLD STAR HWY",
"city": "MYSTIC GROTON",
"state": "CT",
"zip": "06355",
"phone": "8605369235",
"email": "SVCMNGR6591@PEPBOYS.COM"
},
{
"store": "6593",
"name": "LAGRANGE",
"address": "1472 LAFAYETTE PARKWAY",
"city": "LAGRANGE",
"state": "GA",
"zip": "30241",
"phone": "7066169120",
"email": "SVCMNGR6593@PEPBOYS.COM"
},
{
"store": "6595",
"name": "159TH STREET",
"address": "15820 INGLEWOOD AVE",
"city": "LAWNDALE",
"state": "CA",
"zip": "90260",
"phone": "4244086055",
"email": "SVCMNGR6595@PEPBOYS.COM"
},
{
"store": "6608",
"name": "EAGAN",
"address": "1340 DUCKSWOOD DRIVE",
"city": "EAGAN",
"state": "MN",
"zip": "55123",
"phone": "6514547100",
"email": "SVCMNGR6608@PEPBOYS.COM"
},
{
"store": "6621",
"name": "THE AVENUES - RPM",
"address": "9148 PHILLIPS HIGHWAY",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32256",
"phone": "9042609600",
"email": "SVCMNGR6621@PEPBOYS.COM"
},
{
"store": "6622",
"name": "JULINGTON CREEK - RPM",
"address": "12620 SAN JOSE BLVD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32223",
"phone": "9042682044",
"email": "SVCMNGR6622@PEPBOYS.COM"
},
{
"store": "6623",
"name": "SAN MARCO - RPM",
"address": "3726 ST. AUGUSTINE ROAD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32207",
"phone": "9043986982",
"email": "SVCMNGR6623@PEPBOYS.COM"
},
{
"store": "6624",
"name": "ORTEGA - RPM",
"address": "5431 ROOSEVELT BLVD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32210",
"phone": "9043879218",
"email": "SVCMNGR6624@PEPBOYS.COM"
},
{
"store": "6625",
"name": "FLEMING ISLAND - RPM",
"address": "1807 EAST-WEST PARKWAY",
"city": "FLEMING ISLAND",
"state": "FL",
"zip": "32003",
"phone": "9042785252",
"email": "SVCMNGR6625@PEPBOYS.COM"
},
{
"store": "6626",
"name": "THE BEACHES - RPM",
"address": "304 3RD STREET N.",
"city": "JACKSONVILLE BEACH",
"state": "FL",
"zip": "32250",
"phone": "9042495711",
"email": "SVCMNGR6626@PEPBOYS.COM"
},
{
"store": "6627",
"name": "ATLANTIC AT SAN PABLO - RPM",
"address": "13657-1 ATLANTIC BLVD",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32225",
"phone": "9042211100",
"email": "SVCMNGR6627@PEPBOYS.COM"
},
{
"store": "6628",
"name": "RIVER CITY - RPM",
"address": "13131-1 WOLF BAY DRIVE",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32218",
"phone": "9047576600",
"email": "SVCMNGR6628@PEPBOYS.COM"
},
{
"store": "6630",
"name": "ST. JOHNS AT 210 - RPM",
"address": "1605 COUNTY ROAD 210",
"city": "ST. AUGUSTINE",
"state": "FL",
"zip": "32095",
"phone": "9044299575",
"email": "SVCMNGR6630@PEPBOYS.COM"
},
{
"store": "6636",
"name": "RAMSEY",
"address": "755 NJ 17",
"city": "RAMSEY",
"state": "NJ",
"zip": "07446",
"phone": "2013168128",
"email": "SVCMNGR6636@PEPBOYS.COM"
},
{
"store": "6648",
"name": "BILOXI",
"address": "2580 BEACH BLVD",
"city": "BILOXI",
"state": "MS",
"zip": "39531",
"phone": "2282716838",
"email": "SVCMNGR6648@PEPBOYS.COM"
},
{
"store": "6649",
"name": "TIENDA",
"address": "802 AVENIDA CAMPO RICO",
"city": "SAN JUAN",
"state": "PR",
"zip": "00924",
"phone": "7872765630",
"email": "SVCMNGR6649@PEPBOYS.COM"
},
{
"store": "6650",
"name": "CENTRAL",
"address": "1643 AV. JESUS T. PINERO",
"city": "SAN JUAN",
"state": "PR",
"zip": "00921",
"phone": "7877831780",
"email": "SVCMNGR6650@PEPBOYS.COM"
},
{
"store": "6652",
"name": "DORADO",
"address": "DORADO DELMAR SHOPING CTR",
"city": "DORADO",
"state": "PR",
"zip": "00646",
"phone": "7877962829",
"email": "SVCMNGR6652@PEPBOYS.COM"
},
{
"store": "6653",
"name": "CAGUAS",
"address": "16 CALLE AQUAMARINA",
"city": "CAGUAS",
"state": "PR",
"zip": "00725",
"phone": "7877436825",
"email": "SVCMNGR6653@PEPBOYS.COM"
},
{
"store": "6654",
"name": "PONCE",
"address": "458 CALLE FERROCARRIL",
"city": "PONCE",
"state": "PR",
"zip": "00717",
"phone": "7878438088",
"email": "SVCMNGR6654@PEPBOYS.COM"
},
{
"store": "6665",
"name": "FORT BUCHANAN",
"address": "BLDG. 677",
"city": "SAN JUAN",
"state": "PR",
"zip": "00934",
"phone": "7872737731",
"email": "SVCMNGR6665@PEPBOYS.COM"
},
{
"store": "6666",
"name": "FARRAGUT",
"address": "10839 KINGSTON PIKE",
"city": "FARRAGUT",
"state": "TN",
"zip": "37934",
"phone": "8656725464",
"email": "SVCMNGR6666@PEPBOYS.COM"
},
{
"store": "6667",
"name": "RIVER WEST",
"address": "1314 W GRAND AVENUE",
"city": "CHICAGO",
"state": "IL",
"zip": "60642",
"phone": "3127616484",
"email": "SVCMNGR6667@PEPBOYS.COM"
},
{
"store": "6668",
"name": "FORT MILL",
"address": "3073 HWY 160W",
"city": "FORT MILL",
"state": "SC",
"zip": "29708",
"phone": "8036504276",
"email": "SVCMNGR6668@PEPBOYS.COM"
},
{
"store": "6669",
"name": "APEX HIGHWAY",
"address": "4908 NC-55",
"city": "DURHAM",
"state": "NC",
"zip": "27713",
"phone": "9196665898",
"email": "SVCMNGR6669@PEPBOYS.COM"
},
{
"store": "6670",
"name": "CAVE SPRING",
"address": "3830 ELECTRIC ROAD",
"city": "ROANOKE",
"state": "VA",
"zip": "24018",
"phone": "5409459720",
"email": "SVCMNGR6670@PEPBOYS.COM"
},
{
"store": "6672",
"name": "YULEE",
"address": "463801 E STATE ROAD 200",
"city": "YULEE",
"state": "FL",
"zip": "32097",
"phone": "9045579469",
"email": "SVCMNGR6672@PEPBOYS.COM"
},
{
"store": "6673",
"name": "LAKE WYLIE",
"address": "213 SC 274",
"city": "CLOVER",
"state": "SC",
"zip": "29710",
"phone": "8037011036",
"email": "SVCMNGR6673@PEPBOYS.COM"
},
{
"store": "6674",
"name": "CHURCH STREET",
"address": "3609 SHELBYVILLE PIKE",
"city": "MURFREESBORO",
"state": "TN",
"zip": "37127",
"phone": "6292074414",
"email": "SVCMNGR6674@PEPBOYS.COM"
},
{
"store": "6676",
"name": "HACKETTSTOWN",
"address": "34 US 46",
"city": "HACKETTSTOWN",
"state": "NJ",
"zip": "07840",
"phone": "9084529011",
"email": "SVCMNGR6676@PEPBOYS.COM"
},
{
"store": "6677",
"name": "TAMIAMI TRAIL",
"address": "1830 TAMIAMI TRAIL S",
"city": "VENICE",
"state": "FL",
"zip": "34293",
"phone": "9412369206",
"email": "SVCMNGR6677@PEPBOYS.COM"
},
{
"store": "6678",
"name": "WESTERN BLVD",
"address": "3921 WESTERN BLVD",
"city": "RALEIGH",
"state": "NC",
"zip": "27606",
"phone": "9842332564",
"email": "SVCMNGR6678@PEPBOYS.COM"
},
{
"store": "6681",
"name": "WESTFIELD ROAD",
"address": "6077 PROMENADE SHOPS BLVD",
"city": "NOBLESVILLE",
"state": "IN",
"zip": "46062",
"phone": "3177645468",
"email": "SVCMNGR6681@PEPBOYS.COM"
},
{
"store": "6682",
"name": "BROWNSBURG",
"address": "2697 IN 267",
"city": "BROWNSBURG",
"state": "IN",
"zip": "46112",
"phone": "4633487300",
"email": "SVCMNGR6682@PEPBOYS.COM"
},
{
"store": "6683",
"name": "VICTORY STATION",
"address": "3803 FRANKLIN ROAD",
"city": "MURFREESBORO",
"state": "TN",
"zip": "37128",
"phone": "6292074133",
"email": "SVCMNGR6683@PEPBOYS.COM"
},
{
"store": "6684",
"name": "TRIANGLE TOWN CENTER",
"address": "7320 OLD WAKE FOREST ROAD",
"city": "RALEIGH",
"state": "NC",
"zip": "27616",
"phone": "9848678333",
"email": "SVCMNGR6684@PEPBOYS.COM"
},
{
"store": "6685",
"name": "CHALMETTE",
"address": "3370 PARIS ROAD",
"city": "CHALMETTE",
"state": "LA",
"zip": "70043",
"phone": "5043545955",
"email": "SVCMNGR6685@PEPBOYS.COM"
},
{
"store": "6710",
"name": "WAXHAW",
"address": "3707 PROVIDENCE ROAD S",
"city": "WAXHAW",
"state": "NC",
"zip": "28173",
"phone": "7046276297",
"email": "SVCMNGR6710@PEPBOYS.COM"
},
{
"store": "6711",
"name": "LEXINGTON",
"address": "2460 AUGUSTA HWY",
"city": "LEXINGTON",
"state": "SC",
"zip": "29072",
"phone": "8038217567",
"email": "SVCMNGR6711@PEPBOYS.COM"
},
{
"store": "6712",
"name": "PHOENIXVILLE",
"address": "700 NUTT ROAD",
"city": "PHOENIXVILLE",
"state": "PA",
"zip": "19460",
"phone": "6104220012",
"email": "SVCMNGR6712@PEPBOYS.COM"
},
{
"store": "6800",
"name": "NORTH ISLAND",
"address": "NAVAL AIR STATION N ISLAND",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92135",
"phone": "6193132015",
"email": "SVCMNGR6800@PEPBOYS.COM"
},
{
"store": "6801",
"name": "SAN DIEGO",
"address": "3341 NORMAN SCOTT ROAD",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92136",
"phone": "6198498780",
"email": "SVCMNGR6801@PEPBOYS.COM"
},
{
"store": "6802",
"name": "POINT LOMA",
"address": "2910 NIMITZ BLVD",
"city": "SAN DIEGO",
"state": "CA",
"zip": "92106",
"phone": "6193210699",
"email": "SVCMNGR6802@PEPBOYS.COM"
},
{
"store": "6803",
"name": "MONTEREY",
"address": "1650 LAKE DEL MONTE DRIVE",
"city": "MONTEREY",
"state": "CA",
"zip": "93943",
"phone": "8312646590",
"email": "SVCMNGR6803@PEPBOYS.COM"
},
{
"store": "6804",
"name": "OCEANA",
"address": "889 E AVENUE BLDG 541 NAS",
"city": "OCEANA",
"state": "VA",
"zip": "23460",
"phone": "9482236820",
"email": "SVCMNGR6804@PEPBOYS.COM"
},
{
"store": "6805",
"name": "LITTLE CREEK",
"address": "1183 AMPHIBIOUS DRIVE",
"city": "VIRGINIA BEACH",
"state": "VA",
"zip": "23459",
"phone": "9482236655",
"email": "SVCMNGR6805@PEPBOYS.COM"
},
{
"store": "6806",
"name": "PEARL HARBOR",
"address": "1125 NAMUR ROAD BLDG 82",
"city": "HONOLULU",
"state": "HI",
"zip": "96860",
"phone": "8084587599",
"email": "SVCMNGR6806@PEPBOYS.COM"
},
{
"store": "6807",
"name": "JACKSONVILLE",
"address": "429 BIRMINGHAM AVE",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32212",
"phone": "9049160545",
"email": "SVCMNGR6807@PEPBOYS.COM"
},
{
"store": "6808",
"name": "MAYPORT",
"address": "BUILDING 265 MASSEY AVE",
"city": "JACKSONVILLE",
"state": "FL",
"zip": "32227",
"phone": "9042425313",
"email": "SVCMNGR6808@PEPBOYS.COM"
},
{
"store": "6809",
"name": "PENSACOLA CORRY STATION",
"address": "5600 US HWY 98 WEST",
"city": "PENSACOLA",
"state": "FL",
"zip": "32508",
"phone": "4482396131",
"email": "SVCMNGR6809@PEPBOYS.COM"
},
{
"store": "6810",
"name": "PENSACOLA AVIATION",
"address": "250 SAUFLEY ST BLDG 470",
"city": "PENSACOLA",
"state": "FL",
"zip": "32508",
"phone": "4482396120",
"email": "SVCMNGR6810@PEPBOYS.COM"
},
{
"store": "6811",
"name": "WHIDBEY ISLAND",
"address": "1015 W MIDWAY BLDG 2595",
"city": "OAK HARBOR",
"state": "WA",
"zip": "98278",
"phone": "3606824626",
"email": "SVCMNGR6811@PEPBOYS.COM"
},
{
"store": "6812",
"name": "BANGOR",
"address": "2950 TRIGGER AVE",
"city": "SILVERDALE",
"state": "WA",
"zip": "98315",
"phone": "3609946210",
"email": "SVCMNGR6812@PEPBOYS.COM"
},
{
"store": "6813",
"name": "STENNIS SPACE CENTER",
"address": "3219 BALCH ROAD",
"city": "STENNIS SPACE CENTER",
"state": "MS",
"zip": "39529",
"phone": "6625976210",
"email": "SVCMNGR6813@PEPBOYS.COM"
}
];
