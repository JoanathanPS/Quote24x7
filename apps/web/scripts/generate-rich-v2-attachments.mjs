import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as XLSX from "xlsx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import JSZip from "jszip";

// Ensure files are in both root test-attachments and apps/web/test-attachments
const targetDirs = [
  path.resolve(process.cwd(), "test-attachments"),
  path.resolve(process.cwd(), "apps", "web", "test-attachments"),
  path.resolve(process.cwd(), "..", "test-attachments"),
].filter((d, i, arr) => arr.indexOf(d) === i);

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeToAll(filename, buffer) {
  for (const dir of targetDirs) {
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
}

// 1. Helper to generate CSV with realistic columns
function createCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(r.map((val) => (String(val).includes(",") ? `"${val}"` : String(val))).join(","));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

// 2. Helper to generate multi-sheet XLSX
function createXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// 3. Helper to generate multi-page PDF RFP
async function createMultiPagePdf(spec) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const pageData of spec.pages) {
    const page = doc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    // Top banner
    page.drawRectangle({
      x: 35,
      y: height - 60,
      width: width - 70,
      height: 35,
      color: rgb(0.1, 0.15, 0.25),
    });
    page.drawText(spec.title.toUpperCase(), {
      x: 45,
      y: height - 42,
      size: 11,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
    page.drawText(`Page ${pageData.pageNumber} of ${spec.pages.length}`, {
      x: width - 110,
      y: height - 42,
      size: 9,
      font,
      color: rgb(0.8, 0.85, 0.95),
    });

    let y = height - 85;
    for (const item of pageData.lines) {
      if (item.startsWith("### ")) {
        y -= 8;
        page.drawText(item.slice(4), { x: 40, y, size: 12, font: boldFont, color: rgb(0.12, 0.2, 0.35) });
        y -= 18;
      } else if (item.startsWith("## ")) {
        y -= 12;
        page.drawText(item.slice(3), { x: 40, y, size: 14, font: boldFont, color: rgb(0.08, 0.12, 0.22) });
        y -= 22;
      } else if (item.startsWith("| ")) {
        // Table row
        page.drawText(item, { x: 45, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 14;
      } else {
        page.drawText(item, { x: 40, y, size: 9.5, font, color: rgb(0.2, 0.2, 0.2) });
        y -= 14;
      }
    }

    // Footer
    page.drawText("CONFIDENTIAL & PROPRIETARY — INFRASTRUCTURE SPECIFICATION", {
      x: 40,
      y: 25,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// 4. Helper to build a valid PNG buffer of width x height
function createPngBuffer(width, height, drawBoxCount = 4) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(2, 9); // RGB color
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, "ascii");
    data.copy(buf, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + len; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) {
        if ((crc ^ byte) & 1) {
          crc = (crc >>> 1) ^ 0xedb88320;
        } else {
          crc = crc >>> 1;
        }
        byte = byte >>> 1;
      }
    }
    buf.writeInt32BE((crc ^ 0xffffffff) | 0, 8 + len);
    return buf;
  }

  const bytesPerPixel = 3;
  const scanlineLength = 1 + width * bytesPerPixel;
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawData[offset] = 0; // Filter 0 (None)
    for (let x = 0; x < width; x++) {
      const p = offset + 1 + x * bytesPerPixel;
      let r = 240, g = 244, b = 250;

      for (let bIdx = 0; bIdx < drawBoxCount; bIdx++) {
        const boxX = 30 + bIdx * 90;
        const boxY = 40 + (bIdx % 2) * 50;
        if (x >= boxX && x <= boxX + 60 && y >= boxY && y <= boxY + 35) {
          if (x === boxX || x === boxX + 60 || y === boxY || y === boxY + 35) {
            r = 30; g = 80; b = 160;
          } else {
            r = 210; g = 225; b = 245;
          }
        }
      }
      rawData[p] = r;
      rawData[p + 1] = g;
      rawData[p + 2] = b;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk("IDAT", compressedData);
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// 5. Helper to generate Image-Only Scanned PDF (no text streams)
async function createImageOnlyPdf(filename, pngBuffer) {
  const doc = await PDFDocument.create();
  const pngImage = await doc.embedPng(pngBuffer);
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(pngImage, {
    x: 40,
    y: 80,
    width: 515.28,
    height: 681.89,
  });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// 6. Helper to generate genuine Word DOCX with JSZip
async function createDocx(title, company, sections) {
  const zip = new JSZip();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  let bodyXml = `
    <w:p>
      <w:pPr><w:b/><w:jc w:val="left"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:i/><w:color w:val="555555"/></w:rPr><w:t>Company: ${escapeXml(company)}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Please review our technical infrastructure requirements below and quote the appropriate Site24x7 monitoring plan tiers and add-on packs.</w:t></w:r>
    </w:p>`;

  for (const sec of sections) {
    bodyXml += `
    <w:p>
      <w:pPr><w:b/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${escapeXml(sec.heading)}</w:t></w:r>
    </w:p>`;
    for (const item of sec.items) {
      bodyXml += `
    <w:p>
      <w:pPr><w:ind w:left="360"/></w:pPr>
      <w:r><w:t>• ${escapeXml(item)}</w:t></w:r>
    </w:p>`;
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`;

  zip.file("[Content_Types].xml", contentTypesXml);
  zip.folder("_rels").file(".rels", relsXml);
  zip.folder("word").file("document.xml", documentXml);

  return zip.generateAsync({ type: "nodebuffer" });
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
    }
    return c;
  });
}

async function main() {
  console.log("Generating comprehensive multimodal test fixtures across all targets...");

  // 1. CSV Files (10 to 120 rows with irrelevant columns: IP, MAC, Rack, CPU, RAM)
  writeToAll("mm-inventory-fintech.csv", createCsv(
    ["Hostname", "Role", "Environment", "IP Address", "MAC Address", "Rack ID", "CPU Cores", "Status"],
    [
      ...Array.from({ length: 45 }, (_, i) => [
        `fin-app-node-${String(i + 1).padStart(2, "0")}`,
        "Production Host Server",
        "PCI-DSS-Prod",
        `10.150.1.${i + 10}`,
        `00:50:56:A1:B2:${String(i + 1).padStart(2, "0")}`,
        `RACK-NY-${(i % 5) + 1}`,
        "16 vCPU",
        "Active",
      ]),
      ["core-fw-01", "Network Firewall", "DMZ", "10.150.0.1", "00:50:56:C0:01:01", "RACK-NY-1", "8 vCPU", "Active"],
      ["spine-sw-01", "Network Switch", "Core", "10.150.0.2", "00:50:56:C0:01:02", "RACK-NY-1", "N/A", "Active"],
      ["leaf-sw-01", "Network Switch", "Distribution", "10.150.0.3", "00:50:56:C0:01:03", "RACK-NY-2", "N/A", "Active"],
    ]
  ));

  writeToAll("mm-inventory-healthcare.csv", createCsv(
    ["Device Name", "Classification", "Hospital Wing", "VLAN", "IP Address", "Serial Number", "OS Version"],
    [
      ...Array.from({ length: 60 }, (_, i) => [
        `EMR-SRV-${String(i + 1).padStart(2, "0")}`,
        "Production Server",
        "East Wing Clinic",
        "102",
        `172.24.10.${i + 1}`,
        `SN-HC-992${i + 10}`,
        "Red Hat Enterprise Linux 9",
      ]),
      ["HOSP-GW-RTR", "Network Router", "Core DC", "1", "172.24.1.1", "SN-CISCO-881", "IOS-XE 17.6"],
      ["HOSP-CORE-SW", "Network Switch", "Core DC", "1", "172.24.1.2", "SN-CATALYST-9500", "IOS-XE 17.6"],
    ]
  ));

  writeToAll("mm-inventory-ecommerce.csv", createCsv(
    ["Node FQDN", "Instance Type", "Cluster", "Subnet", "IP", "Role", "Availability Zone"],
    [
      ...Array.from({ length: 35 }, (_, i) => [
        `cart-api-${i + 1}.shop.internal`,
        "c6i.4xlarge",
        "Checkout-Fleet",
        "subnet-prod-a",
        `10.2.1.${i + 20}`,
        "Host Server",
        "ap-south-1a",
      ]),
      ["edge-switch-01", "Hardware", "DMZ", "subnet-mgmt", "10.2.0.1", "Network Switch", "ap-south-1a"],
      ["edge-switch-02", "Hardware", "DMZ", "subnet-mgmt", "10.2.0.2", "Network Switch", "ap-south-1b"],
    ]
  ));

  writeToAll("mm-inventory-saas.csv", createCsv(
    ["Instance ID", "Host Tag", "Tier", "Internal IP", "Disk GB", "CPU", "Service Unit"],
    [
      ...Array.from({ length: 90 }, (_, i) => [
        `i-0987afc${String(i + 1).padStart(3, "0")}`,
        `saas-worker-${i + 1}`,
        "Processing Tier",
        `10.80.4.${i + 1}`,
        "500 GB NVMe",
        "32 vCPU",
        "Host Server",
      ]),
      ["i-sw-01", "sw-tor-01", "Network Gear", "10.80.0.1", "N/A", "N/A", "Network Switch"],
      ["i-sw-02", "sw-tor-02", "Network Gear", "10.80.0.2", "N/A", "N/A", "Network Switch"],
      ["i-sw-03", "sw-tor-03", "Network Gear", "10.80.0.3", "N/A", "N/A", "Network Switch"],
      ["i-sw-04", "sw-tor-04", "Network Gear", "10.80.0.4", "N/A", "N/A", "Network Switch"],
    ]
  ));

  writeToAll("mm-inventory-telecom.csv", createCsv(
    ["NE ID", "Network Element Type", "PoP Site", "Management IP", "Role"],
    [
      ...Array.from({ length: 110 }, (_, i) => [
        `B-NGN-SRV-${String(i + 1).padStart(3, "0")}`,
        "Compute Host Server",
        "Delhi-PoP-Central",
        `172.16.50.${i + 1}`,
        "Compute Node",
      ]),
      ...Array.from({ length: 15 }, (_, i) => [
        `SW-METRO-${String(i + 1).padStart(2, "0")}`,
        "Network Switch",
        "Delhi-PoP-Central",
        `172.16.10.${i + 1}`,
        "Spine/Leaf Switch",
      ]),
    ]
  ));

  writeToAll("mm-inventory-media.csv", createCsv(
    ["Asset ID", "Server Role", "Stream Codec", "IP", "Rack Unit"],
    [
      ...Array.from({ length: 28 }, (_, i) => [`ENC-NODE-${i + 1}`, "Transcoding Server", "HEVC/H.264", `192.168.40.${i + 10}`, `RU-${i + 1}`]),
      ["SW-AGG-01", "Network Switch", "Control", "192.168.40.1", "RU-41"],
      ["SW-AGG-02", "Network Switch", "Control", "192.168.40.2", "RU-42"],
    ]
  ));

  writeToAll("mm-inventory-logistics.csv", createCsv(
    ["Host Identifier", "Facility Location", "Operational Role", "IP", "Sizing Unit"],
    [
      ...Array.from({ length: 55 }, (_, i) => [`wh-srv-${i + 1}`, "Chicago Hub", "WMS Application Host", `10.210.4.${i + 1}`, "Host Server"]),
      ["wh-cisco-core-01", "Chicago Hub", "Distribution Switch", "10.210.0.1", "Network Switch"],
      ["wh-cisco-core-02", "Chicago Hub", "Distribution Switch", "10.210.0.2", "Network Switch"],
    ]
  ));

  writeToAll("mm-inventory-energy.csv", createCsv(
    ["RTU Node ID", "Substation Grid", "Component Type", "IP", "Classification"],
    [
      ...Array.from({ length: 75 }, (_, i) => [`SCADA-HOST-${String(i + 1).padStart(2, "0")}`, "Grid-Sector-4", "Industrial Server", `10.99.12.${i + 1}`, "Compute Host"]),
      ...Array.from({ length: 6 }, (_, i) => [`SCADA-SW-${i + 1}`, "Grid-Sector-4", "Ethernet Switch", `10.99.1.1${i}`, "Network Switch"]),
    ]
  ));

  // 2. XLSX Files
  writeToAll("mm-datacenter-audit.xlsx", createXlsx({
    "Production Servers": [
      ["Server Tag", "Host Model", "Cores", "Memory", "IP Address", "Environment"],
      ...Array.from({ length: 65 }, (_, i) => [`DC-PROD-SRV-${i + 1}`, "Dell PowerEdge R750", "32", "128 GB", `10.5.10.${i + 1}`, "Production"]),
    ],
    "Network Infrastructure": [
      ["Device Tag", "Hardware Type", "Vendor", "Ports", "Location"],
      ...Array.from({ length: 8 }, (_, i) => [`NET-SW-${i + 1}`, "Network Switch", "Cisco Nexus 9000", "48x10G", "DC Row A"]),
    ],
    "Excluded Labs": [
      ["Decommissioned Node", "Status"],
      ["OLD-SRV-99", "Retired"],
      ["TEST-BOX-01", "Dev/Test Only - Do not monitor"],
    ],
  }));

  writeToAll("mm-cloud-migration.xlsx", createXlsx({
    "AWS EC2 Fleet": [
      ["Instance Name", "Instance Type", "vCPU", "Role"],
      ...Array.from({ length: 40 }, (_, i) => [`prod-ec2-api-${i + 1}`, "m6i.2xlarge", "8", "Host Server"]),
    ],
    "Transit Gateways": [
      ["Gateway Name", "Routing Domain", "Type"],
      ...Array.from({ length: 5 }, (_, i) => [`tgw-vpc-route-${i + 1}`, "Shared Services", "Network Switch / Router"]),
    ],
  }));

  writeToAll("mm-hybrid-workloads.xlsx", createXlsx({
    "VMware Private Cloud": [
      ["VM Name", "Cluster", "Memory GB", "Target Unit"],
      ...Array.from({ length: 50 }, (_, i) => [`esxi-vm-${i + 1}`, "Cluster-Primary", "64", "Host Server"]),
    ],
    "Top of Rack Switches": [
      ["Switch Name", "Location", "Target Unit"],
      ...Array.from({ length: 10 }, (_, i) => [`tor-sw-${i + 1}`, "Rack 01-10", "Network Switch"]),
    ],
  }));

  writeToAll("mm-multi-region-servers.xlsx", createXlsx({
    "APAC Servers": [
      ["Host", "Region", "Status"],
      ...Array.from({ length: 40 }, (_, i) => [`apac-srv-${i + 1}`, "ap-southeast-1", "Active Host"]),
    ],
    "EMEA Servers": [
      ["Host", "Region", "Status"],
      ...Array.from({ length: 40 }, (_, i) => [`emea-srv-${i + 1}`, "eu-central-1", "Active Host"]),
    ],
    "Core Backbone": [
      ["Switch Device", "Location"],
      ...Array.from({ length: 12 }, (_, i) => [`bb-sw-${i + 1}`, "Global Backbone Switch"]),
    ],
  }));

  writeToAll("mm-switch-fabric.xlsx", createXlsx({
    "Compute Nodes": [
      ["Compute ID", "OS", "Role"],
      ...Array.from({ length: 30 }, (_, i) => [`comp-fabric-${i + 1}`, "Debian 12", "Host Server"]),
    ],
    "Fabric Switches": [
      ["Fabric Switch ID", "Model", "Role"],
      ...Array.from({ length: 18 }, (_, i) => [`fabric-spine-${i + 1}`, "Arista 7050", "Network Switch"]),
    ],
  }));

  // 3. Multi-Page Enterprise PDF RFPs (3 to 5 pages each)
  const rfpSpecs = [
    {
      filename: "mm-rfp-banking-cluster.pdf",
      title: "Core Banking Infrastructure Tender RFP",
      pages: [
        {
          pageNumber: 1,
          lines: [
            "## 1. Executive Summary & Purpose",
            "This Request for Proposal (RFP) defines the automated IT infrastructure monitoring requirements for the Core Banking Transaction Cluster.",
            "Bidders must provide certified pricing for Site24x7 annual licensing covering all required hosts, network switches, web portals, and log volumes.",
            "",
            "### 1.1 Project Authority & Timeline",
            "Issuing Entity: National Commercial Bank Information Technology Division.",
            "RFP Reference: NCB-IT-2026-RFP-092.",
            "All monitoring metrics must be strictly verified against official Site24x7 pricing tiers.",
          ],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Infrastructure Sizing & Compute Roster",
            "The Core Banking system runs on dedicated virtual and physical computing nodes:",
            "",
            "| Component Category | Detailed Specification | Bill of Materials Sizing |",
            "| Host Server Fleet | 40 Red Hat Enterprise Linux nodes for OLTP processing | 40 Servers |",
            "| Core Backbone Switches | 6 redundant Cisco Nexus 9300 datacenter switches | 6 Network Devices |",
            "| Public Banking URLs | Retail NetBanking portal & corporate gateway | 8 Websites |",
            "| Synthetic Transactions | Multi-step funds transfer and login synthetic checks | 4 Advanced Monitors |",
            "",
            "### 2.1 Exclusions & Non-Applicable Modules",
            "Real User Monitoring (RUM) is out of scope for this procurement.",
            "Synthetic checks outside the specified 4 user journeys are not required.",
          ],
        },
        {
          pageNumber: 3,
          lines: [
            "## 3. Log Aggregation & Compliance Mandate",
            "Under regulatory banking guidelines (RBI / ISO 27001), transaction audit logs must be indexed and searchable.",
            "",
            "### 3.1 Log Volume Specification",
            "Estimated monthly log ingestion requirement: 500 GB logs per month.",
            "Retention window: 30-day hot search index.",
            "",
            "### 3.2 Summary Table for Vendor Quotation",
            "• Host Server Monitors: 40 nodes",
            "• Network Component Monitors: 6 switches",
            "• Basic Website Monitors: 8 public URLs",
            "• Advanced Synthetic Monitors: 4 transactions",
            "• Monthly Log Ingestion: 500 GB logs",
            "• RUM Pageviews: 0 (Explicitly excluded)",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-fintech-gateway.pdf",
      title: "Fintech Payment Gateway Monitoring Scope",
      pages: [
        {
          pageNumber: 1,
          lines: [
            "## 1. Project Background",
            "Fintech Payment Gateway operates high-throughput API endpoints for credit card processing and UPI transfers.",
          ],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Technical Scope of Work",
            "• Host Servers: 30 Kubernetes application nodes.",
            "• Network Components: 4 edge firewall switches.",
            "• Basic Monitors: 5 public API endpoints.",
            "• Advanced Monitors: 2 critical payment synthetic flows.",
            "• Log Collection: 250 GB monthly application logs.",
            "• Real User Monitoring: None required (0 pageviews).",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-hospital-network.pdf",
      title: "Hospital Network Telemetry RFP",
      pages: [
        {
          pageNumber: 1,
          lines: [
            "## 1. Hospital IT Operations Overview",
            "Healthcare telemetry monitoring across emergency wards, radiology systems, and inpatient management.",
          ],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Bill of Quantities",
            "• Medical Database & Application Hosts: 50 servers.",
            "• Hospital Department Core Switches: 10 network components.",
            "• Telehealth Doctor/Patient Web Portals: 4 basic monitors.",
            "• Synthetic Patient Check-in: 1 advanced monitor.",
            "• Diagnostic DICOM and HL7 Logs: 300 GB logs monthly.",
            "• RUM: 0 pageviews.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-retail-pos.pdf",
      title: "Retail POS & Inventory Telemetry RFP",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Retail Chain Infrastructure", "Multi-store point of sale servers and regional distribution centers."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Requirements Specification",
            "• Store Cluster Servers: 45 servers.",
            "• Store Edge SD-WAN Gateways: 8 network components.",
            "• E-commerce Storefront URLs: 6 basic monitors.",
            "• Cart Checkout Synthetics: 3 advanced monitors.",
            "• Store Transaction Logs: 150 GB logs monthly.",
            "• Storefront RUM: 1,000,000 pageviews per month.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-government-cloud.pdf",
      title: "Government Portal Infrastructure Tender",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Citizen Services Cloud", "State government citizen portal infrastructure monitoring tender."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Quota & Allocation Summary",
            "• Citizen Service Application Hosts: 80 servers.",
            "• Datacenter Backbone Switches: 15 network components.",
            "• Public Department Portals: 12 basic monitors.",
            "• Single-Sign-On Synthetic Transactions: 5 advanced monitors.",
            "• Audit Trail Logs: 800 GB logs monthly.",
            "• RUM: 2,000,000 pageviews per month.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-university-campus.pdf",
      title: "University Campus Wi-Fi and Core Infrastructure",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Academic Campus IT", "Central campus IT division monitoring requirements."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Scope Matrix",
            "• Academic Department Hosts: 35 servers.",
            "• Campus Fiber Switches & Controllers: 16 network components.",
            "• Student Portal URLs: 5 basic monitors.",
            "• Synthetic checks: None (0).",
            "• RUM: None (0 pageviews).",
            "• Central Syslog volume: 200 GB logs monthly.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-smartcity-iot.pdf",
      title: "Smart City IoT Broker Infrastructure Sizing",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Smart City IoT Telemetry", "Municipal IoT sensor gateway and telemetry broker infrastructure."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Sizing Summary",
            "• Telemetry collector VMs: 70 servers.",
            "• IoT edge gateway switches: 20 network components.",
            "• Citizen portal websites: 6 basic monitors.",
            "• Synthetic checks: None (0).",
            "• RUM: None (0).",
            "• Device log stream: 1000 GB logs monthly.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-airline-ops.pdf",
      title: "Airline Operations Dispatch System RFP",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Flight Dispatch Infrastructure", "Global airline flight dispatch and passenger operations."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Technical Scope",
            "• Flight dispatch compute nodes: 45 servers.",
            "• Airport terminal network switches: 12 network components.",
            "• Flight status public URLs: 8 basic monitors.",
            "• Booking flow synthetic checks: 3 advanced monitors.",
            "• Operational logs: 400 GB logs per month.",
            "• Passenger portal RUM: 1,500,000 pageviews per month.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-automotive-mfg.pdf",
      title: "Automotive Factory Telemetry Specification",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Plant Automation IT", "Automotive manufacturing plant assembly line telemetry."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Component Requirements",
            "• Assembly line control servers: 55 servers.",
            "• Industrial Ethernet switches: 14 network components.",
            "• Supplier extranet websites: 4 basic monitors.",
            "• Synthetic checks: 0.",
            "• RUM: 0.",
            "• Quality inspection log volume: 350 GB logs per month.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-telco-core.pdf",
      title: "5G Core Network Monitoring Specification",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Telecommunications 5G Core", "5G network control plane and spine switch fabric monitoring."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Core Sizing",
            "• Control plane compute hosts: 100 servers.",
            "• Data center spine switches: 25 network components.",
            "• Subscriber self-service portal: 10 basic monitors.",
            "• Synthetic checks: 0.",
            "• RUM: 0.",
            "• Signaling logs: 1500 GB logs monthly.",
          ],
        },
      ],
    },
    {
      filename: "mm-rfp-insurance-portal.pdf",
      title: "Insurance Claims Engine RFP",
      pages: [
        {
          pageNumber: 1,
          lines: ["## 1. Insurance Adjudication System", "Policy issuance and claims processing infrastructure."],
        },
        {
          pageNumber: 2,
          lines: [
            "## 2. Scope Matrix",
            "• Claims adjudication hosts: 35 servers.",
            "• Office branch network switches: 7 network components.",
            "• Policyholder portal URLs: 6 basic monitors.",
            "• Policy issuance synthetic test: 2 advanced monitors.",
            "• Application event logs: 200 GB logs monthly.",
            "• Claims portal RUM: 500,000 pageviews per month.",
          ],
        },
      ],
    },
  ];

  for (const spec of rfpSpecs) {
    const pdfBuf = await createMultiPagePdf(spec);
    writeToAll(spec.filename, pdfBuf);
  }

  // Also verify Case-1 exists in both
  const case1Path = path.join(targetDirs[0], "Case-1-Production-Infrastructure.pdf");
  if (fs.existsSync(case1Path)) {
    const case1Buf = fs.readFileSync(case1Path);
    writeToAll("Case-1-Production-Infrastructure.pdf", case1Buf);
  }

  // 4. Word DOCX files (5 distinct specifications)
  const docxList = [
    {
      filename: "mm-spec-defense-infra.docx",
      title: "Air Defense Simulation Infrastructure Specification",
      company: "Aerospace Defense Technologies Ltd",
      sections: [
        {
          heading: "Compute Host Nodes",
          items: [
            "60 Bare-Metal Linux Simulation Hosts (Red Hat Enterprise Linux 8/9)",
            "Total Host Server Requirement: 60 Servers",
          ],
        },
        {
          heading: "Network Switching Equipment",
          items: [
            "8 High-Speed InfiniBand and 10GbE Network Switches",
            "Total Network Components: 8 Switches",
          ],
        },
        {
          heading: "Web & Synthetic Checks",
          items: [
            "4 Web Portal availability endpoints (Basic Monitors)",
            "No Synthetic Transaction Monitors (0)",
          ],
        },
        {
          heading: "Logging & Telemetry",
          items: [
            "Monthly Ingestion Volume: 300 GB logs per month",
            "RUM pageviews: 0 (No Real User Monitoring needed)",
          ],
        },
      ],
    },
    {
      filename: "mm-spec-analytics-lake.docx",
      title: "Enterprise Data Lake & Analytics Specification",
      company: "Global Data Analytics Corp",
      sections: [
        {
          heading: "Spark and Hadoop Processing Nodes",
          items: [
            "40 Data Ingestion and ETL Compute Nodes",
            "Total Server Requirement: 40 Servers",
          ],
        },
        {
          heading: "Datacenter Interconnect Switches",
          items: [
            "6 Core Top-of-Rack Switches",
            "Total Network Component Requirement: 6 Switches",
          ],
        },
        {
          heading: "BI Reporting Portals",
          items: [
            "2 Public Analytics Dashboard URLs (Basic Monitors)",
            "1 Executive KPI Synthetic Flow (Advanced Monitor)",
          ],
        },
        {
          heading: "Log Management",
          items: [
            "Log Ingestion: 500 GB logs monthly",
            "Real User Monitoring: 0 pageviews",
          ],
        },
      ],
    },
    {
      filename: "mm-spec-payment-processor.docx",
      title: "Fintech Core Gateway Hardware Specification",
      company: "SecurePay Global Services",
      sections: [
        {
          heading: "Host Server Fleet",
          items: [
            "50 Payment Processing Application Hosts",
            "Total Host Server Requirement: 50 Servers",
          ],
        },
        {
          heading: "Switching & Routing Hardware",
          items: [
            "10 PCI-Compliant Hardware Firewalls and Core Switches",
            "Total Network Components: 10 Devices",
          ],
        },
        {
          heading: "Payment APIs & Synthetic Journeys",
          items: [
            "6 Payment Gateway Public Endpoints (Basic Monitors)",
            "3 Multi-Step Checkout Synthetic Monitors (Advanced Monitors)",
          ],
        },
        {
          heading: "Audit Logs & RUM",
          items: [
            "PCI Audit Trail Log Volume: 400 GB logs monthly",
            "RUM Pageview Volume: 2,000,000 pageviews per month",
          ],
        },
      ],
    },
    {
      filename: "mm-spec-gaming-backend.docx",
      title: "Multiplayer Gaming Backend Server Spec",
      company: "Titan Game Studios Inc",
      sections: [
        {
          heading: "Dedicated Game Matchmaker Nodes",
          items: [
            "75 Real-Time Dedicated Game Matchmaking Servers",
            "Total Host Server Requirement: 75 Servers",
          ],
        },
        {
          heading: "Low-Latency Network Gateways",
          items: [
            "12 Low-Latency Edge Routers and Switches",
            "Total Network Components: 12 Switches",
          ],
        },
        {
          heading: "Web Portals and Telemetry",
          items: [
            "8 Player Lobby and Leaderboard URLs (Basic Monitors)",
            "No Synthetic Checks (0)",
            "Player telemetry log stream: 600 GB logs monthly",
            "Web Portal RUM: 500,000 pageviews per month",
          ],
        },
      ],
    },
  ];

  for (const docxSpec of docxList) {
    const docxBuf = await createDocx(docxSpec.title, docxSpec.company, docxSpec.sections);
    writeToAll(docxSpec.filename, docxBuf);
  }

  // 5. Scanned Image-Only PDFs and Diagrams
  // Preserving high-resolution crisp diagrams and scanned PDFs generated by generate-crisp-diagrams.mjs
  console.log("Multimodal diagrams and scanned PDFs preserved from high-res generator.");

  console.log("All multimodal attachment files successfully generated and synchronized in all locations.");
}

main().catch(console.error);
