import { z } from 'zod';
import { Diagram } from '../models/Diagram.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { generateTerraform } from '../utils/terraformGenerator.js';
import { validateDiagram } from '../utils/diagramValidator.js';

export const createDiagramSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    activeRegion: z.string().optional(),
    nodes: z.array(z.any()).optional(),
    edges: z.array(z.any()).optional(),
    config: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
  }),
});

export const updateDiagramSchema = createDiagramSchema.deepPartial();

export const listDiagrams = asyncHandler(async (req, res) => {
  const diagrams = await Diagram.find({ workspace: req.user.workspace }).sort({ updatedAt: -1 });
  res.json({ success: true, data: diagrams });
});

export const createDiagram = asyncHandler(async (req, res) => {
  const diagram = await Diagram.create({
    ...req.validated.body,
    workspace: req.user.workspace,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await auditLog(req, 'diagram.create', 'Diagram', diagram._id);
  res.status(201).json({ success: true, data: diagram });
});

export const getDiagram = asyncHandler(async (req, res) => {
  const diagram = await findWorkspaceDiagram(req);
  res.json({ success: true, data: diagram });
});

export const updateDiagram = asyncHandler(async (req, res) => {
  const diagram = await findWorkspaceDiagram(req);
  Object.assign(diagram, req.validated.body, { updatedBy: req.user._id });
  await diagram.save();

  await auditLog(req, 'diagram.update', 'Diagram', diagram._id);
  res.json({ success: true, data: diagram });
});

export const deleteDiagram = asyncHandler(async (req, res) => {
  const diagram = await findWorkspaceDiagram(req);
  await diagram.deleteOne();

  await auditLog(req, 'diagram.delete', 'Diagram', diagram._id);
  res.json({ success: true, message: 'Diagram deleted' });
});

export const validateDiagramById = asyncHandler(async (req, res) => {
  const diagram = await findWorkspaceDiagram(req);
  const issues = validateDiagram(diagram.nodes, diagram.edges);
  diagram.validationIssues = issues;
  diagram.lastValidatedAt = new Date();
  await diagram.save();

  res.json({ success: true, data: { issues, valid: !issues.some((issue) => issue.severity === 'error') } });
});

export const exportTerraformById = asyncHandler(async (req, res) => {
  const diagram = await findWorkspaceDiagram(req);
  res.json({
    success: true,
    data: {
      filename: `${slug(diagram.name)}.tf`,
      terraform: generateTerraform(diagram.nodes, diagram.edges),
    },
  });
});

async function findWorkspaceDiagram(req) {
  const diagram = await Diagram.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!diagram) throw new ApiError(404, 'Diagram not found');
  return diagram;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'architecture';
}
