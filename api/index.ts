import app from '../server/index';

// Static import is intentional: Vercel's bundler follows this path and
// includes the export server and its dependencies in the function bundle.
export default app;
