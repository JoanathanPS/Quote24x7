import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const OUTPUT_DIR = path.resolve(process.cwd(), "test-attachments");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

// 1. Generate Case-1-Production-Infrastructure.pdf
async function generatePdf() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Header banner
  page.drawRectangle({
    x: 40,
    y: height - 100,
    width: width - 80,
    height: 60,
    color: rgb(0.08, 0.12, 0.22),
  });

  page.drawText("ACME CORP - INFRASTRUCTURE MONITORING SPECIFICATION", {
    x: 55,
    y: height - 70,
    size: 14,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  page.drawText("Production Deployment Sizing & Resource Inventory", {
    x: 55,
    y: height - 88,
    size: 10,
    font,
    color: rgb(0.8, 0.85, 0.95),
  });

  let y = height - 130;

  const sections = [
    {
      title: "1. Server Fleet (Host Monitors)",
      items: [
        "• 35 Ubuntu Linux Production Web/API Nodes (c5.2xlarge on AWS)",
        "• 15 Windows Server 2022 Database & Active Directory Hosts",
        "• Total Host Server Requirement: 50 Servers",
      ],
    },
    {
      title: "2. Network Infrastructure",
      items: [
        "• 4 Cisco Catalyst 9300 Core Switches",
        "• 4 Fortinet FortiGate 100F Perimeter Firewalls",
        "• Total Network Component Requirement: 8 Network Devices",
      ],
    },
    {
      title: "3. Synthetic End-User & Website Checks",
      items: [
        "• 5 Public HTTPS Website availability monitors (5-minute polling interval)",
        "• 2 Multi-step Real Browser Synthetic Transactions (Checkout & Login flows)",
      ],
    },
    {
      title: "4. Application Logs & Performance",
      items: [
        "• Centralized Syslog and Container Logs: 20 GB per day (~600 GB monthly)",
        "• Target Billing Cycle: Annual Subscription with INR pricing",
      ],
    },
  ];

  for (const sec of sections) {
    page.drawText(sec.title, {
      x: 50,
      y,
      size: 12,
      font: boldFont,
      color: rgb(0.1, 0.3, 0.7),
    });
    y -= 18;

    for (const item of sec.items) {
      page.drawText(item, {
        x: 60,
        y,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 16;
    }
    y -= 10;
  }

  // Footer notes
  page.drawLine({
    start: { x: 50, y: 80 },
    end: { x: width - 50, y: 80 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });

  page.drawText("Confidential — For Site24x7 Automated Proposal & Sizing SOW", {
    x: 50,
    y: 65,
    size: 8,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  const filePath = path.join(OUTPUT_DIR, "Case-1-Production-Infrastructure.pdf");
  await fs.writeFile(filePath, pdfBytes);
}

// 2. Generate Case-2-Enterprise-Architecture-Spec.docx
async function generateDocx() {
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

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:b/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Enterprise Cloud Monitoring Sizing RFP</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Company: Global Logistics Technologies Ltd</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>We are evaluating Site24x7 for complete IT full-stack monitoring. Please review our infrastructure inventory below and provide an itemized proposal with transparent plan tiers.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Host Server Quota:</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>• 80 Production Host Servers (mixture of bare-metal Linux and VMware ESXi nodes)</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Network Components:</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>• 16 SNMP Network Devices (core switches, edge routers, and VPN gateways)</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Digital Experience &amp; Synthetics:</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>• 10 Advanced Synthetic Transaction Monitors across 8 global geographies</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>• 1,000,000 Real User Monitoring (RUM) pageviews per month</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>Log Management:</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>• 100 GB per day log ingestion with 30-day search retention</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

  zip.file("[Content_Types].xml", contentTypesXml);
  zip.folder("_rels").file(".rels", relsXml);
  zip.folder("word").file("document.xml", documentXml);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const filePath = path.join(OUTPUT_DIR, "Case-2-Enterprise-Architecture-Spec.docx");
  await fs.writeFile(filePath, buffer);
}

// 3. Generate Case-3-Server-Inventory.csv
async function generateCsv() {
  const rows = [
    ["Hostname", "OS", "Environment", "Role", "IP Address", "Sizing Unit"],
    ["web-prod-01", "Ubuntu Linux 22.04", "Production", "Frontend Web Server", "10.0.1.11", "Host Server"],
    ["web-prod-02", "Ubuntu Linux 22.04", "Production", "Frontend Web Server", "10.0.1.12", "Host Server"],
    ["web-prod-03", "Ubuntu Linux 22.04", "Production", "Frontend Web Server", "10.0.1.13", "Host Server"],
    ["api-prod-01", "Debian Linux 12", "Production", "REST Microservices", "10.0.2.21", "Host Server"],
    ["api-prod-02", "Debian Linux 12", "Production", "REST Microservices", "10.0.2.22", "Host Server"],
    ["api-prod-03", "Debian Linux 12", "Production", "REST Microservices", "10.0.2.23", "Host Server"],
    ["api-prod-04", "Debian Linux 12", "Production", "REST Microservices", "10.0.2.24", "Host Server"],
    ["db-primary-01", "Red Hat Enterprise 9", "Production", "PostgreSQL Primary", "10.0.3.31", "Host Server"],
    ["db-replica-01", "Red Hat Enterprise 9", "Production", "PostgreSQL Standby", "10.0.3.32", "Host Server"],
    ["db-replica-02", "Red Hat Enterprise 9", "Production", "PostgreSQL Standby", "10.0.3.33", "Host Server"],
    ["redis-cache-01", "Ubuntu Linux 22.04", "Production", "Redis Cluster", "10.0.4.41", "Host Server"],
    ["redis-cache-02", "Ubuntu Linux 22.04", "Production", "Redis Cluster", "10.0.4.42", "Host Server"],
    ["kafka-broker-01", "Ubuntu Linux 22.04", "Production", "Event Stream", "10.0.5.51", "Host Server"],
    ["kafka-broker-02", "Ubuntu Linux 22.04", "Production", "Event Stream", "10.0.5.52", "Host Server"],
    ["kafka-broker-03", "Ubuntu Linux 22.04", "Production", "Event Stream", "10.0.5.53", "Host Server"],
    ["win-ad-01", "Windows Server 2022", "Production", "Domain Controller", "10.0.6.61", "Host Server"],
    ["win-ad-02", "Windows Server 2022", "Production", "Domain Controller", "10.0.6.62", "Host Server"],
    ["win-file-01", "Windows Server 2022", "Production", "Corporate Storage", "10.0.6.63", "Host Server"],
    ["lb-external-01", "Alpine Linux", "Edge", "NGINX Reverse Proxy", "10.0.0.1", "Host Server"],
    ["lb-external-02", "Alpine Linux", "Edge", "NGINX Reverse Proxy", "10.0.0.2", "Host Server"],
  ];

  const csvContent = rows.map((r) => r.join(",")).join("\n");
  const filePath = path.join(OUTPUT_DIR, "Case-3-Server-Inventory.csv");
  await fs.writeFile(filePath, csvContent, "utf-8");
}

// 4. Generate Case-4-Hardware-Devices-Inventory.xlsx
async function generateXlsx() {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Servers (25 hosts)
  const serverData = [
    ["Device ID", "Name", "OS", "CPU Cores", "RAM GB", "Billable Unit"],
    ...Array.from({ length: 25 }, (_, i) => [
      `SRV-${100 + i}`,
      `prod-app-${String(i + 1).padStart(2, "0")}`,
      i % 4 === 0 ? "Windows Server 2022" : "Ubuntu Linux 24.04",
      8,
      32,
      "Host Monitor",
    ]),
  ];
  const serverSheet = XLSX.utils.aoa_to_sheet(serverData);
  XLSX.utils.book_append_sheet(workbook, serverSheet, "Servers");

  // Sheet 2: Network Devices (8 switches & firewalls)
  const networkData = [
    ["Asset ID", "Device Name", "Model", "IP", "SNMP Version", "Billable Unit"],
    ["NET-01", "core-switch-alpha", "Cisco Catalyst 9300", "192.168.1.1", "v3", "Network Component"],
    ["NET-02", "core-switch-beta", "Cisco Catalyst 9300", "192.168.1.2", "v3", "Network Component"],
    ["NET-03", "dist-switch-floor1", "Aruba CX 6200", "192.168.1.11", "v2c", "Network Component"],
    ["NET-04", "dist-switch-floor2", "Aruba CX 6200", "192.168.1.12", "v2c", "Network Component"],
    ["NET-05", "fw-primary", "Fortinet FortiGate 200F", "192.168.0.1", "v3", "Network Component"],
    ["NET-06", "fw-standby", "Fortinet FortiGate 200F", "192.168.0.2", "v3", "Network Component"],
    ["NET-07", "router-isp-primary", "Juniper MX204", "198.51.100.1", "v3", "Network Component"],
    ["NET-08", "router-isp-backup", "Juniper MX204", "198.51.100.2", "v3", "Network Component"],
  ];
  const networkSheet = XLSX.utils.aoa_to_sheet(networkData);
  XLSX.utils.book_append_sheet(workbook, networkSheet, "Network Devices");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const filePath = path.join(OUTPUT_DIR, "Case-4-Hardware-Devices-Inventory.xlsx");
  await fs.writeFile(filePath, buffer);
}

// 5. Generate Case-5-Scanned-Image-Only.pdf
async function generateScannedPdf() {
  const pdfDoc = await PDFDocument.create();
  // Empty page with no text stream (simulates scanned flat document)
  pdfDoc.addPage([595, 842]);
  const pdfBytes = await pdfDoc.save();
  const filePath = path.join(OUTPUT_DIR, "Case-5-Scanned-Image-Only.pdf");
  await fs.writeFile(filePath, pdfBytes);
}

// 6. Generate Case-6-Quick-Requirements.txt
async function generateTxt() {
  const content = `Hi Site24x7 Team,

We are looking to migrate from Datadog to Site24x7 to optimize monitoring costs.
Here is what our DevOps team manages:

1. Host Servers:
   - 28 Linux EC2 instances running microservices
   - 4 Windows SQL Servers

2. Network & Edge:
   - 6 Cisco switches in our primary colocation facility

3. Public Endpoints:
   - 8 public website URLs monitored every 1 minute
   - 3 Synthetic browser checkout scripts

4. Application Logs:
   - Approximately 15 GB/day of application logs

Please send us an official annual proposal breakdown in INR.

Best regards,
DevOps Lead, FinEdge Solutions`;

  const filePath = path.join(OUTPUT_DIR, "Case-6-Quick-Requirements.txt");
  await fs.writeFile(filePath, content, "utf-8");
}

// 7. Generate Case-7-Product-Entitlements-Guide.md
async function generateMd() {
  const content = `# Site24x7 Enterprise Entitlements & Rate Card Matrix

## Plan Allowances
- **Lite Plan**: Includes 2 Basic Monitors, 0 Advanced Synthetic Monitors.
- **Professional Plan**: Includes 5 Basic Monitors, 1 Advanced Synthetic Monitor.
- **Enterprise Plan**: Includes 50 Basic Monitors, 10 Advanced Synthetic Monitors, and 500 RUM pageviews.

## Add-on Rates & Pack Sizes (INR)
- **Host Monitor Pack (10 servers)**: ₹25,650 / year
- **Advanced Synthetic Pack (10 monitors)**: ₹15,000 / year
- **Network Interface Pack (10 interfaces)**: ₹7,500 / year
- **AppLogs Storage Pack (10 GB/day)**: ₹12,000 / year

## Availability SLA Guarantee
All Enterprise and Professional tiers operate under a 99.95% monitoring uptime SLA across all 120+ global probe locations.`;

  const filePath = path.join(OUTPUT_DIR, "Case-7-Product-Entitlements-Guide.md");
  await fs.writeFile(filePath, content, "utf-8");
}

async function main() {
  console.log("Generating test attachments in 'test-attachments/' directory...");
  await ensureDir(OUTPUT_DIR);
  await generatePdf();
  await generateDocx();
  await generateCsv();
  await generateXlsx();
  await generateScannedPdf();
  await generateTxt();
  await generateMd();
  console.log("All 7 test attachment files created successfully!");
}

main().catch(console.error);
