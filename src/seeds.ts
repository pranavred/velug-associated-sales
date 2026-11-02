export type Plant = {
  id: string;
  name: string;
  address: string;
  identity: string[];
  risk: string;
  hold: boolean;
};
export const plants: Plant[] = [
  {
    id: "PLANT-001",
    name: "Chobani · New Berlin",
    address:
      "669 County Route 25, New Berlin, NY 13411 (South Edmeston / Columbus)",
    identity: ["NY0004189", "669 County Route 25", "7-0824-00001"],
    risk: "New Berlin dateline is not the location of the Rome expansion. Contractor locality matches require review.",
    hold: false,
  },
  {
    id: "PLANT-002",
    name: "Anheuser-Busch · Baldwinsville",
    address: "2885 Belgium Road, Baldwinsville, NY 13027 (Lysander)",
    identity: ["2885 Belgium", "7-3136-00002", "7313600002"],
    risk: "Historical permit; an investment announcement does not prove commissioning. Company news may be age-gated.",
    hold: false,
  },
  {
    id: "PLANT-003",
    name: "Genesee / High Falls · Rochester",
    address: "445 St. Paul Street, Rochester, NY 14605",
    identity: ["445 St", "8-2614-00242", "8261400242"],
    risk: "Separate brand, operator and owner. Municipal wastewater permit is not the brewery permit.",
    hold: false,
  },
  {
    id: "PLANT-004",
    name: "Chobani · Twin Falls",
    address: "3450 Kimberly Road East, Twin Falls, Idaho",
    identity: ["3450 Kimberly", "P-2012.0003", "083-00138"],
    risk: "Separate from New Berlin and Rome. Construction approval does not prove completion.",
    hold: false,
  },
  {
    id: "PLANT-005",
    name: "ASR · Yonkers",
    address: "1 Federal Street, Yonkers, NY 10705",
    identity: ["1 Federal", "3-5518-00214", "3551800214"],
    risk: "Prior research found closure announced for end-2025; completion unverified. Suppress prospect recommendations until human review.",
    hold: true,
  },
];
const rows: [string, string, string, number][] = [
  [
    "PLANT-001",
    "NY wastewater permit",
    "https://extapps.dec.ny.gov/data/IF/SPDES/NY0004189/Permit.IndSPDES.NY0004189.2024-11-01.Detail2024Record_x.pdf",
    720,
  ],
  [
    "PLANT-001",
    "Engineering project",
    "https://proveng.com/projects/detail/chobani-east-expansion/",
    720,
  ],
  [
    "PLANT-001",
    "Insulation project",
    "https://thermalsciencetech.com/portfolio/insulation-upgrades-for-chobani-yogurt/",
    720,
  ],
  [
    "PLANT-002",
    "Historical air permit review",
    "https://extapps.dec.ny.gov/data/dar/afs/permits/prr_731360000200089_r1.pdf",
    720,
  ],
  [
    "PLANT-002",
    "Company investment announcement",
    "https://www.anheuser-busch.com/newsroom/Anheuser-Busch-Invests-13M-Baldwinsville",
    168,
  ],
  [
    "PLANT-003",
    "Air permit",
    "https://extapps.dec.ny.gov/data/dar/afs/permits/826140024200049_r0.pdf",
    720,
  ],
  [
    "PLANT-003",
    "Ownership announcement",
    "https://www.fifcousa.com/news/2026/9/3/saothair-captial-partners-acquires-fifco-usa.html",
    168,
  ],
  [
    "PLANT-004",
    "Idaho statement of basis",
    "https://www2.deq.idaho.gov/admin/LEIA/api/document/download/8674",
    720,
  ],
  [
    "PLANT-004",
    "Municipal construction permits",
    "https://www.tfid.org/Archive/ViewFile/Item/3477",
    720,
  ],
  [
    "PLANT-005",
    "Historical air permit review",
    "https://extapps.dec.ny.gov/data/dar/afs/permits/prr_355180021400019_r1.pdf",
    720,
  ],
  [
    "PLANT-005",
    "Network / closure announcement",
    "https://asr-group.com/news/ASR-Group-Announces-Optimizations-of-US-Operational-Network",
    168,
  ],
  [
    "PLANT-005",
    "Legacy directions page",
    "https://asr-group.com/YonkersRefineryInformation",
    168,
  ],
];
export const sources = rows.map(([plant, title, url, hours], i) => ({
  id: `SRC-${String(i + 1).padStart(3, "0")}`,
  plant,
  title,
  url,
  hours,
}));
