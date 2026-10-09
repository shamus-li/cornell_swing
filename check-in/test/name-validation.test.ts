import { describe, expect, it } from "vitest"

import {
  hasUnusualNameCapitalization,
  isValidEmail,
  isValidName,
  normalizeName,
  normalizePhone,
  signatureMatchesName,
} from "../src/lib/checkin"

describe("name validation", () => {
  it("normalizes Unicode and whitespace without changing capitalization", () => {
    expect(normalizeName("  Jose\u0301\t  O’Neill  ")).toBe("José O’Neill")
    expect(normalizeName("de la Cruz")).toBe("de la Cruz")
  })

  it("requires a letter while allowing real-world name punctuation and scripts", () => {
    expect(isValidName("Anne-Marie O'Neill")).toBe(true)
    expect(isValidName("张伟")).toBe(true)
    expect(isValidName("123 --")).toBe(false)
    expect(isValidName("A\u0000B")).toBe(false)
    expect(isValidName("")).toBe(false)
  })

  it("flags all-lowercase and all-uppercase names without flagging uncased scripts", () => {
    expect(hasUnusualNameCapitalization("shamus li")).toBe(true)
    expect(hasUnusualNameCapitalization("SHAMUS LI")).toBe(true)
    expect(hasUnusualNameCapitalization("Shamus Li")).toBe(false)
    expect(hasUnusualNameCapitalization("张伟")).toBe(false)
  })

  it("accepts a signature that differs from the name only in capitalization, spacing, or accents", () => {
    expect(signatureMatchesName("  josé   o’neill ", "José O’Neill")).toBe(true)
    expect(signatureMatchesName("Jose O’Neill", "José O’Neill")).toBe(true)
    expect(signatureMatchesName("José", "José O’Neill")).toBe(false)
    expect(signatureMatchesName(" ", "")).toBe(false)
  })

  it("saves phone numbers in a readable format and rejects numbers that can't exist", () => {
    expect(normalizePhone("607.555.0100")).toBe("(607) 555-0100")
    expect(normalizePhone("+44 7911 123456")).toBe("+44 7911 123456")
    expect(normalizePhone("(000) 000-0000")).toBe("")
    expect(normalizePhone("123")).toBe("")
  })

  it("requires a full email address", () => {
    expect(isValidEmail("nora+swing@gmail.com")).toBe(true)
    expect(isValidEmail("jane@cornell")).toBe(false)
    expect(isValidEmail("jane@@cornell.edu")).toBe(false)
    expect(isValidEmail("jane smith@cornell.edu")).toBe(false)
  })
})
