import express from 'express';
import cors from 'cors';
import projectsRouter from './routes/projects';
import shotsRouter from './routes/shots';
import generationsRouter from './routes/generations';
import tasksRouter from './routes/tasks';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// import { fileURLToPath } from 'url'; // No longer needed if using process.cwd()

// // Determine __dirname for ES modules
// const __filename = fileURLToPath(import.meta.url); // No longer needed
// const __dirname = path.dirname(__filename); // No longer needed

dotenv.config();

const app = express();
// Use process.env.PORT for flexibility, e.g., when deploying.
// Default to 3001 for local development if PORT is not set.
const PORT = process.env.PORT || 3001;

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
  // Construct full absolute URL using req.protocol and host
  const fullUrl = `${req.protocol}://${req.get('host')}${relativeFileUrl}`;
  res.json({ url: fullUrl });
  return;
});
// --- END: Local File Upload Logic ---

// API Routes
app.use('/api/projects', projectsRouter);
app.use('/api/shots', shotsRouter);
app.use('/api/generations', generationsRouter);
app.use('/api/tasks', tasksRouter);

// Basic health check endpoint
app.get('/status', (req: express.Request, res: express.Response): void => {
  res.status(200).json({ status: 'ok' });
  return;
});

app.get('/', (req: express.Request, res: express.Response): void => {
  res.send('API Server is running!');
  return;
});

app.listen(PORT, () => {
  console.log(`API Server listening on port ${PORT}`);
});

// Export the app for potential testing or other uses (optional)
export default app; 