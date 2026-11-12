/** A conversation on the Support page. One thread is one issue. */

export const SUPPORT_LIMITS = { subject: 120, body: 4000, openPerAccount: 8 } as const;

export type SupportStatus = "open" | "closed";

export type SupportAccount = { name: string; login: string | null };

export type SupportThreadSummary = {
  id: string;
  subject: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  preview: string;
  unread: boolean;
  /** This conversation belongs to the signed-in account. */
  own: boolean;
  /** The account that opened it, when the operator is looking at someone else's. */
  account: SupportAccount | null;
};

export type SupportMessage = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  fromStaff: boolean;
};

export type SupportThreadDetail = SupportThreadSummary & { messages: SupportMessage[] };
