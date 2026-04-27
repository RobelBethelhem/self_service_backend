// webpack.config.js
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto-browserify';
import stream from 'stream-browserify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
    mode: 'development', // or 'production'
    entry: path.resolve(__dirname, 'app.js'), // Adjust the entry point as needed
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'), // Adjust output path as needed
    },
    resolve: {
        fallback: {
            crypto: crypto,
            fs: false, // Set to false if you don't need fs in the browser
            path: false,
            stream: stream,
        },
    },
    // Additional configuration as needed
};

export default config;