import { NextRequest, NextResponse } from 'next/server';

import { geocodeQuery } from '@/lib/geocode';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams.get('q') ?? '';

  if (!q.trim()) {
    return NextResponse.json({ error: 'Missing q query parameter' }, { status: 400 });
  }

  try {
    const result = await geocodeQuery(q);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Geocoding failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
