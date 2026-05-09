import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { connectDB } from './config/database';
import ProductTemplate from './models/ProductTemplate';
import { hasPostgresConfig, initAuthSchema, testAuthDbConnection } from './config/postgres';
import projectRoutes from './routes/projects';
import clientRoutes from './routes/clients';
import productRoutes from './routes/products';
import templateRoutes from './routes/templates';
import orderRoutes from './routes/orders';
import authRoutes from './routes/auth';
import previewRoutes from './routes/preview';
import uploadImagesRoute from './routes/uploads';
import realtimeRoutes from './routes/realtime';
import rulesRoutes from './routes/rules';
import importsRoutes from './routes/imports';
import { bullBoardRouter } from './queues/bullBoard';
// Start the BullMQ worker in-process (runs concurrently alongside Express).
// For independent horizontal scaling, move this import to a separate entry
// point (e.g. backend/src/worker.ts) and run it as its own process/container.
import './workers/bulkImportWorker';

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

const backendRootDir = path.resolve(__dirname, '..');
const repoRootDir = path.resolve(backendRootDir, '..');

function parseCsvOrigins(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const allowedOrigins = new Set([
  ...parseCsvOrigins(process.env.CORS_ORIGIN),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
]);

// Middleware
const apiCorsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
});
app.use('/api', apiCorsMiddleware);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve uploads from backend/public/uploads/ — consistent with uploads route
const uploadsDir = process.env.UPLOADS_DIR?.trim()
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(backendRootDir, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`[server] Uploads directory created: ${uploadsDir}`);
}
app.use('/uploads', express.static(uploadsDir));
app.use('/images', express.static(uploadsDir));

const isRenderEnvironment = process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID);
const studentPhotosDir = process.env.STUDENT_PHOTOS_DIR?.trim()
  || (process.env.NODE_ENV !== 'production' && !isRenderEnvironment ? 'C:/Users/Sayali/OneDrive/Sem-V/Photos' : '');
// Fallback lookup: if a file is not found in backend/uploads, also try student photos.
if (studentPhotosDir) {
  const resolvedStudentDir = path.resolve(studentPhotosDir);
  if (fs.existsSync(resolvedStudentDir)) {
    app.use('/uploads', express.static(resolvedStudentDir));
    app.use('/student-photos', express.static(resolvedStudentDir));
  } else {
    console.warn(`Student photos directory not found (skipped): ${resolvedStudentDir}`);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/projects', projectRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/products', productRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/preview', previewRoutes);
app.use('/api/upload-images', uploadImagesRoute);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/imports', importsRoutes);

// Bull Board queue monitoring dashboard — http://localhost:5000/admin/queues
// ⚠️  Protect with auth middleware in production.
app.use('/admin/queues', bullBoardRouter);

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API route not found' });
});

const frontendDistDir = path.resolve(repoRootDir, 'dist');
const frontendIndexPath = path.resolve(frontendDistDir, 'index.html');
if (fs.existsSync(frontendIndexPath)) {
  // In one-service deployment, serve the Vite build from Express.
  app.use(express.static(frontendDistDir));
  app.get(/^\/(?!api\/|uploads\/|student-photos\/|health$).*/, (req, res) => {
    res.sendFile(frontendIndexPath);
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// Start server
async function startServer() {
  try {
    await connectDB();
    // --- AUTO SEED LOGIC: Insert default templates if none exist ---
    const templateCount = await ProductTemplate.countDocuments();
    console.log(`✓ ProductTemplate count: ${templateCount}`);
    if (templateCount === 0) {
      await ProductTemplate.insertMany([
        {
          productId: new (require('mongoose')).Types.ObjectId(),
          templateName: 'Default Template',
          category: 'Business',
          designData: {},
          isActive: true,
          tags: ['default'],
        }
      ]);
      console.log('✓ Seeded default ProductTemplate');
    }

    // --- MIGRATION: promote root templates (no projectId) to isGlobal=true ---
    // This ensures the Gallery shows all templates that aren't scoped to a specific project.
    // Safe to run on every startup — only updates documents that need it.
    try {
      const promoted = await ProductTemplate.updateMany(
        { projectId: null, isGlobal: { $ne: true } },
        { $set: { isGlobal: true } },
      );
      if (promoted.modifiedCount > 0) {
        console.log(`✓ Promoted ${promoted.modifiedCount} root template(s) to isGlobal=true`);
      }
    } catch (migErr) {
      console.warn('! Could not promote root templates to global (non-fatal):', (migErr as Error).message);
    }
    if (hasPostgresConfig()) {
      await testAuthDbConnection();
      await initAuthSchema();
    } else {
      console.warn('! PostgreSQL auth config not found. Auth endpoints require PostgreSQL configuration.');
    }
    app.listen(PORT, () => {
      console.log(`\n✓ Backend server running on http://localhost:${PORT}`);
      if (hasPostgresConfig()) {
        console.log('✓ PostgreSQL auth database connected successfully');
      }
      console.log(`✓ Serving uploads from: ${uploadsDir}`);
      console.log(`✓ Serving images from: ${uploadsDir}`);
      if (fs.existsSync(frontendIndexPath)) {
        console.log(`✓ Serving frontend build from: ${frontendDistDir}`);
      }
      if (studentPhotosDir && fs.existsSync(path.resolve(studentPhotosDir))) {
        console.log(`✓ Uploads fallback from student photos: ${path.resolve(studentPhotosDir)}`);
      }
      console.log(`✓ Uploads URL base: http://localhost:${PORT}/uploads/`);
      console.log(`✓ API endpoints:\n  - GET /health\n  - /api/projects\n  - /api/clients\n  - /api/products\n  - /api/templates\n  - /api/orders\n  - /api/auth\n  - /api/preview\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
