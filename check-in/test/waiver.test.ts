import { env } from "cloudflare:workers"
import { exportPKCS8, generateKeyPair } from "jose"
import { HttpResponse, http } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import migration from "../../migrations/events/0001_events.sql?raw"
import { checkWaiverForm, handleApiRequest } from "../worker"
import { withoutEmoji } from "../worker/waiver"
import { FakeSheets } from "./fakes"
import { network } from "./network"

const SIGNER = { name: "Nora Murphy", email: "nora@example.com", phone: "6075550100", signature: "Nora Murphy" }

const FORM_HTML = `<html><body>
<div class="page_intro"><style>.x{}</style><p><b>Assumption &amp; Risk</b></p><p><b>WARNINGS</b>: I agree to the &ldquo;Event&rdquo; <b><i>terms</i></b>.<br>I am fit.</p><ul><li>I am of age.</li></ul></div>
<form id="survey" method="post" action="https://cornell.campusgroups.com/survey">
  <input type="hidden" name="_csrf" value="token" />
  <input type="hidden" name="survey_uid" value="cbbab8ae" />
  <input type="text" name="free_text_e1c243dd-db1d-11ee-bde0-0a80ef5ee5f9" />
  <input type="text" name="free_text_f75a7f17-db1d-11ee-bde0-0a80ef5ee5f9" />
  <input type="text" name="free_text_919c0e74-e2d4-11ee-bde0-0a80ef5ee5f9" />
  <select name="42137b64-e2d5-11ee-bde0-0a80ef5ee5f9"></select>
  <input type="text" name="free_text_49c9efdc-e2d4-11ee-bde0-0a80ef5ee5f9" />
</form>
<script>function submitForm(){ $.ajax({ url: \`/survey_submission_endpoint?survey_uid=cbbab8ae&answerer_s=abc\` }) }</script>
</body></html>`

function useCampusGroups() {
  const submissions: { cookie: string | null; body: URLSearchParams }[] = []
  network.use(
    http.get("https://cornell.campusgroups.com/RMI/survey", () =>
      new HttpResponse(FORM_HTML, { headers: { "Content-Type": "text/html", "Set-Cookie": "CG.SessionID=session; path=/; HttpOnly" } })),
    http.get("https://cornell.campusgroups.com/survey_submission_endpoint", () =>
      HttpResponse.text(JSON.stringify({ canSubmit: true }))),
    http.post("https://cornell.campusgroups.com/survey", async ({ request }) => {
      submissions.push({ cookie: request.headers.get("Cookie"), body: new URLSearchParams(await request.text()) })
      return new HttpResponse(null, { status: 302, headers: { Location: "/confirmation?type=survey_submission&embed=1&type_uid1=cbbab8ae&type_uid2=response-1" } })
    }),
  )
  return submissions
}

function waiverRequest(init?: RequestInit): Request {
  return new Request("https://example.com/check-in/api/waiver", init)
}

beforeEach(async () => {
  for (const { name } of (await env.MEMBER_CACHE.list({ prefix: "waiver-form-alert:" })).keys) await env.MEMBER_CACHE.delete(name)
  await env.EVENTS_DB.exec("DROP TABLE IF EXISTS rsvps")
  await env.EVENTS_DB.exec("DROP TABLE IF EXISTS events")
  await env.EVENTS_DB.exec(migration.replaceAll("\n", " "))
})

describe("participant waiver", () => {
  it("shows the waiver with its bold, italic, and bulleted text and names a lesson night after its date", async () => {
    useCampusGroups()

    const response = await handleApiRequest(waiverRequest(), env)

    const today = new Intl.DateTimeFormat("en-US", { timeZone: env.TIME_ZONE, month: "long", day: "numeric", year: "numeric" }).format(new Date())
    expect(await response.json()).toEqual({
      blocks: [
        { list: false, runs: [{ text: "Assumption & Risk", bold: true, italic: false }] },
        {
          list: false,
          runs: [
            { text: "WARNINGS", bold: true, italic: false },
            { text: ": I agree to the “Event” ", bold: false, italic: false },
            { text: "terms", bold: true, italic: true },
            { text: ".", bold: false, italic: false },
          ],
        },
        { list: false, runs: [{ text: "I am fit.", bold: false, italic: false }] },
        { list: true, runs: [{ text: "I am of age.", bold: false, italic: false }] },
      ],
      eventName: `${today} Swing Dance`,
    })
  })

  it("submits the signer's details, the special event's title, and Swing Syndicate as host, then logs the waiver", async () => {
    const submissions = useCampusGroups()
    const sheets = new FakeSheets()
    network.use(...sheets.handlers(), http.post("https://oauth2.googleapis.com/token", () =>
      HttpResponse.json({ access_token: "test-access-token" })))
    const { privateKey } = await generateKeyPair("RS256", { extractable: true })
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: env.TIME_ZONE }).format(new Date())
    await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, updatedAt) VALUES ('e1', 'special', 'Fall Formal', ?, '')").bind(today).run()

    const response = await handleApiRequest(waiverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SIGNER),
    }), { ...env, GOOGLE_PRIVATE_KEY: await exportPKCS8(privateKey) })

    expect(response.status).toBe(201)
    expect(sheets.waivers).toEqual([[expect.any(Number), "Nora Murphy", "nora@example.com", "(607) 555-0100", "Fall Formal", "response-1"]])
    expect(submissions).toHaveLength(1)
    const [{ cookie, body }] = submissions
    expect(cookie).toContain("CG.SessionID=session")
    expect(Object.fromEntries(body)).toMatchObject({
      _csrf: "token",
      draft: "0",
      "free_text_e1c243dd-db1d-11ee-bde0-0a80ef5ee5f9": "Nora Murphy",
      "free_text_f75a7f17-db1d-11ee-bde0-0a80ef5ee5f9": "(607) 555-0100",
      "free_text_919c0e74-e2d4-11ee-bde0-0a80ef5ee5f9": "Fall Formal",
      "42137b64-e2d5-11ee-bde0-0a80ef5ee5f9": "26742",
      "free_text_49c9efdc-e2d4-11ee-bde0-0a80ef5ee5f9": "Nora Murphy",
    })
  })

  it("requires the signer's own name as the signature, and skips the waiver and emails once a day when the form's fields change", async () => {
    useCampusGroups()
    const send = vi.fn(async () => ({ messageId: "message" }))
    const alertEnv = { ...env, ALERT_EMAIL: { send } } as unknown as Env
    const post = (body: unknown) => handleApiRequest(waiverRequest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), alertEnv)

    expect((await post({ ...SIGNER, signature: " " })).status).toBe(400)
    const wrongName = await post({ ...SIGNER, signature: "Someone Else" })
    expect(wrongName.status).toBe(400)
    expect(await wrongName.json()).toEqual({ message: "Sign with your full name: Nora Murphy" })

    network.use(http.get("https://cornell.campusgroups.com/RMI/survey", () =>
      new HttpResponse(FORM_HTML.replace("free_text_49c9efdc", "free_text_renamed"), { headers: { "Content-Type": "text/html" } })))
    const changed = await post(SIGNER)
    expect(changed.status).toBe(503)
    expect(await changed.json()).toEqual({ formChanged: true })
    expect(await (await handleApiRequest(waiverRequest(), alertEnv)).json()).toEqual({ formChanged: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("emails an officer each morning only while the form is missing a field", async () => {
    const send = vi.fn(async () => ({ messageId: "message" }))
    const alertEnv = { ...env, ALERT_EMAIL: { send } } as unknown as Env

    useCampusGroups()
    await checkWaiverForm(alertEnv)
    expect(send).not.toHaveBeenCalled()

    network.use(http.get("https://cornell.campusgroups.com/RMI/survey", () =>
      new HttpResponse(FORM_HTML.replace("free_text_919c0e74", "free_text_renamed"), { headers: { "Content-Type": "text/html" } })))
    await checkWaiverForm(alertEnv)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ subject: "The CampusGroups waiver form changed" }))
  })

  it("names special events without emoji", () => {
    expect(withoutEmoji("The Lindy Haunt 👻")).toBe("The Lindy Haunt")
    expect(withoutEmoji("🎃 Fall 👩🏽‍🦰 Formal 🇺🇸")).toBe("Fall Formal")
    expect(withoutEmoji("Swing 2026 #1")).toBe("Swing 2026 #1")
  })
})
