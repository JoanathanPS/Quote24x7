import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const targetDirs = [
  path.resolve(process.cwd(), 'test-attachments'),
  path.resolve(process.cwd(), 'apps', 'web', 'test-attachments'),
  path.resolve(process.cwd(), '..', 'test-attachments')
].filter((d, i, arr) => arr.indexOf(d) === i);

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeToAll(filename, buffer) {
  for (const dir of targetDirs) {
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
  console.log(`Saved ${filename} (${(buffer.length / 1024).toFixed(1)} KB) to all attachment directories.`);
}

// -------------------------------------------------------------
// 1. Azure Hub & Spoke Topology Diagram
// -------------------------------------------------------------
const azureSvg = `
<svg width="1000" height="700" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#070c18" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="hubGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0.05" />
    </linearGradient>
    <linearGradient id="spoke1Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#059669" stop-opacity="0.05" />
    </linearGradient>
    <linearGradient id="spoke2Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#6d28d9" stop-opacity="0.05" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1000" height="700" fill="url(#bg)" />

  <!-- Grid lines -->
  <g stroke="#1e293b" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.6">
    <line x1="50" y1="0" x2="50" y2="700" />
    <line x1="200" y1="0" x2="200" y2="700" />
    <line x1="350" y1="0" x2="350" y2="700" />
    <line x1="500" y1="0" x2="500" y2="700" />
    <line x1="650" y1="0" x2="650" y2="700" />
    <line x1="800" y1="0" x2="800" y2="700" />
    <line x1="950" y1="0" x2="950" y2="700" />
  </g>

  <!-- Header Header -->
  <rect x="50" y="30" width="900" height="60" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1" />
  <text x="75" y="65" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#38bdf8">Microsoft Azure — Hub &amp; Spoke Enterprise Network Topology</text>
  <text x="75" y="82" font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="#94a3b8">Production Deployment Sizing Architecture • Subscription: prod-core-eastus-01</text>
  <rect x="800" y="45" width="130" height="28" rx="14" fill="#0369a1" />
  <text x="865" y="64" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle">VERIFIED V2</text>

  <!-- Peering Connectors -->
  <path d="M 500 280 L 265 420" stroke="#0ea5e9" stroke-width="2.5" stroke-dasharray="6 4" fill="none" opacity="0.8" />
  <path d="M 500 280 L 735 420" stroke="#0ea5e9" stroke-width="2.5" stroke-dasharray="6 4" fill="none" opacity="0.8" />
  <circle cx="500" cy="280" r="5" fill="#38bdf8" />
  <circle cx="265" cy="420" r="5" fill="#10b981" />
  <circle cx="735" cy="420" r="5" fill="#a855f7" />

  <!-- HUB VNET CONTAINER -->
  <rect x="250" y="110" width="500" height="230" rx="12" fill="url(#hubGrad)" stroke="#0284c7" stroke-width="2" />
  <rect x="270" y="125" width="160" height="24" rx="4" fill="#0284c7" />
  <text x="280" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">HUB VNET (10.0.0.0/16)</text>
  <text x="440" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#93c5fd">Central Network &amp; Security Perimeter</text>

  <!-- Hub Items Cards -->
  <g transform="translate(270, 160)">
    <!-- Azure Firewall -->
    <rect x="0" y="0" width="220" height="70" rx="8" fill="url(#cardGrad)" stroke="#38bdf8" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Azure Firewall (Standard)</text>
    <text x="15" y="44" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8">2 Appliances</text>
    <text x="15" y="60" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Active/Active High Availability</text>

    <!-- VPN Gateway -->
    <rect x="240" y="0" width="220" height="70" rx="8" fill="url(#cardGrad)" stroke="#38bdf8" stroke-width="1.5" />
    <text x="255" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Virtual Network Gateways</text>
    <text x="255" y="44" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8">2 Gateways</text>
    <text x="255" y="60" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">1 ExpressRoute + 1 S2S VPN</text>

    <!-- Log Analytics & Monitoring -->
    <rect x="0" y="85" width="220" height="70" rx="8" fill="url(#cardGrad)" stroke="#38bdf8" stroke-width="1.5" />
    <text x="15" y="109" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Azure Monitor / Log Analytics</text>
    <text x="15" y="129" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8">1 Workspace</text>
    <text x="15" y="145" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Central Diagnostics Ingestion</text>

    <!-- Bastion & Core Routing -->
    <rect x="240" y="85" width="220" height="70" rx="8" fill="url(#cardGrad)" stroke="#38bdf8" stroke-width="1.5" />
    <text x="255" y="109" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Core Routing &amp; Peering Hub</text>
    <text x="255" y="129" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#38bdf8">4 Network Devices</text>
    <text x="255" y="145" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">BGP Routes &amp; ExpressRoute Circuit</text>
  </g>

  <!-- SPOKE 1 CONTAINER: APPLICATION TIER -->
  <rect x="50" y="370" width="430" height="290" rx="12" fill="url(#spoke1Grad)" stroke="#10b981" stroke-width="2" />
  <rect x="70" y="385" width="180" height="24" rx="4" fill="#059669" />
  <text x="80" y="402" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">SPOKE 1: APPLICATION TIER</text>
  <text x="260" y="402" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#a7f3d0">(10.1.0.0/16)</text>

  <!-- Spoke 1 Cards -->
  <g transform="translate(70, 420)">
    <rect x="0" y="0" width="390" height="65" rx="8" fill="url(#cardGrad)" stroke="#10b981" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Ubuntu Linux Production Servers (Standard_D4s_v5)</text>
    <text x="15" y="45" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#34d399">14 Host Servers</text>
    <text x="15" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Node.js API Microservices &amp; Web Workers</text>

    <rect x="0" y="75" width="390" height="65" rx="8" fill="url(#cardGrad)" stroke="#10b981" stroke-width="1.5" />
    <text x="15" y="99" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Application Load Balancers &amp; Ingress</text>
    <text x="15" y="120" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#34d399">2 Load Balancers</text>
    <text x="15" y="133" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Azure Standard Public &amp; Internal ALBs</text>

    <rect x="0" y="150" width="390" height="75" rx="8" fill="url(#cardGrad)" stroke="#10b981" stroke-width="1.5" />
    <text x="15" y="174" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Public Web Portals &amp; Endpoints</text>
    <text x="15" y="195" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#34d399">4 Public Endpoints (Web Portals)</text>
    <text x="15" y="210" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">api.quote24x7.com • portal.quote24x7.com • auth • cdn</text>
  </g>

  <!-- SPOKE 2 CONTAINER: DATABASE & DATA TIER -->
  <rect x="520" y="370" width="430" height="290" rx="12" fill="url(#spoke2Grad)" stroke="#8b5cf6" stroke-width="2" />
  <rect x="540" y="385" width="180" height="24" rx="4" fill="#7c3aed" />
  <text x="550" y="402" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">SPOKE 2: DATABASE &amp; DATA</text>
  <text x="730" y="402" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#ddd6fe">(10.2.0.0/16)</text>

  <!-- Spoke 2 Cards -->
  <g transform="translate(540, 420)">
    <rect x="0" y="0" width="390" height="65" rx="8" fill="url(#cardGrad)" stroke="#a855f7" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Azure Database for PostgreSQL Flexible Server</text>
    <text x="15" y="45" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#c084fc">4 Database Clusters (Servers)</text>
    <text x="15" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">High Availability Zone Redundant Replication</text>

    <rect x="0" y="75" width="390" height="65" rx="8" fill="url(#cardGrad)" stroke="#a855f7" stroke-width="1.5" />
    <text x="15" y="99" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Azure Cache for Redis (Premium Tier)</text>
    <text x="15" y="120" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#c084fc">2 Managed Clusters</text>
    <text x="15" y="133" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Session store &amp; fast distributed cache</text>

    <rect x="0" y="150" width="390" height="75" rx="8" fill="url(#cardGrad)" stroke="#a855f7" stroke-width="1.5" />
    <text x="15" y="174" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Diagnostics Telemetry &amp; Log Export</text>
    <text x="15" y="195" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#c084fc">450 GB / Month Log Stream</text>
    <text x="15" y="210" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">PostgreSQL audit logs + NGINX access telemetry</text>
  </g>
</svg>
`;

// -------------------------------------------------------------
// 2. AWS 3-Tier Diagram
// -------------------------------------------------------------
const awsSvg = `
<svg width="1000" height="700" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgAws" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1120" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <linearGradient id="awsCard" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>

  <rect width="1000" height="700" fill="url(#bgAws)" />

  <!-- Header Header -->
  <rect x="50" y="30" width="900" height="60" rx="8" fill="#1e293b" stroke="#f97316" stroke-width="1.5" />
  <text x="75" y="65" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#fb923c">Amazon Web Services — 3-Tier Enterprise Infrastructure Architecture</text>
  <text x="75" y="82" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#cbd5e1">Region: us-east-1 (N. Virginia) • Auto Scaling Production Environment</text>
  <rect x="800" y="45" width="130" height="28" rx="14" fill="#ea580c" />
  <text x="865" y="64" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle">AWS VERIFIED</text>

  <!-- Flow Lines -->
  <path d="M 500 220 L 500 260" stroke="#fb923c" stroke-width="3" stroke-dasharray="4 4" />
  <path d="M 500 390 L 500 430" stroke="#38bdf8" stroke-width="3" stroke-dasharray="4 4" />

  <!-- TIER 1: PUBLIC WEB & INGRESS -->
  <rect x="50" y="110" width="900" height="130" rx="10" fill="#1e293b" stroke="#f97316" stroke-width="1.5" />
  <rect x="70" y="125" width="160" height="24" rx="4" fill="#ea580c" />
  <text x="80" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">TIER 1: WEB INGRESS</text>
  <text x="240" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#fdba74">CloudFront + Route 53 + Application Load Balancers</text>

  <g transform="translate(70, 160)">
    <rect x="0" y="0" width="260" height="65" rx="6" fill="#0f172a" stroke="#fb923c" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Application Load Balancers</text>
    <text x="15" y="45" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#fdba74">4 ALBs (Network)</text>
    <text x="15" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8">Multi-AZ Internet Ingress</text>

    <rect x="280" y="0" width="260" height="65" rx="6" fill="#0f172a" stroke="#fb923c" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(280,0)">Public Web Endpoints</text>
    <text x="15" y="45" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#fdba74" transform="translate(280,0)">4 URLs (Basic Monitors)</text>
    <text x="15" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8" transform="translate(280,0)">Global Availability Probes</text>

    <rect x="560" y="0" width="300" height="65" rx="6" fill="#0f172a" stroke="#fb923c" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(560,0)">NAT Gateways &amp; Transit</text>
    <text x="15" y="45" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="#fdba74" transform="translate(560,0)">2 NAT Gateways</text>
    <text x="15" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#94a3b8" transform="translate(560,0)">Egress Security &amp; Elastic IPs</text>
  </g>

  <!-- TIER 2: COMPUTE & APPLICATION SERVERS -->
  <rect x="50" y="260" width="900" height="150" rx="10" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />
  <rect x="70" y="275" width="180" height="24" rx="4" fill="#0284c7" />
  <text x="80" y="292" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">TIER 2: COMPUTE SERVERS</text>
  <text x="260" y="292" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#7dd3fc">EC2 Auto Scaling Fleet &amp; Worker Services</text>

  <g transform="translate(70, 310)">
    <rect x="0" y="0" width="410" height="80" rx="6" fill="#0f172a" stroke="#38bdf8" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Production Linux EC2 Instances (m6i.xlarge)</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#38bdf8">18 Compute Host Servers</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8">12 Core Backend API Servers + 6 Background Workers</text>

    <rect x="440" y="0" width="420" height="80" rx="6" fill="#0f172a" stroke="#38bdf8" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(440,0)">ElastiCache Cluster (Redis 7.0)</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#38bdf8" transform="translate(440,0)">4 Cache Nodes (Servers)</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8" transform="translate(440,0)">Primary / Replica replication across 2 Availability Zones</text>
  </g>

  <!-- TIER 3: DATABASE, STORAGE & LOGGING -->
  <rect x="50" y="430" width="900" height="230" rx="10" fill="#1e293b" stroke="#10b981" stroke-width="1.5" />
  <rect x="70" y="445" width="200" height="24" rx="4" fill="#059669" />
  <text x="80" y="462" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">TIER 3: DATA &amp; TELEMETRY</text>
  <text x="280" y="462" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#6ee7b7">Aurora PostgreSQL + S3 + CloudWatch Logs</text>

  <g transform="translate(70, 480)">
    <rect x="0" y="0" width="410" height="80" rx="6" fill="#0f172a" stroke="#10b981" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Amazon Aurora Multi-AZ Cluster</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#34d399">4 Database Instances</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8">1 Writer Node + 3 Multi-AZ Read Replicas</text>

    <rect x="440" y="0" width="420" height="80" rx="6" fill="#0f172a" stroke="#10b981" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(440,0)">CloudWatch Log Groups &amp; Telemetry</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#34d399" transform="translate(440,0)">350 GB / Month Log Volume</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8" transform="translate(440,0)">VPC Flow Logs, Application Logs &amp; Audit Trail</text>

    <rect x="0" y="95" width="860" height="45" rx="6" fill="#0f172a" stroke="#334155" stroke-width="1" />
    <text x="15" y="123" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#94a3b8">Synthetic Transaction Journey: 1 Checkout Flow (Advanced Monitor) • Real User Monitoring: 1,000,000 pageviews/mo</text>
  </g>
</svg>
`;

// -------------------------------------------------------------
// 3. GCP Kubernetes Diagram
// -------------------------------------------------------------
const gcpSvg = `
<svg width="1000" height="700" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg">
  <rect width="1000" height="700" fill="#0b1329" />
  
  <rect x="50" y="30" width="900" height="60" rx="8" fill="#172554" stroke="#60a5fa" stroke-width="1.5" />
  <text x="75" y="65" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#93c5fd">Google Cloud Platform — Regional GKE &amp; Microservices Architecture</text>
  <text x="75" y="82" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#bfdbfe">Cluster: gke-prod-us-central1 • Dual Zone Autoscaling</text>
  <rect x="800" y="45" width="130" height="28" rx="14" fill="#2563eb" />
  <text x="865" y="64" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="middle">GCP VERIFIED</text>

  <!-- GKE Container -->
  <rect x="50" y="110" width="900" height="260" rx="12" fill="#1e293b" stroke="#3b82f6" stroke-width="2" />
  <rect x="70" y="125" width="180" height="24" rx="4" fill="#2563eb" />
  <text x="80" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">GKE NODE POOLS</text>
  <text x="260" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#93c5fd">Compute Engine Managed Instance Groups</text>

  <g transform="translate(70, 165)">
    <rect x="0" y="0" width="410" height="90" rx="8" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc">GKE Primary Worker Nodes (e2-standard-4)</text>
    <text x="15" y="52" font-family="'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="bold" fill="#60a5fa">24 Compute Servers</text>
    <text x="15" y="74" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8">Linux Container-Optimized OS Hosts</text>

    <rect x="440" y="0" width="420" height="90" rx="8" fill="#0f172a" stroke="#60a5fa" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc" transform="translate(440,0)">Cloud Load Balancers &amp; Ingress</text>
    <text x="15" y="52" font-family="'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="bold" fill="#60a5fa" transform="translate(440,0)">6 Network Load Balancers</text>
    <text x="15" y="74" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8" transform="translate(440,0)">External HTTPS Load Balancers + TCP Proxies</text>
  </g>

  <!-- GCP Services Bottom Container -->
  <rect x="50" y="390" width="900" height="270" rx="12" fill="#1e293b" stroke="#10b981" stroke-width="2" />
  <rect x="70" y="405" width="220" height="24" rx="4" fill="#059669" />
  <text x="80" y="422" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">MANAGED DATABASE &amp; STORAGE</text>

  <g transform="translate(70, 445)">
    <rect x="0" y="0" width="410" height="85" rx="8" fill="#0f172a" stroke="#34d399" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc">Cloud SQL for PostgreSQL (HA Pair)</text>
    <text x="15" y="50" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#34d399">4 Database Servers</text>
    <text x="15" y="70" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8">2 Master Instances + 2 Read Replicas</text>

    <rect x="440" y="0" width="420" height="85" rx="8" fill="#0f172a" stroke="#34d399" stroke-width="1.5" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc" transform="translate(440,0)">Cloud Logging &amp; Operations Suite</text>
    <text x="15" y="50" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#34d399" transform="translate(440,0)">300 GB / Month Log Ingestion</text>
    <text x="15" y="70" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94a3b8" transform="translate(440,0)">Structured application &amp; system logs</text>

    <rect x="0" y="100" width="860" height="60" rx="8" fill="#0f172a" stroke="#334155" stroke-width="1" />
    <text x="15" y="125" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Public Application Monitoring Endpoints</text>
    <text x="15" y="145" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#38bdf8">3 Public Web Endpoints (Basic Monitors)</text>
    <text x="320" y="145" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#94a3b8">• console.gcp.company.org • api-gw • status.company.org</text>
  </g>
</svg>
`;

// -------------------------------------------------------------
// 4. Hybrid SD-WAN Diagram
// -------------------------------------------------------------
const sdwanSvg = `
<svg width="1000" height="700" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg">
  <rect width="1000" height="700" fill="#0a192f" />
  
  <rect x="50" y="30" width="900" height="60" rx="8" fill="#112240" stroke="#00bceb" stroke-width="1.5" />
  <text x="75" y="65" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#00bceb">Enterprise Hybrid SD-WAN &amp; Campus Branch Network Topology</text>
  <text x="75" y="82" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#8892b0">Cisco SD-WAN Fabric • Corporate HQ Datacenter + 16 Regional Branches</text>

  <!-- Datacenter Core Box -->
  <rect x="50" y="110" width="900" height="230" rx="10" fill="#112240" stroke="#64ffda" stroke-width="1.5" />
  <rect x="70" y="125" width="220" height="24" rx="4" fill="#0a4d68" />
  <text x="80" y="142" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">DATACENTER CORE &amp; HEADEND</text>

  <g transform="translate(70, 165)">
    <rect x="0" y="0" width="260" height="80" rx="6" fill="#0a192f" stroke="#64ffda" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Cisco Catalyst 9500 Switches</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#64ffda">8 Core Switches</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#8892b0">Network Components (HQ Core)</text>

    <rect x="280" y="0" width="260" height="80" rx="6" fill="#0a192f" stroke="#64ffda" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(280,0)">Cisco SD-WAN vEdge Routers</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#64ffda" transform="translate(280,0)">4 Headend Routers</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#8892b0" transform="translate(280,0)">Dual-Homed MPLS / Internet</text>

    <rect x="560" y="0" width="300" height="80" rx="6" fill="#0a192f" stroke="#64ffda" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc" transform="translate(560,0)">Core Virtualization Hosts</text>
    <text x="15" y="48" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="bold" fill="#64ffda" transform="translate(560,0)">12 Bare-Metal Servers</text>
    <text x="15" y="68" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" fill="#8892b0" transform="translate(560,0)">VMware ESXi Host Infrastructure</text>
  </g>

  <!-- Branch Sites Box -->
  <rect x="50" y="360" width="900" height="290" rx="10" fill="#112240" stroke="#00bceb" stroke-width="1.5" />
  <rect x="70" y="375" width="220" height="24" rx="4" fill="#005073" />
  <text x="80" y="392" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">DISTRIBUTED BRANCH LOCATIONS</text>
  <text x="300" y="392" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#8892b0">16 Regional Office Sites Across North America</text>

  <g transform="translate(70, 415)">
    <rect x="0" y="0" width="410" height="90" rx="6" fill="#0a192f" stroke="#00bceb" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc">Branch SD-WAN Edge Appliances</text>
    <text x="15" y="52" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#00bceb">16 Edge Routers</text>
    <text x="15" y="74" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#8892b0">1 Router per Branch Office (Network Components)</text>

    <rect x="440" y="0" width="420" height="90" rx="6" fill="#0a192f" stroke="#00bceb" stroke-width="1" />
    <text x="15" y="24" font-family="'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" fill="#f8fafc" transform="translate(440,0)">Branch Access Switches (PoE+)</text>
    <text x="15" y="52" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="bold" fill="#00bceb" transform="translate(440,0)">16 Access Switches</text>
    <text x="15" y="74" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" fill="#8892b0" transform="translate(440,0)">24-Port Catalyst PoE Switches for Local LAN</text>

    <rect x="0" y="110" width="860" height="60" rx="6" fill="#0a192f" stroke="#334155" stroke-width="1" />
    <text x="15" y="134" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="bold" fill="#f8fafc">Branch Summary Rollup:</text>
    <text x="15" y="152" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" fill="#64ffda">Total Network Components: 44 devices (8 core + 4 headend + 16 branch routers + 16 branch switches)</text>
  </g>
</svg>
`;

console.log('Rendering high-resolution PNG diagrams via sharp...');

const azurePng = await sharp(Buffer.from(azureSvg)).png({ quality: 95 }).toBuffer();
writeToAll('mm-diagram-azure-hub-spoke.png', azurePng);

const awsPng = await sharp(Buffer.from(awsSvg)).png({ quality: 95 }).toBuffer();
writeToAll('mm-diagram-aws-multi-tier.png', awsPng);

const gcpPng = await sharp(Buffer.from(gcpSvg)).png({ quality: 95 }).toBuffer();
writeToAll('mm-diagram-gcp-kubernetes.png', gcpPng);

const sdwanJpg = await sharp(Buffer.from(sdwanSvg)).jpeg({ quality: 90 }).toBuffer();
writeToAll('mm-diagram-hybrid-sdwan.jpg', sdwanJpg);

// -------------------------------------------------------------
// 5. Scanned PDFs (Render raster scan image into PDF with pdf-lib)
// -------------------------------------------------------------
function makeScannedPoSvg(poNumber, vendor, items) {
  const itemRows = items.map((it, idx) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #444; text-align: center;">${idx + 1}</td>
      <td style="padding: 8px; border: 1px solid #444;">${it.desc}</td>
      <td style="padding: 8px; border: 1px solid #444; text-align: center; font-weight: bold;">${it.qty}</td>
      <td style="padding: 8px; border: 1px solid #444; text-align: center;">${it.unit}</td>
    </tr>
  `).join('');

  return `
  <svg width="800" height="1100" viewBox="0 0 800 1100" xmlns="http://www.w3.org/2000/svg">
    <!-- Paper texture bg -->
    <rect width="800" height="1100" fill="#fdfbf7" />
    <!-- Noise / aging effect overlay -->
    <rect width="800" height="1100" fill="#000000" opacity="0.03" />

    <!-- Stamp -->
    <g transform="translate(600, 100) rotate(12)">
      <rect x="0" y="0" width="140" height="60" rx="8" fill="none" stroke="#dc2626" stroke-width="3" opacity="0.75" />
      <text x="70" y="28" font-family="'Courier New', monospace" font-size="14" font-weight="bold" fill="#dc2626" text-anchor="middle" opacity="0.8">CONFIDENTIAL</text>
      <text x="70" y="48" font-family="'Courier New', monospace" font-size="11" fill="#dc2626" text-anchor="middle" opacity="0.8">SCANNED COPY</text>
    </g>

    <!-- Header -->
    <text x="60" y="80" font-family="'Times New Roman', serif" font-size="24" font-weight="bold" fill="#1e293b">ENTERPRISE PROCUREMENT ORDER</text>
    <text x="60" y="105" font-family="'Courier New', monospace" font-size="13" fill="#475569">DOCUMENT REF: ${poNumber} • FISCAL YEAR 2026</text>
    <line x1="60" y1="120" x2="740" y2="120" stroke="#334155" stroke-width="2" />

    <!-- Metadata -->
    <text x="60" y="150" font-family="'Courier New', monospace" font-size="12" fill="#1e293b">ISSUED TO: ${vendor}</text>
    <text x="60" y="170" font-family="'Courier New', monospace" font-size="12" fill="#1e293b">DEPARTMENT: Global Infrastructure Operations</text>
    <text x="60" y="190" font-family="'Courier New', monospace" font-size="12" fill="#1e293b">CLASSIFICATION: Hardcopy Scan / Operator Review Required</text>

    <!-- Table Header -->
    <rect x="60" y="230" width="680" height="30" fill="#e2e8f0" stroke="#334155" stroke-width="1" />
    <text x="75" y="250" font-family="'Times New Roman', serif" font-size="12" font-weight="bold" fill="#0f172a">#</text>
    <text x="120" y="250" font-family="'Times New Roman', serif" font-size="12" font-weight="bold" fill="#0f172a">ITEM DESCRIPTION &amp; SPECIFICATION</text>
    <text x="560" y="250" font-family="'Times New Roman', serif" font-size="12" font-weight="bold" fill="#0f172a">QTY</text>
    <text x="640" y="250" font-family="'Times New Roman', serif" font-size="12" font-weight="bold" fill="#0f172a">UNIT</text>

    <!-- Table Rows -->
    ${items.map((it, idx) => {
      const y = 280 + idx * 45;
      return `
        <rect x="60" y="${y - 20}" width="680" height="40" fill="${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}" stroke="#cbd5e1" stroke-width="1" />
        <text x="75" y="${y + 5}" font-family="'Courier New', monospace" font-size="12" fill="#1e293b">${idx + 1}</text>
        <text x="120" y="${y + 5}" font-family="'Courier New', monospace" font-size="12" font-weight="bold" fill="#0f172a">${it.desc}</text>
        <text x="570" y="${y + 5}" font-family="'Courier New', monospace" font-size="14" font-weight="bold" fill="#0284c7">${it.qty}</text>
        <text x="640" y="${y + 5}" font-family="'Courier New', monospace" font-size="12" fill="#475569">${it.unit}</text>
      `;
    }).join('')}

    <!-- Footer Notes -->
    <text x="60" y="650" font-family="'Courier New', monospace" font-size="11" fill="#64748b">NOTE: This scanned purchase requisition contains handwritten verification marks.</text>
    <text x="60" y="670" font-family="'Courier New', monospace" font-size="11" fill="#64748b">Non-OCR raster transmission. Forwarded to operations desk for review.</text>

    <!-- Signature line -->
    <line x1="60" y1="750" x2="300" y2="750" stroke="#000000" stroke-width="1" />
    <text x="60" y="770" font-family="'Times New Roman', serif" font-size="11" fill="#475569">Authorized Signature / VP Procurement</text>
    <text x="60" y="740" font-family="'Brush Script MT', cursive, sans-serif" font-size="24" fill="#1e3a8a">J. Richardson</text>
  </svg>
  `;
}

async function createScannedPdfFromSvg(svg) {
  const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 95 }).toBuffer();
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const image = await pdfDoc.embedPng(pngBuffer);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89
  });
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

const scanned1 = await createScannedPdfFromSvg(makeScannedPoSvg('REQ-2026-ACME-8891', 'Acme Networks Corp', [
  { desc: 'Linux Bare-Metal Application Servers', qty: 25, unit: 'Servers' },
  { desc: 'Cisco Top-of-Rack Core Switches', qty: 6, unit: 'Network Devices' },
  { desc: 'Public Portal Availability Probes', qty: 4, unit: 'Web Endpoints' }
]));
writeToAll('Case-5-Scanned-Image-Only.pdf', scanned1);

const scanned2 = await createScannedPdfFromSvg(makeScannedPoSvg('PO-7721-HANDWRITTEN', 'Nexus Cloud Solutions', [
  { desc: 'Dedicated Compute Nodes (RHEL 9)', qty: 40, unit: 'Servers' },
  { desc: 'Spine Network Fabric Switches', qty: 8, unit: 'Network Devices' },
  { desc: 'Application Telemetry Stream', qty: 200, unit: 'GB Logs/Mo' }
]));
writeToAll('mm-scanned-po-handwritten.pdf', scanned2);

const scanned3 = await createScannedPdfFromSvg(makeScannedPoSvg('INV-9932-RECEIPT', 'Vanguard Data Systems', [
  { desc: 'Kubernetes Worker Hosts', qty: 15, unit: 'Servers' },
  { desc: 'Border Gateway Routers', qty: 4, unit: 'Routers' },
  { desc: 'Synthetic Transaction Monitors', qty: 2, unit: 'Advanced' }
]));
writeToAll('mm-scanned-invoice-receipt.pdf', scanned3);

const scanned4 = await createScannedPdfFromSvg(makeScannedPoSvg('FAX-4410-SCOPE', 'Vertex Global Telecom', [
  { desc: 'Microservices Container Hosts', qty: 30, unit: 'Servers' },
  { desc: 'Data Center Distribution Switches', qty: 6, unit: 'Switches' }
]));
writeToAll('mm-scanned-faxed-scope.pdf', scanned4);

console.log('Successfully generated all crisp diagrams and realistic scanned PDFs!');
