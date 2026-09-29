import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    service: 'greanteafx-backend',
    status: 'ok',
    engine: 'node-web-audio-api',
    time: new Date().toISOString(),
  });
}
