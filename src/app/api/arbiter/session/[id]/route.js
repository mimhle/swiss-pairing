import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

let redis;
try {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  });
} catch (e) {
  console.warn('Redis environment variables not found or invalid.');
}

// GET the current state of an arbiter session
export async function GET(request, { params }) {
  if (!redis) {
    return NextResponse.json({ error: 'Redis is not configured' }, { status: 500 });
  }

  try {
    const { id } = await params;
    const sessionKey = `arbiter:session:${id}`;
    const sessionData = await redis.get(sessionKey);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 });
    }

    const response = NextResponse.json(sessionData, { status: 200 });
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  } catch (error) {
    console.error('Error fetching arbiter session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT to update scores in the arbiter session
export async function PUT(request, { params }) {
  if (!redis) {
    return NextResponse.json({ error: 'Redis is not configured' }, { status: 500 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { rounds, status } = body; // status could be used to close session

    const sessionKey = `arbiter:session:${id}`;
    let sessionData = await redis.get(sessionKey);

    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 });
    }

    if (typeof sessionData === 'string') {
        try {
            sessionData = JSON.parse(sessionData);
        } catch(e) {}
    }

    // Update rounds or status
    if (rounds) {
      sessionData.rounds = rounds;
    }
    
    if (status) {
      sessionData.status = status;
    }
    
    sessionData.updatedAt = Date.now();

    // Preserve the TTL (let's assume it should still expire relatively to when it was created, 
    // or we can refresh TTL, but refreshing TTL here might keep it alive forever if polled. 
    // Just setting it without EX would remove TTL if not careful with raw redis, 
    // but Upstash SDK .set will overwrite. Let's get remaining TTL and set it, or just use 24 hours).
    await redis.set(sessionKey, JSON.stringify(sessionData), { ex: 86400 });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error updating arbiter session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE to explicitly close a session
export async function DELETE(request, { params }) {
  if (!redis) {
    return NextResponse.json({ error: 'Redis is not configured' }, { status: 500 });
  }

  try {
    const { id } = await params;
    const sessionKey = `arbiter:session:${id}`;
    
    await redis.del(sessionKey);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting arbiter session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
