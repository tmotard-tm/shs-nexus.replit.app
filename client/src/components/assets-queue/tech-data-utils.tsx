import type { QueueItem } from "@shared/schema";

export type DataSource = 'separation' | 'roster' | null;

export interface SourcedField {
  value: string | null;
  source: DataSource;
}

export interface TechData {
  techName: string;
  enterpriseId: string;
  district: string | null;
  separationDate: string | null;
  lastDayWorked: string | null;
  mobilePhone: string | null;
  personalPhone: string | null;
  homePhone: string | null;
  contactNumber: string | null;
  email: string | null;
  personalEmail: string | null;
  address: string | null;
  fleetPickupAddress: string | null;
  hrTruckNumber: string | null;
  separationCategory: string | null;
  fromSnowflake?: boolean;
  sources: {
    personalPhone: DataSource;
    email: DataSource;
    address: DataSource;
    fleetPickupAddress: DataSource;
    hrTruckNumber: DataSource;
    separationCategory: DataSource;
    lastDayWorked: DataSource;
  };
}

export interface ContactInfo {
  personalPhone: SourcedField;
  mobilePhone: SourcedField;
  mainPhone: SourcedField;
  homePhone: SourcedField;
  personalEmail: SourcedField;
  address: SourcedField;
  fleetPickupAddress: SourcedField;
  hrTruckNumber: SourcedField;
  homeAddress: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal: string | null;
  };
  employeeId: string;
  techName: string;
  separationCategory: string | null;
}

export function SourceDot({ source, className }: { source: DataSource; className?: string }) {
  if (!source) return null;
  const color = source === 'separation' ? 'bg-purple-500' : 'bg-blue-500';
  const title = source === 'separation' ? 'HR Separation Data' : 'Employee Roster Data';
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} ${className || ''}`}
      title={title}
    />
  );
}

export function SourceLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-purple-500" />
        HR Separation
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
        Employee Roster
      </span>
    </div>
  );
}

export function pickSourced(sepVal: string | null | undefined, rosterVal: string | null | undefined): { value: string | null; source: DataSource } {
  if (sepVal) return { value: sepVal, source: 'separation' };
  if (rosterVal) return { value: rosterVal, source: 'roster' };
  return { value: null, source: null };
}

export function parseTechData(item: QueueItem): TechData | undefined {
  try {
    const parsed = item.data ? JSON.parse(item.data) : {};
    const tech = parsed.technician || parsed.employee || {};
    if (!tech || Object.keys(tech).length === 0) return undefined;
    const hr = parsed.hrSeparation || {};
    const roster = parsed.rosterContact || {};

    const rosterCellPhone = roster.cellPhone || null;
    const rosterMainPhone = roster.mainPhone || null;
    const rosterHomePhone = roster.homePhone || null;
    const rosterAddr = [roster.homeAddr1, roster.homeAddr2, roster.homeCity, roster.homeState, roster.homePostal].filter(Boolean).join(', ') || tech.address || tech.homeAddress;
    const rosterTruck = roster.truckLu || tech.hrTruckNumber || tech.truckNumber;

    const personalPhoneRoster = rosterCellPhone || tech.personalPhone || tech.homePhone || tech.contactNumber || null;
    const mobilePhoneRoster = rosterMainPhone || tech.mobilePhone || null;

    const resolvedPersonal = hr.contactNumber || personalPhoneRoster;
    const resolvedMobile = mobilePhoneRoster;

    let finalMobile: string | null;
    let finalPersonal: string | null;

    if (resolvedMobile && resolvedPersonal) {
      finalMobile = resolvedMobile;
      finalPersonal = resolvedPersonal === resolvedMobile ? null : resolvedPersonal;
    } else if (resolvedMobile) {
      finalMobile = resolvedMobile;
      finalPersonal = null;
    } else if (resolvedPersonal) {
      finalMobile = resolvedPersonal;
      finalPersonal = null;
    } else {
      finalMobile = null;
      finalPersonal = null;
    }

    const phoneSrc = finalPersonal
      ? pickSourced(hr.contactNumber && hr.contactNumber === finalPersonal ? hr.contactNumber : null, finalPersonal)
      : { value: null, source: null as DataSource };

    const emailSrc = pickSourced(hr.personalEmail, tech.email || tech.personalEmail);
    const addressSrc = pickSourced(null, rosterAddr);
    const fleetPickupSrc = pickSourced(hr.fleetPickupAddress, tech.fleetPickupAddress);
    const truckSrc = pickSourced(hr.truckNumber, rosterTruck);
    const sepCatSrc = pickSourced(hr.separationCategory, tech.separationCategory);
    const lastDaySrc = pickSourced(hr.lastDay, tech.lastDayWorked);

    return {
      techName: tech.techName || tech.name || tech.technicianName || hr.technicianName || "Unknown",
      enterpriseId: tech.enterpriseId || tech.ldapId || hr.ldapId || tech.emplId || "",
      district: tech.district || null,
      separationDate: tech.separationDate || tech.lastDayWorked || tech.effectiveSeparationDate || hr.lastDay || hr.effectiveSeparationDate || null,
      lastDayWorked: lastDaySrc.value,
      mobilePhone: finalMobile || null,
      personalPhone: finalPersonal || null,
      homePhone: rosterHomePhone || tech.homePhone || null,
      contactNumber: tech.contactNumber || hr.contactNumber || null,
      email: emailSrc.value,
      personalEmail: tech.personalEmail || hr.personalEmail || null,
      address: addressSrc.value,
      fleetPickupAddress: fleetPickupSrc.value,
      hrTruckNumber: truckSrc.value,
      separationCategory: sepCatSrc.value,
      fromSnowflake: tech.fromSnowflake,
      sources: {
        personalPhone: phoneSrc.source,
        email: emailSrc.source,
        address: addressSrc.source,
        fleetPickupAddress: fleetPickupSrc.source,
        hrTruckNumber: truckSrc.source,
        separationCategory: sepCatSrc.source,
        lastDayWorked: lastDaySrc.source,
      },
    };
  } catch {
    return undefined;
  }
}

export interface AssetsQueueItemEnriched extends QueueItem {
  techData?: TechData;
}

export function enrichItem(item: QueueItem): AssetsQueueItemEnriched {
  return { ...item, techData: parseTechData(item) };
}
