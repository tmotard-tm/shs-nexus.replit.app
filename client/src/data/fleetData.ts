// Fleet data processing utilities
export interface FleetVehicle {
  vin: string;
  vehicleNumber: string;
  deliveryDate: string;
  outOfServiceDate: string;
  saleDate: string;
  modelYear: number;
  makeName: string;
  modelName: string;
  licenseState: string;
  licensePlate: string;
  regRenewalDate: string;
  color: string;
  branding: string;
  interior: string;
  tuneStatus: string;
  region: string;
  district: string;
  odometerDelivery: number;
  deliveryAddress: string;
  city: string;
  state: string;
  zip: string;
  mis: string;
  remainingBookValue: number;
  leaseEndDate: string;
}

// Raw CSV data - active vehicles (where SALE_DATE is null)
export const activeVehicles: FleetVehicle[] = [
  {
    vin: "1FTNE1EW5EDA44473",
    vehicleNumber: "46743",
    deliveryDate: "5/29/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "PA",
    licensePlate: "ZBT6575",
    regRenewalDate: "4/30/2026",
    color: "Blue",
    branding: "AE Factory Service",
    interior: "Lawn & Garden",
    tuneStatus: "NA",
    region: "0000850",
    district: "0007983",
    odometerDelivery: 119709,
    deliveryAddress: "4068 Elm Ct",
    city: "PHILADELPHIA",
    state: "PA",
    zip: "19114",
    mis: "134",
    remainingBookValue: 0.00,
    leaseEndDate: "6/18/2023"
  },
  {
    vin: "1FTNE24203HA54483",
    vehicleNumber: "31694",
    deliveryDate: "12/28/2002",
    outOfServiceDate: "3/31/2017",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "IL",
    licensePlate: "172299D",
    regRenewalDate: "6/30/2017",
    color: "Blue",
    branding: "Sears",
    interior: "Utility Without Ref Racks",
    tuneStatus: "Medium",
    region: "0000890",
    district: "0008555",
    odometerDelivery: 0,
    deliveryAddress: "6825 Chestnut Rd",
    city: "ELK GROVE VILLAGE",
    state: "IL",
    zip: "60007",
    mis: "171",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  {
    vin: "1FTNE24213HA54489",
    vehicleNumber: "31700",
    deliveryDate: "2/3/2003",
    outOfServiceDate: "6/2/2017",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "IL",
    licensePlate: "172703D",
    regRenewalDate: "6/30/2018",
    color: "Blue",
    branding: "AE Factory Service",
    interior: "Utility With Ref Racks",
    tuneStatus: "Medium",
    region: "0000890",
    district: "0008555",
    odometerDelivery: 0,
    deliveryAddress: "1513 Pine St",
    city: "ELK GROVE VILLAGE",
    state: "IL",
    zip: "60007",
    mis: "171",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  // Additional sample vehicles - in real implementation this would be loaded from the full CSV
  {
    vin: "1FTNE1EW3EDA41275",
    vehicleNumber: "47100",
    deliveryDate: "4/15/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "TX",
    licensePlate: "ABC123T",
    regRenewalDate: "12/31/2024",
    color: "Blue",
    branding: "Sears",
    interior: "Utility With Ref Racks",
    tuneStatus: "Maximum",
    region: "0000890",
    district: "0008227",
    odometerDelivery: 85000,
    deliveryAddress: "123 Main St",
    city: "DALLAS",
    state: "TX",
    zip: "75234",
    mis: "100",
    remainingBookValue: 12500.00,
    leaseEndDate: "12/31/2025"
  },
  {
    vin: "1FTNE24203HA50400",
    vehicleNumber: "30650",
    deliveryDate: "12/26/2002",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "CA",
    licensePlate: "8T84000",
    regRenewalDate: "1/31/2025",
    color: "Blue",
    branding: "Unmarked",
    interior: "Empty",
    tuneStatus: "Stock",
    region: "0000890",
    district: "0007088",
    odometerDelivery: 0,
    deliveryAddress: "5800 Cedar Pl",
    city: "EL CAJON",
    state: "CA",
    zip: "92020",
    mis: "155",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  {
    vin: "1FTNE1EW5EDA44500",
    vehicleNumber: "46800",
    deliveryDate: "6/1/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "FL",
    licensePlate: "DEF456F",
    regRenewalDate: "3/31/2025",
    color: "Blue",
    branding: "AE Factory Service",
    interior: "Lawn & Garden",
    tuneStatus: "Maximum",
    region: "0000850",
    district: "0007435",
    odometerDelivery: 95000,
    deliveryAddress: "456 Oak Ave",
    city: "MIAMI",
    state: "FL",
    zip: "33015",
    mis: "120",
    remainingBookValue: 8500.00,
    leaseEndDate: "3/31/2026"
  },
  {
    vin: "1FTNE24213HA52200",
    vehicleNumber: "31500",
    deliveryDate: "1/15/2003",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "WI",
    licensePlate: "WIS123",
    regRenewalDate: "12/31/2024",
    color: "Blue",
    branding: "Sears",
    interior: "Utility Without Ref Racks",
    tuneStatus: "Medium",
    region: "0000850",
    district: "0008060",
    odometerDelivery: 0,
    deliveryAddress: "789 Pine St",
    city: "MILWAUKEE",
    state: "WI",
    zip: "53704",
    mis: "145",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  {
    vin: "1FTNE1EW3EDA41300",
    vehicleNumber: "47200",
    deliveryDate: "7/1/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "NY",
    licensePlate: "NYS789",
    regRenewalDate: "4/30/2025",
    color: "Blue",
    branding: "Unmarked",
    interior: "Utility With Ref Racks",
    tuneStatus: "Stock",
    region: "0000850",
    district: "0007670",
    odometerDelivery: 75000,
    deliveryAddress: "321 Maple Dr",
    city: "BUFFALO",
    state: "NY",
    zip: "14201",
    mis: "130",
    remainingBookValue: 15000.00,
    leaseEndDate: "4/30/2027"
  },
  {
    vin: "1FTNE24203HA54600",
    vehicleNumber: "31850",
    deliveryDate: "3/15/2003",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "WA",
    licensePlate: "WAS456",
    regRenewalDate: "12/31/2024",
    color: "Blue",
    branding: "AE Factory Service",
    interior: "Empty",
    tuneStatus: "NA",
    region: "0000890",
    district: "0008505",
    odometerDelivery: 0,
    deliveryAddress: "654 Cedar Ave",
    city: "SEATTLE",
    state: "WA",
    zip: "98134",
    mis: "160",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  {
    vin: "1FTNE1EW5EDA44600",
    vehicleNumber: "46900",
    deliveryDate: "8/1/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "MD",
    licensePlate: "MD987M",
    regRenewalDate: "1/31/2025",
    color: "Blue",
    branding: "Sears",
    interior: "Lawn & Garden",
    tuneStatus: "Maximum",
    region: "0000850",
    district: "0007084",
    odometerDelivery: 82000,
    deliveryAddress: "987 Birch Ln",
    city: "BALTIMORE",
    state: "MD",
    zip: "21244",
    mis: "140",
    remainingBookValue: 11000.00,
    leaseEndDate: "1/31/2026"
  },
  {
    vin: "1FTNE24213HA54700",
    vehicleNumber: "31900",
    deliveryDate: "4/1/2003",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2003,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "MA",
    licensePlate: "MA654L",
    regRenewalDate: "12/31/2024",
    color: "Blue",
    branding: "Unmarked",
    interior: "Utility Without Ref Racks",
    tuneStatus: "Stock",
    region: "0000850",
    district: "0007670",
    odometerDelivery: 0,
    deliveryAddress: "111 Ash St",
    city: "BOSTON",
    state: "MA",
    zip: "02101",
    mis: "170",
    remainingBookValue: 0.00,
    leaseEndDate: ""
  },
  {
    vin: "1FTNE1EW3EDA41400",
    vehicleNumber: "47300",
    deliveryDate: "9/1/2014",
    outOfServiceDate: "",
    saleDate: "",
    modelYear: 2014,
    makeName: "FORD",
    modelName: "ECONOLINE",
    licenseState: "NV",
    licensePlate: "NEV321",
    regRenewalDate: "1/6/2026",
    color: "Blue",
    branding: "AE Factory Service",
    interior: "Utility With Ref Racks",
    tuneStatus: "Maximum",
    region: "0000890",
    district: "0008184",
    odometerDelivery: 68000,
    deliveryAddress: "222 Willow Rd",
    city: "LAS VEGAS",
    state: "NV",
    zip: "89431",
    mis: "125",
    remainingBookValue: 13500.00,
    leaseEndDate: "9/1/2026"
  }
];

// Updated to reflect actual count from uploaded CSV (vehicles without sale date)
export const getActiveVehicleCount = () => 2424;

export const getAvailableVehicles = () => activeVehicles.filter(v => !v.outOfServiceDate || new Date(v.outOfServiceDate) > new Date());

export const getBrandingOptions = () => Array.from(new Set(activeVehicles.map(v => v.branding))).filter(Boolean).sort();

export const getInteriorOptions = () => Array.from(new Set(activeVehicles.map(v => v.interior))).filter(Boolean).sort();

export const getTuneStatusOptions = () => Array.from(new Set(activeVehicles.map(v => v.tuneStatus))).filter(Boolean).sort();

export const getMakeOptions = () => Array.from(new Set(activeVehicles.map(v => v.makeName))).filter(Boolean).sort();

export const getModelOptions = () => Array.from(new Set(activeVehicles.map(v => v.modelName))).filter(Boolean).sort();

export const getColorOptions = () => Array.from(new Set(activeVehicles.map(v => v.color))).filter(Boolean).sort();

export const getStateOptions = () => Array.from(new Set(activeVehicles.map(v => v.state))).filter(Boolean).sort();

export const getLicenseStateOptions = () => Array.from(new Set(activeVehicles.map(v => v.licenseState))).filter(Boolean).sort();

export const getRegionOptions = () => Array.from(new Set(activeVehicles.map(v => v.region))).filter(Boolean).sort();

export const getDistrictOptions = () => Array.from(new Set(activeVehicles.map(v => v.district))).filter(Boolean).sort();

export const getYearOptions = () => Array.from(new Set(activeVehicles.map(v => v.modelYear))).filter(Boolean).sort((a, b) => b - a);

export const getCityOptions = () => Array.from(new Set(activeVehicles.map(v => v.city))).filter(Boolean).sort();