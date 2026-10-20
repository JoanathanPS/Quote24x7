/**
 * Test seam for swapping the outbound Resend client.
 *
 * `dispatchEmail` calls `getResendClient(apiKey)` instead of `new Resend(...)`
 * directly. Tests install a fake here; production callers get a real Resend
 * instance.
 *
 * The fake produces RFC 2822-compliant <local@domain> message-ids on the
 * `emails.get()` path because the production code now rejects non-tokens:
 * storing a provider UUID as a `messageIdHeader` corrupts the chain and is
 * exactly the bug we are guarding against. The fake mirrors what Resend's
 * `GetEmailResponseSuccess.message_id` exposes at the top level of the
 * response.
 *
 * Test-only. Never imported outside *.test.ts.
 */

import { Resend } from "resend";

export interface SendArgs {
  from: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: unknown;
}

export interface SendResponse {
  data: { id: string } | null;
  error: { name: string; message: string } | null;
}

export interface GetResponse {
  data: { message_id?: string } | null;
  error: { name: string; message: string } | null;
}

export interface ResendLike {
  emails: {
    send(args: SendArgs): Promise<SendResponse>;
    get(id: string): Promise<GetResponse>;
  };
}

export interface FakeSendRecord {
  id: string;
  messageId: string;
  from: string;
  to: string | string[];
  replyTo: string | null;
  subject: string;
  headers: Record<string, string> | undefined;
  text: string | null;
  html: string | null;
}

interface FakeState {
  sent: FakeSendRecord[];
  deterministicIds: string[];
  cursor: number;
}

let active: FakeState | null = null;

/** Install a fake Resend client. Pair every install with `uninstallFakeResendProvider` in a `finally`. */
export function installFakeResendProvider(opts?: {
  deterministicIds?: string[];
}): FakeState {
  const state: FakeState = {
    sent: [],
    deterministicIds: opts?.deterministicIds ?? [],
    cursor: 0,
  };
  active = state;
  return state;
}

export function uninstallFakeResendProvider(): void {
  active = null;
}

export function isFakeResendActive(): boolean {
  return active !== null;
}

/** Factory the dispatcher uses. Returns the fake when one is active, else a real Resend. */
export function getResendClient(apiKey: string): ResendLike {
  if (active) return makeFake(active);
  return new Resend(apiKey) as unknown as ResendLike;
}

function makeFake(state: FakeState): ResendLike {
  return {
    emails: {
      send: async (args: SendArgs): Promise<SendResponse> => {
        if (!active || active !== state) {
          return { data: null, error: { name: "NoActiveFake", message: "No active fake provider" } };
        }
        const id =
          state.deterministicIds[state.cursor] ?? `fake_out_${state.sent.length + 1}`;
        state.cursor += 1;
        const messageId = `<${id}.${state.sent.length + 1}@resend.dev>`;
        state.sent.push({
          id,
          messageId,
          from: args.from,
          to: args.to,
          replyTo: args.replyTo ?? null,
          subject: args.subject,
          headers: args.headers,
          text: args.text ?? null,
          html: args.html ?? null,
        });
        return { data: { id }, error: null };
      },
      get: async (id: string): Promise<GetResponse> => {
        if (!active || active !== state) {
          return { data: null, error: { name: "NoActiveFake", message: "No active fake provider" } };
        }
        const rec = state.sent.find((s) => s.id === id);
        if (!rec) {
          return { data: null, error: { name: "NotFound", message: `no record for ${id}` } };
        }
        return { data: { message_id: rec.messageId }, error: null };
      },
    },
  };
}

export function getFakeSentMessages(): FakeSendRecord[] {
  return active ? [...active.sent] : [];
}
