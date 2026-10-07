import { describe, expect, it } from "vitest";
import { migrationChecksum } from "@secthing/platform";

describe("migration checksums", () => {
  it("distinguishes LF and CRLF content so the migration runner can repair legacy CRLF records explicitly", () => {
    expect(migrationChecksum("CREATE TABLE example ();\n")).not.toBe(migrationChecksum("CREATE TABLE example ();\r\n"));
  });
});
