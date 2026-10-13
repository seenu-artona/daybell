import { describe, expect, it } from "vitest";
import {
  HEAD_OFFICE_PROVINCES,
  isHeadOfficeProvince,
  isPstProvince,
  normalizePostalCode,
  normalizeTaxNumber,
  PST_PROVINCES,
} from "./tax";

describe("tax registration numbers (answer 2)", () => {
  it("keeps GST/HST as 9 digits, RT and 4 digits", () => {
    expect(normalizeTaxNumber("gst_hst", "123456789RT0001")).toBe("123456789RT0001");
    expect(normalizeTaxNumber("gst_hst", " 123456789 rt 0001 ")).toBe("123456789RT0001");
    expect(normalizeTaxNumber("gst_hst", "123456789-RT-0001")).toBe("123456789RT0001");
    expect(normalizeTaxNumber("gst_hst", "12345678RT0001")).toBeNull();
    expect(normalizeTaxNumber("gst_hst", "123456789RC0001")).toBeNull();
  });

  it("keeps PST in capitals as the province writes it", () => {
    expect(normalizeTaxNumber("pst", "pst-1234-5678")).toBe("PST-1234-5678");
    expect(normalizeTaxNumber("pst", "123  456")).toBe("123 456");
    expect(normalizeTaxNumber("pst", "")).toBeNull();
    expect(normalizeTaxNumber("pst", "-123")).toBeNull();
    expect(normalizeTaxNumber("pst", "A".repeat(31))).toBeNull();
    expect(normalizeTaxNumber("pst", "<script>")).toBeNull();
  });
});

describe("provinces (call 3)", () => {
  it("are Canada's without Quebec at launch; PST in BC, MB and SK", () => {
    expect(HEAD_OFFICE_PROVINCES).not.toContain("QC");
    expect(HEAD_OFFICE_PROVINCES).toHaveLength(12);
    expect(isHeadOfficeProvince("ON")).toBe(true);
    expect(isHeadOfficeProvince("QC")).toBe(false);
    expect(PST_PROVINCES).toEqual(["BC", "MB", "SK"]);
    expect(isPstProvince("ON")).toBe(false);
  });

  it("reads postal codes as A1A 1A1", () => {
    expect(normalizePostalCode("m5v2t6")).toBe("M5V 2T6");
    expect(normalizePostalCode("M5V-2T6")).toBe("M5V 2T6");
    expect(normalizePostalCode("12345")).toBeNull();
    expect(normalizePostalCode("D5V 2T6")).toBeNull();
  });
});
