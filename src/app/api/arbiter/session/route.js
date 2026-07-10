import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

let redis;
try {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  });
} catch (e) {
  console.warn('Redis environment variables not found or invalid.');
}

export async function POST(request) {
  if (!redis) {
    return NextResponse.json({ error: 'Redis is not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { tournamentId, roundNumber, pairings } = body;

    if (!tournamentId || !roundNumber || !pairings) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const sessionId = crypto.randomUUID();
    const sessionKey = `arbiter:session:${sessionId}`;

    const sessionData = {
      tournamentId,
      roundNumber,
      pairings,
      createdAt: Date.now(),
      status: 'active'
    };

    // Store session in Redis, expire after 24 hours (86400 seconds)
    await redis.set(sessionKey, JSON.stringify(sessionData), { ex: 86400 });

    return NextResponse.json({ sessionId, sessionKey }, { status: 201 });
  } catch (error) {
    console.error('Error creating arbiter session:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
