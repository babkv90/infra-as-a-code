import { Router } from 'express';
import { getTimelineEntries, getTimelineEntryDetail, getTimelineFile } from '../controllers/timelineController.js';

// Public surface for the landing page's Progress Timeline / changelog blog — deliberately no
// requireAuth, since this is marketing content meant to be visible to any visitor.
export const timelineRouter = Router();

timelineRouter.get('/', getTimelineEntries);
timelineRouter.get('/:id', getTimelineEntryDetail); // in-app article reader
timelineRouter.get('/:id/file', getTimelineFile); // raw original file (view/download)
