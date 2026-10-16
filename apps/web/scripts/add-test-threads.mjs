#!/usr/bin/env node
/**
 * Adds test email threads to the session store for development/testing.
 * Run with: node --import tsx apps/web/scripts/add-test-threads.mjs
 */

// Import the store directly (tsx will handle TypeScript)
const { store } = await import('../src/server/store/session-store.ts');

console.log('Adding test threads to session store...\n');

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const testThreads = [
    {
      id: 'th_test_001',
      provider: 'resend',
      providerThreadId: 'msg_test_001',
      senderEmail: 'ashok@enterprise-client.in',
      senderName: 'Ashok Patel',
      organisation: 'Patel Enterprises Ltd',
      subject: 'Infrastructure Monitoring Quote',
      status: 'awaiting_reply',
      requestType: 'quote',
      createdAt: twoDaysAgo,
      updatedAt: yesterday,
      lastMessageAt: yesterday,
      messageCount: 3,
      quoteId: null,
      quoteTotal: null,
      currency: 'INR',
      statusDetail: null,
      state: 'idle',
      roundsUsed: 1,
      nonproductiveStreak: 0,
      inboundCount: 2,
      lastInboundAt: yesterday,
      subjectCanonical: 'infrastructure monitoring quote',
    },
    {
      id: 'th_test_002',
      provider: 'resend',
      providerThreadId: 'msg_test_002',
      senderEmail: 'priya@techstartup.io',
      senderName: 'Priya Sharma',
      organisation: 'TechStartup India',
      subject: 'Website and Server Monitoring',
      status: 'completed',
      requestType: 'quote',
      createdAt: twoDaysAgo,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 5,
      quoteId: 'qt_test_002',
      quoteTotal: 8721000, // ₹87,210 in paise
      currency: 'INR',
      statusDetail: null,
      state: 'idle',
      roundsUsed: 2,
      nonproductiveStreak: 0,
      inboundCount: 3,
      lastInboundAt: now,
      subjectCanonical: 'website and server monitoring',
    },
    {
      id: 'th_test_003',
      provider: 'resend',
      providerThreadId: 'msg_test_003',
      senderEmail: 'rajesh@manufacturing.com',
      senderName: 'Rajesh Kumar',
      organisation: 'Kumar Manufacturing',
      subject: 'Pricing for 50 servers',
      status: 'pricing',
      requestType: 'quote',
      createdAt: yesterday,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 2,
      quoteId: null,
      quoteTotal: null,
      currency: 'INR',
      statusDetail: null,
      state: 'idle',
      roundsUsed: 0,
      nonproductiveStreak: 0,
      inboundCount: 1,
      lastInboundAt: now,
      subjectCanonical: 'pricing for 50 servers',
    },
    {
      id: 'th_test_004',
      provider: 'resend',
      providerThreadId: 'msg_test_004',
      senderEmail: 'support@helpdesk.example.com',
      senderName: 'Help Desk Bot',
      organisation: null,
      subject: '[##12345##] Ticket update - Network issue',
      status: 'unsupported',
      requestType: 'unknown',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 1,
      quoteId: null,
      quoteTotal: null,
      currency: 'INR',
      statusDetail: 'Automated ticket notification dropped',
      state: 'needs_review',
      roundsUsed: 0,
      nonproductiveStreak: 0,
      inboundCount: 1,
      lastInboundAt: now,
      subjectCanonical: 'ticket update network issue',
    },
];

const testMessages = [
    {
      id: 'msg_001_in',
      threadId: 'th_test_001',
      direction: 'inbound',
      fromAddress: 'ashok@enterprise-client.in',
      fromName: 'Ashok Patel',
      toAddresses: ['quotes@quotes.joanathan.in'],
      subject: 'Infrastructure Monitoring Quote',
      bodyText: 'Hi,\n\nWe need monitoring for our infrastructure. We have about 25 Linux servers and 5 websites.\n\nCan you provide pricing?\n\nThanks,\nAshok',
      occurredAt: twoDaysAgo,
      deliveryId: null,
      securityNotes: [],
      attachments: [],
      messageIdHeader: '<msg001@enterprise-client.in>',
      inReplyTo: null,
      references: null,
      providerMessageId: 'prov_msg_001',
    },
    {
      id: 'msg_001_out',
      threadId: 'th_test_001',
      direction: 'outbound',
      fromAddress: 'quotes@quotes.joanathan.in',
      fromName: 'Quote24x7 Assistant',
      toAddresses: ['ashok@enterprise-client.in'],
      subject: 'Re: Infrastructure Monitoring Quote',
      bodyText: 'Hi Ashok,\n\nThanks for reaching out! To prepare an accurate quotation, I need a few more details:\n\n1. How many applications or databases need APM monitoring?\n2. Do you have any network devices (switches, routers, firewalls) to monitor?\n3. Are you looking at annual billing?\n\nBest regards,\nQuote24x7 Assistant',
      occurredAt: yesterday,
      deliveryId: 'del_001',
      securityNotes: [],
      attachments: [],
      messageIdHeader: '<reply001@quotes.joanathan.in>',
      inReplyTo: '<msg001@enterprise-client.in>',
      references: '<msg001@enterprise-client.in>',
      providerMessageId: 'prov_reply_001',
    },
    {
      id: 'msg_002_in',
      threadId: 'th_test_002',
      direction: 'inbound',
      fromAddress: 'priya@techstartup.io',
      fromName: 'Priya Sharma',
      toAddresses: ['quotes@quotes.joanathan.in'],
      subject: 'Website and Server Monitoring',
      bodyText: 'Hello,\n\nWe need monitoring for:\n- 10 websites\n- 15 servers (mix of Linux and Windows)\n- 3 Java applications\n\nPlease send us a quote.\n\nRegards,\nPriya',
      occurredAt: twoDaysAgo,
      deliveryId: null,
      securityNotes: [],
      attachments: [],
      messageIdHeader: '<msg002@techstartup.io>',
      inReplyTo: null,
      references: null,
      providerMessageId: 'prov_msg_002',
    },
];

// Add threads to store
await store.ensureInitializedAsync();

for (const thread of testThreads) {
  store.saveThread(thread);
  console.log(`✓ Added thread: ${thread.subject} (${thread.status})`);
}

// Add messages
for (const message of testMessages) {
  store.addMessage(message);
  console.log(`✓ Added message: ${message.direction} to ${message.threadId}`);
}

console.log('\n✅ Test data added successfully!');
console.log(`📊 Total threads in store: ${store.getThreads().length}`);
console.log(`📨 Total messages: ${testMessages.length}`);
console.log('\n💡 Refresh your browser to see the test threads on the dashboard.');

process.exit(0);
