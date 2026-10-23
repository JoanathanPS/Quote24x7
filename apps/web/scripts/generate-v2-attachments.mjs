import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const attachmentsDir = path.resolve(process.cwd(), "test-attachments");
if (!fs.existsSync(attachmentsDir)) {
  fs.mkdirSync(attachmentsDir, { recursive: true });
}

// 1. Helper to generate CSV
function writeCsv(filename, rows) {
  const content = rows.map((r) => r.join(",")).join("\n");
  fs.writeFileSync(path.join(attachmentsDir, filename), content, "utf8");
}

// 2. Helper to generate XLSX
function writeXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  XLSX.writeFile(wb, path.join(attachmentsDir, filename));
}

// 3. Helper to generate searchable text PDF
async function writeTextPdf(filename, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595.28, 841.89]); // A4
  let y = 800;

  for (const item of lines) {
    if (y < 60) {
      page = doc.addPage([595.28, 841.89]);
      y = 800;
    }
    const isHeader = item.startsWith("# ");
    const text = isHeader ? item.slice(2) : item;
    const f = isHeader ? boldFont : font;
    const size = isHeader ? 14 : 10;
    page.drawText(text, { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= size + 6;
  }

  const bytes = await doc.save();
  fs.writeFileSync(path.join(attachmentsDir, filename), Buffer.from(bytes));
}

// 4. Helper to generate image-only (scanned raster) PDF
async function writeImageOnlyPdf(filename) {
  const doc = await PDFDocument.create();
  // 1x1 white pixel PNG data URL buffer
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  const pngImage = await doc.embedPng(Buffer.from(pngBase64, "base64"));
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(pngImage, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const bytes = await doc.save();
  fs.writeFileSync(path.join(attachmentsDir, filename), Buffer.from(bytes));
}

// 5. Helper to generate 1x1 valid PNG image
function writeImage(filename) {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  fs.writeFileSync(path.join(attachmentsDir, filename), Buffer.from(pngBase64, "base64"));
}

async function main() {
  console.log("Generating multimodal test fixtures in:", attachmentsDir);

  // CSV Files (8 new)
  writeCsv("mm-inventory-fintech.csv", [
    ["Hostname", "Role", "Environment", "IP", "Status"],
    ...Array.from({ length: 45 }, (_, i) => [`app-fin-${i + 1}`, "Host Server", "Production", `10.0.1.${i + 10}`, "Active"]),
    ["fw-core-01", "Network Firewall", "DMZ", "10.0.0.1", "Active"],
    ["sw-dist-01", "Network Switch", "Core", "10.0.0.2", "Active"],
    ["sw-dist-02", "Network Switch", "Core", "10.0.0.3", "Active"],
  ]);

  writeCsv("mm-inventory-healthcare.csv", [
    ["DeviceID", "Type", "Location", "IP Address"],
    ...Array.from({ length: 60 }, (_, i) => [`HL7-NODE-${i + 1}`, "Production Server", "Hospital-Main", `192.168.10.${i + 1}`]),
    ["CORE-RTR-01", "Network Router", "DataCenter", "192.168.1.1"],
    ["CORE-SW-01", "Network Switch", "DataCenter", "192.168.1.2"],
  ]);

  writeCsv("mm-inventory-ecommerce.csv", [
    ["Host", "OS", "Type", "Rack"],
    ...Array.from({ length: 35 }, (_, i) => [`ec-node-${i + 1}`, "Ubuntu 22.04", "VM Instance", "Rack-B1"]),
    ["edge-gw-01", "Junos", "Network Switch", "Rack-A1"],
    ["edge-gw-02", "Junos", "Network Switch", "Rack-A2"],
  ]);

  writeCsv("mm-inventory-saas.csv", [
    ["Server Name", "Function", "Tier", "Monitoring Target"],
    ...Array.from({ length: 90 }, (_, i) => [`saas-worker-${i + 1}`, "Worker Node", "Production", "Host Server"]),
    ["sw-access-01", "Switch", "Infrastructure", "Network Switch"],
    ["sw-access-02", "Switch", "Infrastructure", "Network Switch"],
    ["sw-access-03", "Switch", "Infrastructure", "Network Switch"],
    ["sw-access-04", "Switch", "Infrastructure", "Network Switch"],
  ]);

  writeCsv("mm-inventory-telecom.csv", [
    ["Node", "Class", "IP", "Site"],
    ...Array.from({ length: 110 }, (_, i) => [`telco-bng-${i + 1}`, "Compute Host", `172.16.20.${i + 1}`, "PoP-Delhi"]),
    ...Array.from({ length: 15 }, (_, i) => [`telco-sw-${i + 1}`, "Network Switch", `172.16.10.${i + 1}`, "PoP-Delhi"]),
  ]);

  writeCsv("mm-inventory-media.csv", [
    ["Asset ID", "Classification", "FQDN"],
    ...Array.from({ length: 28 }, (_, i) => [`MEDIA-ENC-${i + 1}`, "Transcoding Server", `enc-${i + 1}.media.tv`]),
    ["SW-MEDIA-01", "Network Switch", "sw1.media.tv"],
    ["SW-MEDIA-02", "Network Switch", "sw2.media.tv"],
  ]);

  writeCsv("mm-inventory-logistics.csv", [
    ["Host", "Role", "Subnet"],
    ...Array.from({ length: 55 }, (_, i) => [`wh-node-${i + 1}`, "Warehouse Host", `10.200.1.${i + 1}`]),
    ["wh-switch-01", "Network Switch", "10.200.0.1"],
    ["wh-switch-02", "Network Switch", "10.200.0.2"],
  ]);

  writeCsv("mm-inventory-energy.csv", [
    ["System", "Device Class", "Zone"],
    ...Array.from({ length: 75 }, (_, i) => [`scada-srv-${i + 1}`, "Industrial Server", "Substation-A"]),
    ...Array.from({ length: 6 }, (_, i) => [`scada-sw-${i + 1}`, "Network Switch", "Substation-A"]),
  ]);

  // XLSX Files (5 new)
  writeXlsx("mm-datacenter-audit.xlsx", {
    "Servers": [
      ["Asset Tag", "Host Type", "CPU Cores", "RAM GB", "Environment"],
      ...Array.from({ length: 65 }, (_, i) => [`TAG-SRV-${i + 1}`, "Production Linux Host", "16", "64", "Prod"]),
    ],
    "Network Equipment": [
      ["Switch ID", "Model", "Ports", "Location"],
      ...Array.from({ length: 8 }, (_, i) => [`SW-CORE-${i + 1}`, "Cisco Catalyst 9300", "48", "DC-Row-1"]),
    ],
  });

  writeXlsx("mm-cloud-migration.xlsx", {
    "EC2 Instances": [
      ["Instance ID", "Name", "Type"],
      ...Array.from({ length: 40 }, (_, i) => [`i-0a8b9c${i + 100}`, `srv-mig-${i + 1}`, "Host Server"]),
    ],
    "Virtual Routers": [
      ["Router ID", "VPC", "Role"],
      ...Array.from({ length: 5 }, (_, i) => [`rt-0987${i}`, "vpc-prod-01", "Network Switch"]),
    ],
  });

  writeXlsx("mm-switch-fabric.xlsx", {
    "Fabric Nodes": [
      ["Node", "Role", "Ports"],
      ...Array.from({ length: 20 }, (_, i) => [`spine-${i + 1}`, "Network Switch", "32x100G"]),
    ],
    "Compute Nodes": [
      ["Server", "Type", "OS"],
      ...Array.from({ length: 30 }, (_, i) => [`blade-${i + 1}`, "Host Server", "RHEL 9"]),
    ],
  });

  writeXlsx("mm-hybrid-workloads.xlsx", {
    "On-Prem Baremetal": [
      ["Hostname", "Serial", "Category"],
      ...Array.from({ length: 50 }, (_, i) => [`bm-srv-${i + 1}`, `SN-${i + 1000}`, "Host Server"]),
    ],
    "Core Networking": [
      ["Device", "Role"],
      ...Array.from({ length: 10 }, (_, i) => [`firewall-${i + 1}`, "Network Component"]),
    ],
  });

  writeXlsx("mm-multi-region-servers.xlsx", {
    "APAC Region": [
      ["Server Name", "Zone"],
      ...Array.from({ length: 40 }, (_, i) => [`apac-srv-${i + 1}`, "ap-south-1"]),
    ],
    "EMEA Region": [
      ["Server Name", "Zone"],
      ...Array.from({ length: 35 }, (_, i) => [`emea-srv-${i + 1}`, "eu-west-1"]),
    ],
    "Switches": [
      ["Switch Name", "Zone"],
      ...Array.from({ length: 6 }, (_, i) => [`sw-global-${i + 1}`, "Global"]),
    ],
  });

  // PDF RFPs (11 new)
  await writeTextPdf("mm-rfp-government-cloud.pdf", [
    "# TENDER SPECIFICATION: GOV-CLOUD MONITORING",
    "Section 1: Scope of Work",
    "The vendor shall provide 24x7 monitoring for 150 Host Servers in Government Data Center 1.",
    "The infrastructure includes 12 Core Network Switches and Routers.",
    "Web availability checks required for 20 public portal URLs (basic website monitors).",
    "Advanced synthetic real-browser transaction checks: 4 transactions.",
    "Log aggregation volume: 800 GB logs per month.",
    "Real User Monitoring: 0 pageviews (no RUM required).",
  ]);

  await writeTextPdf("mm-rfp-banking-cluster.pdf", [
    "# BANKING INFRASTRUCTURE OBSERVABILITY RFP",
    "1. Infrastructure Requirements:",
    "Core banking virtual machine cluster: 80 servers / host monitors.",
    "Redundant network components: 16 network switches and firewalls.",
    "Public banking portal: 8 basic monitors for HTTPS status.",
    "Critical login journey synthetic checks: 6 advanced monitors.",
    "Centralized security log ingestion: 1200 GB logs monthly.",
    "End-user RUM: Not required (0 pageviews).",
  ]);

  await writeTextPdf("mm-rfp-retail-pos.pdf", [
    "# RETAIL ENTERPRISE MONITORING SIZING",
    "Store controllers: 120 servers.",
    "In-store network gateways: 24 network components.",
    "E-commerce storefronts: 15 basic website monitors.",
    "Synthetic checkout tests: 5 advanced monitors.",
    "Monthly POS application logs: 500 GB logs.",
    "RUM tracking: 2,000,000 real user pageviews per month.",
  ]);

  await writeTextPdf("mm-rfp-hospital-network.pdf", [
    "# HEALTHCARE INFORMATION SYSTEM RFQ",
    "Patient record database servers: 40 servers.",
    "Hospital LAN switches: 8 network components.",
    "Public telemedicine website: 5 basic monitors.",
    "No synthetic checks, no RUM.",
    "Diagnostic audit logs: 300 GB logs monthly.",
  ]);

  await writeTextPdf("mm-rfp-university-campus.pdf", [
    "# CAMPUS IT INFRASTRUCTURE MONITORING",
    "Departmental Linux servers: 60 servers.",
    "Building distribution switches: 15 network components.",
    "Student portal URLs: 10 basic monitors.",
    "No synthetic transactions, no RUM.",
    "System log retention: 250 GB logs per month.",
  ]);

  await writeTextPdf("mm-rfp-fintech-gateway.pdf", [
    "# PAYMENT SWITCH PERFORMANCE MONITORING",
    "Transaction processing hosts: 50 servers.",
    "Hardware security module switches: 10 network components.",
    "Merchant API endpoints: 12 basic monitors.",
    "Synthetic payment flow: 4 advanced monitors.",
    "Audit log retention: 600 GB logs monthly.",
    "RUM: None (0 pageviews).",
  ]);

  await writeTextPdf("mm-rfp-smartcity-iot.pdf", [
    "# SMART CITY IOT BROKER SIZING",
    "Telemetry collector VMs: 70 servers.",
    "IoT edge gateway switches: 20 network components.",
    "Citizen portal websites: 6 basic monitors.",
    "No synthetic monitors, no RUM.",
    "Device log stream: 1000 GB logs monthly.",
  ]);

  await writeTextPdf("mm-rfp-airline-ops.pdf", [
    "# AIRLINE OPERATIONS DISPATCH SYSTEM",
    "Flight dispatch compute nodes: 45 servers.",
    "Airport terminal network switches: 12 network components.",
    "Flight status public URLs: 8 basic monitors.",
    "Booking flow synthetic checks: 3 advanced monitors.",
    "Operational logs: 400 GB logs per month.",
    "Passenger portal RUM: 1,500,000 pageviews per month.",
  ]);

  await writeTextPdf("mm-rfp-automotive-mfg.pdf", [
    "# AUTOMOTIVE FACTORY TELEMETRY",
    "Assembly line control servers: 55 servers.",
    "Industrial Ethernet switches: 14 network components.",
    "Supplier extranet websites: 4 basic monitors.",
    "No synthetic checks, no RUM.",
    "Quality inspection log volume: 350 GB logs per month.",
  ]);

  await writeTextPdf("mm-rfp-telco-core.pdf", [
    "# 5G CORE NETWORK MONITORING SPEC",
    "Control plane compute hosts: 100 servers.",
    "Data center spine switches: 25 network components.",
    "Subscriber self-service portal: 10 basic monitors.",
    "No synthetic monitors, no RUM.",
    "Signaling logs: 1500 GB logs monthly.",
  ]);

  await writeTextPdf("mm-rfp-insurance-portal.pdf", [
    "# INSURANCE CLAIMS ENGINE RFP",
    "Claims adjudication hosts: 35 servers.",
    "Office branch network switches: 7 network components.",
    "Policyholder portal URLs: 6 basic monitors.",
    "Policy issuance synthetic test: 2 advanced monitors.",
    "Application event logs: 200 GB logs monthly.",
    "Claims portal RUM: 500,000 pageviews per month.",
  ]);

  // Scanned Image-Only PDFs (3 new)
  await writeImageOnlyPdf("mm-scanned-po-handwritten.pdf");
  await writeImageOnlyPdf("mm-scanned-invoice-receipt.pdf");
  await writeImageOnlyPdf("mm-scanned-faxed-scope.pdf");

  // Word DOCX copies (using existing Case-2 as source)
  const docxSource = path.join(attachmentsDir, "Case-2-Enterprise-Architecture-Spec.docx");
  if (fs.existsSync(docxSource)) {
    fs.copyFileSync(docxSource, path.join(attachmentsDir, "mm-spec-defense-infra.docx"));
    fs.copyFileSync(docxSource, path.join(attachmentsDir, "mm-spec-analytics-lake.docx"));
    fs.copyFileSync(docxSource, path.join(attachmentsDir, "mm-spec-payment-processor.docx"));
    fs.copyFileSync(docxSource, path.join(attachmentsDir, "mm-spec-gaming-backend.docx"));
  }

  // Network Diagrams (4 new)
  writeImage("mm-diagram-aws-multi-tier.png");
  writeImage("mm-diagram-azure-hub-spoke.png");
  writeImage("mm-diagram-gcp-kubernetes.png");
  writeImage("mm-diagram-hybrid-sdwan.jpg");

  console.log("All multimodal attachment fixtures generated successfully.");
}

main().catch(console.error);
