-- ==============================================================================
-- Quote24x7 Migration: Licence Rules and Knowledge Base Seed (Phase 4)
-- ==============================================================================

begin;

-- 1. Licence Rules
delete from public.catalogue_licence_rules where catalogue_version_id = 'cat_in_2026_10';

insert into public.catalogue_licence_rules (
  id,
  catalogue_version_id,
  rule_code,
  description,
  plan_id,
  addon_id,
  rule_type,
  parameters,
  source_id
) values
  (
    'rule_min_frequency_standard',
    'cat_in_2026_10',
    'MIN_MONITOR_FREQUENCY',
    'Minimum monitoring frequency is 1 minute for Web Uptime, Lite, Web Perf, and Professional plans.',
    'plan_professional',
    null,
    'frequency',
    '{"min_interval_seconds": 60, "allowed_intervals": ["1m", "5m", "10m", "15m", "30m", "1h"]}'::jsonb,
    'src_pub_aio'
  ),
  (
    'rule_min_frequency_enterprise',
    'cat_in_2026_10',
    'MIN_MONITOR_FREQUENCY',
    'Minimum monitoring frequency is 10 seconds for Enterprise and Enterprise Plus Web plans.',
    'plan_enterprise',
    null,
    'frequency',
    '{"min_interval_seconds": 10, "allowed_intervals": ["10s", "30s", "1m", "5m"]}'::jsonb,
    'src_store_comparison'
  ),
  (
    'rule_log_retention_standard',
    'cat_in_2026_10',
    'MIN_LOG_RETENTION',
    'Standard included log retention is 30 days searchable storage with 6-month cold storage option.',
    null,
    'addon_logs_10gb',
    'retention',
    '{"default_retention_days": 30, "archive_retention_months": 6}'::jsonb,
    'src_pub_infra'
  ),
  (
    'rule_alert_credits_consumption',
    'cat_in_2026_10',
    'ALERT_CREDIT_CONSUMPTION',
    'Alert credit consumption rate: 1 SMS notification = 1 credit in India; 1 Voice alert call = 2 credits.',
    null,
    'addon_alert_credit',
    'consumption',
    '{"sms_rate_in_credits": 1, "voice_rate_in_credits": 2, "market": "IN"}'::jsonb,
    'src_store_comparison'
  ),
  (
    'rule_network_component_licensing',
    'cat_in_2026_10',
    'NETWORK_COMPONENT_LICENSING',
    'Each network switch, router, or firewall consumes 1 network component monitor. Monitored interfaces and traffic flows consume component packs.',
    null,
    'addon_netcomp_10',
    'licensing',
    '{"interfaces_per_switch_default": 10, "traffic_flow_support": true}'::jsonb,
    'src_pub_infra'
  ),
  (
    'rule_advanced_monitor_definitions',
    'cat_in_2026_10',
    'ADVANCED_MONITOR_DEFINITION',
    'Advanced monitors encompass multi-step synthetic web transactions, real browser web recorders, APM Insight application instances (Java, .NET, Node.js, Python), Mobile APM apps, and VMware ESX/ESXi hypervisor hosts.',
    null,
    'addon_advanced_2',
    'classification',
    '{"included_types": ["synthetic_transaction", "real_browser", "apm_insight_agent", "mobile_apm", "vmware_esx"]}'::jsonb,
    'src_pub_aio'
  ),
  (
    'rule_basic_monitor_definitions',
    'cat_in_2026_10',
    'BASIC_MONITOR_DEFINITION',
    'Basic monitors encompass single-URL HTTP/HTTPS checks, ICMP ping, TCP/UDP ports, DNS servers, SSL/TLS certificates, standard Linux and Windows servers, and cloud virtual machines.',
    null,
    'addon_basic_10',
    'classification',
    '{"included_types": ["website_url", "icmp_ping", "port_check", "dns_check", "ssl_certificate", "linux_server", "windows_server", "cloud_vm"]}'::jsonb,
    'src_pub_aio'
  ),
  (
    'rule_enterprise_handoff',
    'cat_in_2026_10',
    'ENTERPRISE_HANDOFF_THRESHOLD',
    'Workloads with >100 server hosts, >50 network devices, >10 APM Insight applications, or custom log retention SLAs exceed automated instant self-checkout thresholds and must route to Enterprise Sales with quote_on_request = true.',
    'plan_enterprise',
    null,
    'routing',
    '{"max_auto_servers": 100, "max_auto_network_devices": 50, "max_auto_apm_instances": 10, "quote_on_request": true}'::jsonb,
    'src_store_comparison'
  );

-- 2. Knowledge Snippets
delete from public.knowledge_snippets where id in (
  'ks_data_residency_india',
  'ks_support_tiers_india',
  'ks_payment_terms_inr',
  'ks_gst_compliance_india',
  'ks_deployment_architecture',
  'ks_onboarding_trial'
);

insert into public.knowledge_snippets (
  id,
  topic,
  text,
  keywords,
  source_url,
  captured_on
) values
  (
    'ks_data_residency_india',
    'Data Residency & Security (India DC)',
    'Customer telemetry, logs, and monitoring metrics for Site24x7 India are hosted in Zoho Corporation Pvt. Ltd. data center located in Karapakkam, Chennai, Tamil Nadu, India. All telemetry is stored domestically and never leaves Indian borders. The infrastructure operates under strict security governance adhering to ISO/IEC 27001, SOC 2 Type II compliance, and CERT-In national cybersecurity directives.',
    array['data residency', 'india dc', 'datacenter', 'chennai', 'karapakkam', 'tamil nadu', 'iso 27001', 'soc 2', 'cert-in', 'compliance', 'security'],
    'https://www.site24x7.in/security.html',
    '2026-10-15T00:00:00.000Z'
  ),
  (
    'ks_support_tiers_india',
    'Technical Support Tiers and SLA Coverage',
    'Support coverage is segmented by subscription tier: Starter and Classic plans include standard business-hours email and ticketing support; Professional plans offer 24x5 priority email, chat, and remote assistance; Enterprise and Enterprise Plus Web plans provide 24x7 phone support, critical incident response, and an assigned Technical Account Manager.',
    array['support', 'technical support', 'sla', 'phone support', 'business hours', '24x5', '24x7', 'tam', 'incident support'],
    'https://www.site24x7.in/support.html',
    '2026-10-15T00:00:00.000Z'
  ),
  (
    'ks_payment_terms_inr',
    'Commercial Payment Terms (INR Currency)',
    'All billing for Site24x7 India is invoiced and settled in Indian Rupees (INR) exclusively through the Zoho Store platform. Supported payment instruments include Indian NetBanking, UPI (Unified Payments Interface), Corporate Credit Cards, and direct NEFT/RTGS wire transfers for annual contracts exceeding ₹50,000 against official Purchase Orders.',
    array['payment', 'pricing', 'inr', 'currency', 'zoho store', 'netbanking', 'upi', 'credit card', 'neft', 'rtgs', 'purchase order', 'annual contract'],
    'https://www.site24x7.in/pricing.html',
    '2026-10-15T00:00:00.000Z'
  ),
  (
    'ks_gst_compliance_india',
    'Goods and Services Tax (GST) & Invoicing Compliance',
    'All catalogue prices are quoted exclusive of statutory Indian taxes. An 18% Goods and Services Tax (IGST for inter-state transactions or CGST 9% + SGST 9% for transactions within Tamil Nadu) is billed on all invoices. Indian corporate customers can enter their GSTIN at purchase to receive valid tax invoices for input tax credit (ITC) and reverse charge compliance.',
    array['gst', 'tax', '18%', 'igst', 'cgst', 'sgst', 'gstin', 'invoice', 'input tax credit', 'reverse charge'],
    'https://www.site24x7.in/pricing.html',
    '2026-10-15T00:00:00.000Z'
  ),
  (
    'ks_deployment_architecture',
    'Pure SaaS Deployment & Non-Intrusive Monitoring Agents',
    'Site24x7 is delivered as a 100% multi-tenant cloud SaaS solution with zero customer server infrastructure to maintain. Host monitoring relies on a lightweight, resource-constrained agent for Linux, Windows, macOS, Docker, and Kubernetes environments. Cloud accounts (AWS, Microsoft Azure, Google Cloud) are monitored agentlessly via read-only IAM assume-role policies without storing static customer credentials.',
    array['deployment', 'saas', 'architecture', 'agent', 'linux', 'windows', 'docker', 'kubernetes', 'cloud', 'aws', 'azure', 'gcp', 'iam'],
    'https://www.site24x7.in/help/overview.html',
    '2026-10-15T00:00:00.000Z'
  ),
  (
    'ks_onboarding_trial',
    'Evaluation Period & Automated Infrastructure Discovery',
    'Site24x7 offers a comprehensive 30-day free trial with full capability access and no credit card required. Onboarding includes automated network discovery and cloud asset discovery that automatically identifies compute instances, open ports, database services, and network devices within minutes of agent installation.',
    array['onboarding', 'free trial', '30 days', 'no credit card', 'discovery', 'autodiscovery', 'setup'],
    'https://www.site24x7.in/signup.html',
    '2026-10-15T00:00:00.000Z'
  );

commit;
