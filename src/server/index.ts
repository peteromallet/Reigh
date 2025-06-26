process.on('unhandledRejection', (reason, promise) => {
  console.error('[GLOBAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally, exit the process or add more detailed logging
  // process.exit(1); // Be cautious with this in production
});

process.on('uncaughtException', (error) => {
  console.error('[GLOBAL] Uncaught Exception:', error);
  // Optionally, exit the process
  // process.exit(1); // Be cautious with this in production
});

import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects';
import shotsRouter from './routes/shots';
import generationsRouter from './routes/generations';
import tasksRouter from './routes/tasks';
import steerableMotionRouter from './routes/steerableMotion';
import resourcesRouter from './routes/resources';
import apiKeysRouter from './routes/apiKeys';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { startTaskPoller, startTaskStatusPoller } from './services/taskProcessingService';
import { initializeWebSocketServer } from './services/webSocketService';
import http from 'http';
import { seedDatabase } from '../lib/seed';
import singleImageRouter from './routes/singleImageGeneration';
import localLorasRouter from './routes/localLoras';
// import { fileURLToPath } from 'url'; // No longer needed if using process.cwd()

// // Determine __dirname for ES modules
// const __filename = fileURLToPath(import.meta.url); // No longer needed
// const __dirname = path.dirname(__filename); // No longer needed

dotenv.config();

const app = express();
// Use process.env.PORT for flexibility, e.g., when deploying.
// Default to 3001 for local development if PORT is not set.
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 8085;

// Middleware
app.use(cors()); // Basic CORS setup, configure as needed for production
app.use(express.json()); // To parse JSON request bodies

// --- START: Local Image Upload Logic ---
const LOCAL_FILES_DIR_NAME = 'files'; // Changed from UPLOADS_DIR_NAME

// Relative to project root
const projectRoot = process.cwd(); // Assumes server is run from project root
const publicDir = path.join(projectRoot, 'public');
// Updated to point directly to public/files
const localFilesStorageDir = path.join(publicDir, LOCAL_FILES_DIR_NAME);

// Ensure the upload directory exists
if (!fs.existsSync(localFilesStorageDir)) {
  fs.mkdirSync(localFilesStorageDir, { recursive: true });
  console.log(`Created directory: ${localFilesStorageDir}`);
} else {
  console.log(`Upload directory already exists: ${localFilesStorageDir}`);
}


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, localFilesStorageDir); // Updated destination
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Add static middleware to serve local files via Express
app.use('/files', express.static(localFilesStorageDir));

// --- START: Local File Upload Logic ---
app.post('/api/local-image-upload', upload.single('image'), (req: express.Request, res: express.Response): void => {
  if (!req.file) {
    res.status(400).json({ message: 'No file uploaded.' });
    return;
  }
  // Build relative URL for the uploaded file
  const relativeFileUrl = `/${LOCAL_FILES_DIR_NAME}/${req.file.filename}`;
  // Construct full absolute URL using req.protocol and host - REMOVED, NOT NEEDED FOR CLIENT
  // const fullUrl = `${req.protocol}://${req.get('host')}${relativeFileUrl}`; 
  res.json({ url: relativeFileUrl }); // Return the relative URL
  return;
});

// --- START: Flipped Image Upload Logic ---
app.post('/api/upload-flipped-image', upload.single('file'), (req: express.Request, res: express.Response): void => {
  if (!req.file) {
    res.status(400).json({ message: 'No file uploaded.' });
    return;
  }
  // Build relative URL for the uploaded file
  const relativeFileUrl = `/${LOCAL_FILES_DIR_NAME}/${req.file.filename}`;
  console.log(`[Flipped Image] Saved flipped image: ${req.file.filename} (${req.file.size} bytes)`);
  res.json({ url: relativeFileUrl, imageUrl: relativeFileUrl }); // Return both url and imageUrl for compatibility
  return;
});
// --- END: Flipped Image Upload Logic ---
// --- END: Local File Upload Logic ---

// API Routes
app.use('/api/projects', projectsRouter);
app.use('/api/shots', shotsRouter);
app.use('/api/generations', generationsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/steerable-motion', steerableMotionRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/single-image', singleImageRouter);
app.use('/api/local-loras', localLorasRouter);

const startServer = async () => {
  try {
    // Seed the database with necessary initial data
    await seedDatabase();

    // The existing server initialization logic
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`API Server listening on port ${PORT} on all interfaces (0.0.0.0)`);
      initializeWebSocketServer(server);
      startTaskPoller(); // Start the background task poller
      startTaskStatusPoller(); // Start the task status poller
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

// Global error handling middleware - MUST be defined after all other app.use() and routes
 
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Global Error Handler]', err);
  
  // If the error is an object and has a status, use it, otherwise default to 500
  const statusCode = typeof err.status === 'number' ? err.status : 500;
  
  // Send a generic message or the error message if available
  const message = err.message || 'An unexpected error occurred on the server.';
  
  res.status(statusCode).json({ message });
});

// Export the app for potential testing or other uses (optional)
export default app; 