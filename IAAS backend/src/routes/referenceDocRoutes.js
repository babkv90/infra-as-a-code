import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');

const referenceDocs = {
  'node-runtime-lab': {
    fileName: 'Node_Runtime_Lab_Reference.pdf',
    title: 'Node Runtime Lab Reference',
  },
  'infrapilot-architecture': {
    fileName: 'InfraPilot_Full_Stack_Architecture_HLD_LLD_AWS_Scale.pdf',
    title: 'InfraPilot Architecture HLD LLD AWS Scale',
  },
};

export const referenceDocRouter = Router();

referenceDocRouter.get('/', (_req, res) => {
  res.json({
    documents: Object.entries(referenceDocs).map(([id, doc]) => ({
      id,
      title: doc.title,
      url: `/api/v1/reference-docs/${id}`,
    })),
  });
});

referenceDocRouter.get('/:id', (req, res, next) => {
  const doc = referenceDocs[req.params.id];

  if (!doc) {
    res.status(404).json({ message: 'Reference document not found.' });
    return;
  }

  const pdfPath = path.join(backendRoot, doc.fileName);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(pdfPath, (error) => {
    if (error) next(error);
  });
});
