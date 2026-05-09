import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import ProductTemplate from '../models/ProductTemplate';
import Product from '../models/Product';
import Project from '../models/Project';
import TemplateSelection from '../models/TemplateSelection';
import { emitRealtimeEvent } from '../realtime';

const router = Router();

function resolveUploadsDir(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(__dirname, '..', '..', 'uploads');
}

function normalizeImagesRoute(value?: string): string {
  const raw = (value || '/images').trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, '');
}

const uploadsDir = resolveUploadsDir();
const imagesRoute = normalizeImagesRoute(process.env.IMAGES_ROUTE);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 5) || 5;
const maxUploadBytes = maxUploadMb * 1024 * 1024;

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedMimeTypes = new Set(['image/jpeg', 'image/png']);
const mimeToExt: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = mimeToExt[file.mimetype]
      || path.extname(file.originalname).toLowerCase()
      || '.jpg';
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error('Only JPG and PNG images are allowed.');
      (error as NodeJS.ErrnoException).code = 'INVALID_FILE_TYPE';
      cb(error);
      return;
    }
    cb(null, true);
  },
});

function buildPublicImageUrl(req: Request, filename: string): string {
  const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/+$/, '');
  return `${baseUrl}${imagesRoute}/${filename}`;
}

function handleUploadError(error: unknown, res: Response): void {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, error: `Image too large. Max ${maxUploadMb}MB.` });
      return;
    }
    res.status(400).json({ success: false, error: error.message });
    return;
  }
  if ((error as NodeJS.ErrnoException)?.code === 'INVALID_FILE_TYPE') {
    res.status(400).json({ success: false, error: 'Only JPG and PNG images are allowed.' });
    return;
  }
  res.status(500).json({ success: false, error: 'Image upload failed.' });
}

const maybeUploadImage = (req: Request, res: Response, next: NextFunction) => {
  if (req.is('multipart/form-data')) {
    upload.single('image')(req, res, (error) => {
      if (error) {
        handleUploadError(error, res);
        return;
      }
      next();
    });
    return;
  }
  next();
};

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

function resolvePreviewImage(payload: Record<string, any>): string {
  return String(payload.preview_image || payload.previewImageUrl || payload.imageUrl || '').trim();
}

/**
 * Normalise preview fields on plain objects returned by .lean() queries.
 * The Mongoose toJSON transform only runs on hydrated documents, not lean results.
 */
function normalizeLeanTemplate(t: Record<string, any>): Record<string, any> {
  const preview = t.preview_image || t.previewImageUrl || '';
  if (preview) {
    t.preview_image = preview;
    t.previewImageUrl = preview;
  }
  return t;
}

// Fields included in gallery list responses — excludes designData (can be megabytes of canvas JSON).
// Full designData is only fetched when a specific template is opened (GET /:id or project-specific list).
const GALLERY_SELECT_FIELDS =
  '_id productId projectId templateName description category ' +
  'previewImageUrl preview_image designFileUrl isGlobal isActive tags createdAt updatedAt';

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

router.post('/upload-image', (req: Request, res: Response) => {
  upload.single('image')(req, res, (error) => {
    if (error) {
      handleUploadError(error, res);
      return;
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ success: false, error: 'Image file is required.' });
      return;
    }

    const url = buildPublicImageUrl(req, file.filename);
    res.status(201).json({
      success: true,
      data: {
        url,
        filename: file.filename,
      },
    });
  });
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const requestedProductId = String(req.query.productId || '').trim();
    const requestedProjectId = String(req.query.projectId || '').trim();
    console.log('[templates] GET /api/templates', {
      productId: requestedProductId || null,
      projectId: requestedProjectId || null,
      query: req.query,
    });

    const isGalleryMode = !requestedProductId && !requestedProjectId;

    // Fetch templates by projectId or productId
    let filter: Record<string, any> = {};
    if (requestedProductId) {
      const productConditions: Record<string, any>[] = [
        { productId: requestedProductId },
        { isGlobal: true },
      ];
      if (isValidObjectId(requestedProductId)) {
        productConditions.push({ productId: new mongoose.Types.ObjectId(requestedProductId) });
      }
      filter = { $or: productConditions };
    } else if (requestedProjectId) {
      // Match both projectId (string field) AND productId (ObjectId field) for backward compat —
      // older templates stored the projectId in productId before this fix was applied.
      const projectConditions: Record<string, any>[] = [
        { projectId: requestedProjectId },
      ];
      if (isValidObjectId(requestedProjectId)) {
        projectConditions.push({ productId: new mongoose.Types.ObjectId(requestedProjectId) });
      }
      // Include global templates so all users see shared designs.
      projectConditions.push({ isGlobal: true });
      filter = { $or: projectConditions };
    } else {
      // Gallery mode (no productId / projectId): only return public global templates.
      // This prevents project-specific copies and clones from polluting the gallery.
      filter = { isGlobal: true };
    }

    // Gallery mode: exclude designData (can be megabytes of canvas JSON per template) and use
    // lean() for 3-5x faster query execution. Full designData is fetched on-demand via GET /:id.
    // Project/product mode: return full documents (including designData) so the frontend can render
    // previews immediately, but still use lean() for lower memory overhead.
    const rawTemplates = isGalleryMode
      ? await ProductTemplate
          .find(filter)
          .select(GALLERY_SELECT_FIELDS)
          .sort({ updatedAt: -1 })
          .lean<Array<Record<string, any>>>()
      : await ProductTemplate
          .find(filter)
          .sort({ updatedAt: -1 })
          .lean<Array<Record<string, any>>>();

    // Normalize preview fields — Mongoose toJSON transform doesn't run on lean() results.
    const normalizedTemplates = rawTemplates.map(normalizeLeanTemplate);

    // Deduplicate by name only in gallery mode (no productId / projectId filter).
    // When fetching project-specific templates, all records must be returned regardless of name
    // so that a project copy with the same name as the global template is not silently dropped.
    const seenNames = new Set<string>();
    const templates = isGalleryMode
      ? normalizedTemplates.filter((t) => {
          const key = String(t.templateName || '').trim().toLowerCase();
          if (seenNames.has(key)) return false;
          seenNames.add(key);
          return true;
        })
      : normalizedTemplates;

    console.log('[templates] Templates found', {
      count: templates.length,
      ids: templates.map((template) => String(template._id)),
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: templates,
      meta: {
        total: templates.length
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] GET /api/templates failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/product/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) {
      res.status(400).json({ success: false, error: 'Invalid productId' });
      return;
    }

    const { category, search } = req.query;
    const filter: Record<string, any> = { productId, isActive: true };
    if (category) filter.category = category;
    if (search) filter.templateName = { $regex: String(search), $options: 'i' };

    console.log('[templates] Querying /api/templates/product/:productId', {
      productId,
      filter,
      database: mongoose.connection.name,
      collection: 'producttemplates',
    });

    const templates = await ProductTemplate.find(filter).sort({ updatedAt: -1 }).lean<Array<Record<string, any>>>();
    const normalizedTemplates = templates.map(normalizeLeanTemplate);
    res.setHeader('Cache-Control', 'no-store');
    console.log('[templates] Query result', {
      productId,
      count: normalizedTemplates.length,
      templateIds: normalizedTemplates.map((t) => String(t._id)),
    });
    res.json({ success: true, data: normalizedTemplates });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] GET /api/templates/product/:productId failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ success: false, error: 'Invalid template id' });
      return;
    }

    const template = await ProductTemplate.findById(id);
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: template });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] GET /api/templates/:id failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', maybeUploadImage, async (req: Request, res: Response) => {
  try {
    const {
      productId,
      projectId: bodyProjectId,
      userId,
      title,
      templateName,
      description,
      imageUrl,
      previewImageUrl,
      preview_image,
      designFileUrl,
      designData,
      category = 'Other',
      tags = [],
      isActive = true,
      isGlobal,
      isPublic,
    } = req.body;

    const file = (req as Request & { file?: Express.Multer.File }).file;
    const uploadedImageUrl = file ? buildPublicImageUrl(req, file.filename) : '';
    const normalizedPreview = uploadedImageUrl || resolvePreviewImage({ preview_image, previewImageUrl, imageUrl });
    const resolvedTemplateName = String(title || templateName || '').trim();

    if (!productId || !resolvedTemplateName) {
      res.status(400).json({ success: false, error: 'productId and title/templateName are required' });
      return;
    }

    if (userId && !isValidObjectId(String(userId))) {
      res.status(400).json({ success: false, error: 'Invalid userId' });
      return;
    }

    const isProductObjectId = isValidObjectId(productId);
    let isActualProduct = false;
    let isActualProject = false;

    if (isProductObjectId) {
      const productExists = await Product.exists({ _id: productId });
      if (productExists) {
        isActualProduct = true;
      } else {
        const projectExists = await Project.exists({ _id: productId });
        if (!projectExists) {
          res.status(404).json({ success: false, error: 'Product or Project not found for template mapping' });
          return;
        }
        isActualProject = true;
      }
    }

    // Resolve final projectId: explicit bodyProjectId wins, otherwise derive from productId when it's a project
    const resolvedProjectId = String(bodyProjectId || (isActualProject ? productId : '') || '').trim();

    // ── Idempotency check: if a non-global template with the same projectId + name already exists, return it ──
    // NOTE: isGlobal: true templates are gallery templates — they must NOT be counted as project attachments
    // even if they share the same projectId (templates created for a project are stored with projectId set).
    if (resolvedProjectId) {
      const existing = await ProductTemplate.findOne({
        projectId: resolvedProjectId,
        templateName: resolvedTemplateName,
        isGlobal: { $ne: true },
      });
      if (existing) {
        console.log('[templates] Template already exists for project — returning existing', {
          _id: String(existing._id),
          templateName: existing.templateName,
          projectId: resolvedProjectId,
        });
        res.status(200).json({ success: true, data: existing, alreadyExists: true });
        return;
      }
    }

    const template = new ProductTemplate({
      ...(isActualProduct ? { productId: new mongoose.Types.ObjectId(String(productId)) } : {}),
      ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
      createdBy: userId ? new mongoose.Types.ObjectId(String(userId)) : undefined,
      isGlobal: [true, 'true', 1, '1'].includes(isGlobal)
        || [true, 'true', 1, '1'].includes(isPublic),
      templateName: resolvedTemplateName,
      description: typeof description === 'string' ? description.trim() : undefined,
      preview_image: normalizedPreview || '',
      previewImageUrl: normalizedPreview || '',
      designFileUrl,
      designData: parseJsonField<Record<string, any>>(designData, {}),
      category,
      tags: parseJsonField<string[]>(tags, []),
      isActive,
    });

    console.log('[templates] Saving template', {
      resolvedProjectId: resolvedProjectId || null,
      isActualProduct,
      isActualProject,
      templateName: template.templateName,
      collection: 'producttemplates',
      database: mongoose.connection.name,
    });

    let savedTemplate: typeof template;
    try {
      savedTemplate = await template.save();
    } catch (saveError: any) {
      // Handle MongoDB duplicate key error (E11000) — return the existing document instead
      if (saveError?.code === 11000) {
        const dupFilter: Record<string, any> = { templateName: resolvedTemplateName, isGlobal: { $ne: true } };
        if (resolvedProjectId) dupFilter.projectId = resolvedProjectId;
        else if (isActualProduct) dupFilter.productId = new mongoose.Types.ObjectId(String(productId));
        const existingDup = await ProductTemplate.findOne(dupFilter);
        if (existingDup) {
          console.log('[templates] Duplicate key — returning existing template', {
            _id: String(existingDup._id),
            templateName: existingDup.templateName,
          });
          res.status(200).json({ success: true, data: existingDup, alreadyExists: true });
          return;
        }
      }
      throw saveError;
    }

    // Push template ref into Project.templates array
    if (resolvedProjectId && isValidObjectId(resolvedProjectId)) {
      await Project.findByIdAndUpdate(
        resolvedProjectId,
        { $addToSet: { templates: savedTemplate._id } },
        { new: false }
      ).catch((err: Error) => {
        console.warn('[templates] Failed to update Project.templates array', err.message);
      });
    }

    console.log('[templates] Template saved successfully', {
      _id: String(savedTemplate._id),
      templateName: savedTemplate.templateName,
      projectId: savedTemplate.projectId || null,
      createdAt: savedTemplate.createdAt,
    });

    emitRealtimeEvent({
      type: 'template:created',
      templateId: String(savedTemplate._id),
      projectId: savedTemplate.projectId || savedTemplate.productId?.toString(),
      productId: savedTemplate.productId?.toString(),
      isGlobal: savedTemplate.isGlobal === true,
    });

    res.status(201).json({ success: true, data: savedTemplate });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] Template save failed', {
      error: err.message,
      stack: err.stack,
      mongoError: (error as any).code,
      mongoMessage: (error as any).message,
    });
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ success: false, error: 'Invalid template id' });
      return;
    }

    const existingTemplate = await ProductTemplate.findById(id);
    if (!existingTemplate) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    const normalizedPreview = resolvePreviewImage(req.body as Record<string, any>)
      || existingTemplate.preview_image
      || existingTemplate.previewImageUrl
      || '';

    const updatePayload: Record<string, any> = {
      ...req.body,
      preview_image: normalizedPreview || undefined,
      previewImageUrl: normalizedPreview || undefined,
    };

    console.log('[templates] Updating template', {
      _id: id,
      database: mongoose.connection.name,
      updateFields: Object.keys(updatePayload),
    });

    const template = await ProductTemplate.findByIdAndUpdate(id, updatePayload, { new: true });
    console.log('[templates] Template updated successfully', {
      _id: id,
      updatedAt: template?.updatedAt,
    });

    emitRealtimeEvent({
      type: 'template:updated',
      templateId: id,
      projectId: template?.projectId || template?.productId?.toString(),
      productId: template?.productId?.toString(),
      isGlobal: template?.isGlobal === true,
    });

    res.json({ success: true, data: template });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] Template update failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(400).json({ success: false, error: err.message });
  }
});

// Unlink a template from a project without deleting the template document itself.
// Used by "Remove from project" in ProjectDetail — the template remains in the
// Template Gallery (if isGlobal) or as an orphaned record (if private).
router.patch('/:id/unlink', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const projectId = String((req.body as Record<string, unknown>).projectId || '').trim();

    if (!isValidObjectId(id)) {
      res.status(400).json({ success: false, error: 'Invalid template id' });
      return;
    }
    if (!projectId || !isValidObjectId(projectId)) {
      res.status(400).json({ success: false, error: 'Valid projectId is required' });
      return;
    }

    const template = await ProductTemplate.findById(id);
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    // Remove association fields so the template no longer appears in project queries.
    // isGlobal templates remain visible in the gallery via {isGlobal:true} filter.
    await ProductTemplate.findByIdAndUpdate(id, {
      $unset: { projectId: '', productId: '' },
    });

    // Remove from the project's template array.
    await Project.findByIdAndUpdate(
      projectId,
      { $pull: { templates: template._id } },
      { new: false }
    ).catch((err: Error) => {
      console.warn('[templates] Failed to pull from Project.templates on unlink', err.message);
    });

    console.log('[templates] Template unlinked from project', {
      templateId: id,
      projectId,
    });

    emitRealtimeEvent({
      type: 'template:updated',
      templateId: id,
      projectId,
      productId: template.productId?.toString(),
      isGlobal: template.isGlobal === true,
    });

    res.json({ success: true });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] Template unlink failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ success: false, error: 'Invalid template id' });
      return;
    }

    const template = await ProductTemplate.findById(id);
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }

    await ProductTemplate.deleteOne({ _id: id });

    const projectIdCandidate = template.projectId || template.productId?.toString();
    if (projectIdCandidate && isValidObjectId(projectIdCandidate)) {
      await Project.findByIdAndUpdate(
        projectIdCandidate,
        { $pull: { templates: template._id } },
        { new: false }
      ).catch((err: Error) => {
        console.warn('[templates] Failed to update Project.templates array', err.message);
      });
    }

    emitRealtimeEvent({
      type: 'template:deleted',
      templateId: id,
      projectId: template.projectId || template.productId?.toString(),
      productId: template.productId?.toString(),
      isGlobal: template.isGlobal === true,
    });

    res.json({ success: true });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] Template delete failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/selection', async (req: Request, res: Response) => {
  try {
    const { userId, productId, templateId, action, metadata } = req.body;

    if (!productId || !templateId || !action) {
      res.status(400).json({ success: false, error: 'productId, templateId and action are required' });
      return;
    }
    if (!isValidObjectId(productId) || !isValidObjectId(templateId)) {
      res.status(400).json({ success: false, error: 'Invalid productId or templateId' });
      return;
    }

    const mappedTemplate = await ProductTemplate.findOne({ _id: templateId, productId, isActive: true });
    if (!mappedTemplate) {
      res.status(404).json({ success: false, error: 'Template is not linked to this product' });
      return;
    }

    const selection = new TemplateSelection({
      userId,
      productId,
      templateId,
      action,
      metadata: metadata ?? {},
    });

    await selection.save();
    res.status(201).json({ success: true, data: selection });
  } catch (error) {
    const err = error as Error;
    console.error('[templates] Template selection save failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(400).json({ success: false, error: err.message });
  }
});

// Migration endpoint: Sync localStorage project templates to MongoDB
router.post('/migration/sync-project-templates', async (req: Request, res: Response) => {
  try {
    const { projectId, templates } = req.body as {
      projectId: string;
      templates: Array<{
        id?: string;
        templateName: string;
        templateType?: string;
        canvas?: Record<string, any>;
        margin?: Record<string, any>;
        thumbnail?: string;
        isPublic?: boolean;
        applicableFor?: string[];
      }>;
    };

    if (!projectId || !Array.isArray(templates)) {
      res.status(400).json({
        success: false,
        error: 'projectId and templates array are required'
      });
      return;
    }

    console.log('[templates:migration] Starting sync', {
      projectId,
      count: templates.length,
      database: mongoose.connection.name,
    });

    const savedTemplates: Array<{ _id: string; templateName: string; sourceId?: string }> = [];
    const errors: Array<{ templateName: string; error: string }> = [];

    for (const tpl of templates) {
      try {
        const isProjectObjectId = isValidObjectId(projectId);
        if (isProjectObjectId) {
          const productExists = await Product.exists({ _id: projectId });
          const projectExists = productExists ? null : await Project.exists({ _id: projectId });
          if (!productExists && !projectExists) {
            console.warn('[templates:migration] Product or Project not found:', { projectId });
            errors.push({ templateName: tpl.templateName, error: 'Product or Project not found' });
            continue;
          }
        }

        // Create template in MongoDB
        const newTemplate = new ProductTemplate({
          ...(isProjectObjectId ? { productId: projectId } : { projectId: String(projectId) }),
          templateName: String(tpl.templateName).trim(),
          category: 'Other', // Default category
          preview_image: tpl.thumbnail || '',
          previewImageUrl: tpl.thumbnail || '',
          designData: {
            templateType: tpl.templateType,
            canvas: tpl.canvas,
            margin: tpl.margin,
            applicableFor: tpl.applicableFor,
            canvasJSON: (tpl as { canvasJSON?: string }).canvasJSON,
          },
          isActive: tpl.isPublic !== false,
          tags: [`migrated_${new Date().toISOString().split('T')[0]}`],
        });

        await newTemplate.save();
        savedTemplates.push({
          _id: String(newTemplate._id),
          templateName: newTemplate.templateName,
          sourceId: tpl.id,
        });

        console.log('[templates:migration] Template saved', {
          templateName: tpl.templateName,
          _id: String(newTemplate._id),
        });
      } catch (err) {
        const error = err as Error;
        console.error('[templates:migration] Template save failed', {
          templateName: tpl.templateName,
          error: error.message,
        });
        errors.push({
          templateName: tpl.templateName,
          error: error.message,
        });
      }
    }

    console.log('[templates:migration] Sync complete', {
      projectId,
      saved: savedTemplates.length,
      failed: errors.length,
    });

    res.json({
      success: true,
      message: `Migrated ${savedTemplates.length} templates to MongoDB`,
      data: {
        saved: savedTemplates,
        errors,
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error('[templates:migration] Migration failed', {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
