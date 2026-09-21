import { logError } from './logging'

export type PlaceResult = { label: string; address: string; url: string }

type PlacePrediction = {
  placeId?: string
  structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }
}

export async function handleLocationSearch(request: Request, apiKey: string): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() || ""
  const headers = { "Cache-Control": "no-store" }
  if (query.length < 3 || query.length > 300) return Response.json({ error: "Enter a place name between 3 and 300 characters." }, { status: 400, headers })
  if (!apiKey) return Response.json({ error: "Google Places search is not configured. You can still enter a custom location." }, { status: 503, headers })
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
      },
      body: JSON.stringify({
        input: query,
        languageCode: "en",
        locationBias: { circle: { center: { latitude: 42.447, longitude: -76.484 }, radius: 20000 } },
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Google Places autocomplete failed with HTTP ${response.status}`)
    const data = await response.json() as { suggestions?: { placePrediction?: PlacePrediction }[] }
    const places: PlaceResult[] = (data.suggestions || []).flatMap(({ placePrediction }) => {
      const label = placePrediction?.structuredFormat?.mainText?.text
      const placeId = placePrediction?.placeId
      if (!label || !placeId) return []
      const maps = new URL("https://www.google.com/maps/search/")
      maps.search = new URLSearchParams({ api: "1", query: label, query_place_id: placeId }).toString()
      return [{ label: label.slice(0, 300), address: placePrediction.structuredFormat?.secondaryText?.text || "", url: maps.href }]
    })
    return Response.json({ places }, { headers })
  } catch (error) {
    logError('Location search failed', error)
    return Response.json({ error: "Place search is unavailable. You can still enter a custom location." }, { status: 502, headers })
  }
}
