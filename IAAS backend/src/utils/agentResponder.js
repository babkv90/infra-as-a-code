import { env } from '../config/env.js';

const RAG_TIMEOUT_MS = 45_000;

export async function answerCloudQuestion(question) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.RAG_API_URL.replace(/\/$/, '')}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        top_k: 5,
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = typeof result?.detail === 'string' ? result.detail : 'RAG request failed.';
      throw new Error(detail);
    }

    return {
      content: result?.answer ?? 'The RAG service returned no answer.',
      metadata: {
        provider: 'fastapi-rag',
        ragApiUrl: env.RAG_API_URL,
        contexts: Array.isArray(result?.contexts) ? result.contexts : [],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown RAG error';

    return {
      content:
        `The AWS Well-Architected RAG service is not available right now. ` +
        `Start the FastAPI service at ${env.RAG_API_URL} and make sure the vector store is indexed. ` +
        `Details: ${message}`,
      metadata: {
        provider: 'fastapi-rag',
        ragApiUrl: env.RAG_API_URL,
        error: message,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
