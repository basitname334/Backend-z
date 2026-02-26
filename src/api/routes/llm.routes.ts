import { Router } from 'express';
import { logger } from '../../config/logger';
import { llmService } from '../../services/llm.service';

const router = Router();

/**
 * Health check for Ollama LLM service
 */
router.get('/health', async (req, res) => {
    try {
        const isHealthy = await llmService.healthCheck();

        if (isHealthy) {
            res.json({
                status: 'ok',
                service: 'ollama',
                baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
                model: process.env.OLLAMA_MODEL || 'llama3',
            });
        } else {
            res.status(503).json({
                status: 'unavailable',
                service: 'ollama',
                message: 'Ollama service is not accessible',
            });
        }
    } catch (error) {
        logger.error('LLM health check failed', { error });
        res.status(500).json({
            status: 'error',
            message: 'Failed to check LLM service health',
        });
    }
});

/**
 * Test LLM generation
 */
router.post('/test', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const response = await llmService.generate(prompt);

        res.json({
            success: true,
            prompt,
            response,
        });
    } catch (error) {
        logger.error('LLM test failed', { error });
        res.status(500).json({
            error: 'Failed to generate LLM response',
        });
    }
});

export const llmRoutes = router;
