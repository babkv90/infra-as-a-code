import { Router } from 'express';
import {
  disconnectGithub,
  getGithubConnection,
  listGithubBranches,
  githubOAuthCallback,
  listGithubRepositories,
  startGithubOAuth,
} from '../controllers/githubController.js';
import { requireAuth } from '../middleware/auth.js';

export const githubRouter = Router();

githubRouter.get('/oauth/connect', startGithubOAuth);
githubRouter.get('/oauth/start', startGithubOAuth);
githubRouter.get('/oauth/callback', githubOAuthCallback);

githubRouter.use(requireAuth);
githubRouter.get('/status', getGithubConnection);
githubRouter.get('/connection', getGithubConnection);
githubRouter.delete('/disconnect', disconnectGithub);
githubRouter.delete('/connection', disconnectGithub);
githubRouter.get('/repos', listGithubRepositories);
githubRouter.get('/branches', listGithubBranches);
