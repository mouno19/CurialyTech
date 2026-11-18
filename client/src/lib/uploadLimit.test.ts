import { describe, expect, it } from "vitest";
import { exceedsMessageLimit, hasMaxUploads, MAX_MESSAGE_ATTACHMENT_BYTES, MAX_UPLOAD_BYTES_MAX, MAX_UPLOAD_BYTES_STANDARD, maxUploadBytesForTier } from "@shared/media";
import { MESSAGE_TOO_LARGE, tooLargeMessage } from "./useAttachments";

const MB = 1024 * 1024;

describe("upload limits by plan", () => {
  it("are 25 MB a file on Free and Pro, 100 MB on Max and for the operator", () => {
    expect(MAX_UPLOAD_BYTES_STANDARD).toBe(25 * MB);
    expect(MAX_UPLOAD_BYTES_MAX).toBe(100 * MB);
    expect(maxUploadBytesForTier(false)).toBe(25 * MB);
    expect(maxUploadBytesForTier(true)).toBe(100 * MB);
    expect(hasMaxUploads({ role: "admin", planId: null })).toBe(true);
    expect(hasMaxUploads({ role: "user", planId: "max" })).toBe(true);
    expect(hasMaxUploads({ role: "user", planId: "pro" })).toBe(false);
    expect(hasMaxUploads({ role: "user", planId: null })).toBe(false);
  });

  it("let one message carry 100 MB in all", () => {
    expect(MAX_MESSAGE_ATTACHMENT_BYTES).toBe(100 * MB);
    expect(exceedsMessageLimit([60 * MB, 40 * MB])).toBe(false);
    expect(exceedsMessageLimit([60 * MB, 40 * MB, 1])).toBe(true);
    expect(MESSAGE_TOO_LARGE).toBe("Total attachments exceed 100 MB for this message.");
  });

  it("say why a file is too large, pointing Free and Pro to Max", () => {
    expect(tooLargeMessage({ name: "deck.pdf", size: 25 * MB }, 25 * MB)).toBeNull();
    expect(tooLargeMessage({ name: "deck.pdf", size: 30 * MB }, 25 * MB)).toBe("deck.pdf is larger than 25 MB. Upgrade to Max for up to 100 MB uploads.");
    expect(tooLargeMessage({ name: "deck.pdf", size: 80 * MB }, 100 * MB)).toBeNull();
    expect(tooLargeMessage({ name: "film.mp4", size: 105 * MB }, 100 * MB)).toBe("film.mp4 is larger than 100 MB.");
  });
});
