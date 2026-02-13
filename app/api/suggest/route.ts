import { NextRequest, NextResponse } from 'next/server';

import { suggestLocations } from '@/lib/geocode';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams.get('q') ?? '';

  if (!q.trim()) {
    return NextResponse.json([]);
  }

  try {
    const suggestions = await suggestLocations(q);
    return NextResponse.json(suggestions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suggestion lookup failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
