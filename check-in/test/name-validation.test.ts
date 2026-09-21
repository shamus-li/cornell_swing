import { describe, expect, it } from "vitest"

import {
  hasUnusualNameCapitalization,
  isValidName,
  normalizeName,
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
})
