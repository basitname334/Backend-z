import { Router } from 'express';
import { config } from '../../config';

const router = Router();

/**
 * GET /api/v1/heygen/token
 * Returns a short-lived HeyGen streaming access token.
 * The API key stays secret on the backend; the frontend only receives the token.
 */
router.get('/token', async (_req, res) => {
  const apiKey = config.heygenApiKey;
  if (!apiKey) {
    return res.status(503).json({ error: 'HEYGEN_API_KEY not configured on the server.' });
  }

  try {
    const response = await fetch('https://api.heygen.com/v1/streaming.create_token', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    const body = (await response.json()) as { data?: { token: string }; error?: string };
    if (!body.data?.token) {
      return res.status(502).json({ error: body.error || 'HeyGen did not return a token.' });
    }
    return res.json({ token: body.data.token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `HeyGen token fetch failed: ${msg}` });
  }
});

export default router;
