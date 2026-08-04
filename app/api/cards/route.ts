const LORCAST_API = "https://api.lorcast.com/v0/cards";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const set = searchParams.get("set")?.trim();
  const number = searchParams.get("number")?.trim();
  const query = searchParams.get("q")?.trim();

  let url: string;
  if (set && number) {
    url = `${LORCAST_API}/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;
  } else if (query) {
    url = `${LORCAST_API}/search?q=${encodeURIComponent(query)}&unique=prints`;
  } else {
    return Response.json({ error: "Provide set and number, or a search query." }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) {
      return Response.json({ error: "Card not found." }, { status: response.status === 404 ? 404 : 502 });
    }
    const data = await response.json();
    return Response.json(query ? data.results || [] : data);
  } catch {
    return Response.json({ error: "Card database unavailable." }, { status: 502 });
  }
}
